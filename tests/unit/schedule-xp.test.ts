import {
  buildCalendar,
  computeStreak,
  rescheduleSlots,
  weekAdherence,
  type AttendanceLite,
  type VersionWindow,
} from '@/domain/rules/schedule';
import { levelFor, sessionAwards, XP_CONFIG } from '@/domain/rules/xp';

// Mon/Wed/Fri plan. 2026-10-05 is a Monday.
const windows: VersionWindow[] = [
  {
    versionId: 'v1',
    effectiveFrom: '2026-10-01',
    days: [
      { id: 'A', title: 'Upper', weekday: 1 },
      { id: 'B', title: 'Lower', weekday: 3 },
      { id: 'C', title: 'Full', weekday: 5 },
    ],
  },
];
const ev = (
  date: string,
  dayId: string,
  status: AttendanceLite['status'],
  extra: Partial<AttendanceLite> = {},
): AttendanceLite => ({
  date,
  planned_day_id: dayId,
  status,
  reason: null,
  rescheduled_to: null,
  related_session_id: null,
  ...extra,
});
const cal = (
  attendance: AttendanceLite[],
  today = '2026-10-16',
  from = '2026-10-05',
  to = '2026-10-18',
) => buildCalendar({ from, to, today, windows, attendance });

describe('schedule and streaks', () => {
  it('weekdays without a planned day are rest days and do not break the streak', () => {
    const c = cal(
      [
        ev('2026-10-05', 'A', 'completed_as_planned'),
        ev('2026-10-07', 'B', 'completed_adapted'),
        ev('2026-10-09', 'C', 'partially_completed'),
      ],
      '2026-10-11',
    );
    expect(c.filter((d) => d.rest).map((d) => d.date)).toContain('2026-10-06');
    expect(computeStreak(c).current).toBe(3);
  });

  it('a missed planned session ends the streak; an unlogged past session counts as missed', () => {
    const c = cal(
      [
        ev('2026-10-05', 'A', 'completed_as_planned'),
        ev('2026-10-09', 'C', 'completed_as_planned'),
      ],
      '2026-10-11',
    );
    // 2026-10-07 (B) has no record → missed_unconfirmed
    expect(c.find((d) => d.date === '2026-10-07')!.occurrences[0]!.outcome).toBe(
      'missed_unconfirmed',
    );
    const s = computeStreak(c);
    expect(s.current).toBe(1);
    expect(s.best).toBe(1);
  });

  it("today's pending session and future sessions are neutral", () => {
    const c = cal(
      [ev('2026-10-12', 'A', 'completed_as_planned')],
      '2026-10-14',
      '2026-10-12',
      '2026-10-18',
    );
    expect(computeStreak(c).current).toBe(1);
  });

  it('user-approved reschedule is neutral and the moved session counts on its new date', () => {
    const c = cal(
      [
        ev('2026-10-05', 'A', 'completed_as_planned'),
        ev('2026-10-07', 'B', 'rescheduled', { rescheduled_to: '2026-10-08' }),
        ev('2026-10-08', 'B', 'completed_as_planned'),
        ev('2026-10-09', 'C', 'completed_as_planned'),
      ],
      '2026-10-11',
    );
    const thu = c.find((d) => d.date === '2026-10-08')!;
    expect(thu.occurrences[0]).toMatchObject({
      dayId: 'B',
      rescheduledFrom: '2026-10-07',
      outcome: 'completed_as_planned',
    });
    expect(computeStreak(c).current).toBe(3);
  });

  it('excused cancellations (illness/travel) and habit actions are neutral; unexcused skip breaks', () => {
    const base = [
      ev('2026-10-05', 'A', 'completed_as_planned'),
      ev('2026-10-09', 'C', 'completed_as_planned'),
    ];
    expect(
      computeStreak(
        cal([...base, ev('2026-10-07', 'B', 'cancelled', { reason: 'illness' })], '2026-10-11'),
      ).current,
    ).toBe(2);
    expect(
      computeStreak(cal([...base, ev('2026-10-07', 'B', 'habit_action')], '2026-10-11')).current,
    ).toBe(2);
    expect(
      computeStreak(
        cal([...base, ev('2026-10-07', 'B', 'cancelled', { reason: 'schedule' })], '2026-10-11'),
      ).current,
    ).toBe(1);
  });

  it('uses the programme version in effect on each date', () => {
    const w2: VersionWindow[] = [
      ...windows,
      {
        versionId: 'v2',
        effectiveFrom: '2026-10-10',
        days: [{ id: 'D', title: 'Daily', weekday: 0 }],
      },
    ];
    const c = buildCalendar({
      from: '2026-10-05',
      to: '2026-10-11',
      today: '2026-10-11',
      windows: w2,
      attendance: [],
    });
    expect(c.find((d) => d.date === '2026-10-05')!.occurrences[0]!.dayId).toBe('A');
    expect(c.find((d) => d.date === '2026-10-11')!.occurrences[0]!.dayId).toBe('D');
  });

  it('weekly adherence separates attended, adapted, partial and missed', () => {
    const week = cal(
      [
        ev('2026-10-05', 'A', 'completed_adapted'),
        ev('2026-10-07', 'B', 'partially_completed'),
        ev('2026-10-09', 'C', 'missed'),
      ],
      '2026-10-11',
      '2026-10-05',
      '2026-10-11',
    );
    expect(weekAdherence(week)).toMatchObject({
      planned: 3,
      attended: 2,
      adapted: 1,
      partial: 1,
      missed: 1,
      rest: 4,
    });
  });

  it('reschedule slots are upcoming rest days', () => {
    expect(rescheduleSlots('2026-10-05', windows, [], 4)).toEqual(['2026-10-06', '2026-10-08']);
  });
});

describe('XP and badges', () => {
  const facts = {
    sessionId: 's1',
    status: 'completed_as_planned' as const,
    sessionType: 'planned' as const,
    prCount: 2,
    completedSessions: 1,
    adaptedCompletions: 0,
    prSessions: 1,
    streak: { current: 3, startedOn: '2026-10-05' },
  };

  it('awards flat session XP with deterministic idempotency keys', () => {
    const a = sessionAwards(facts);
    const b = sessionAwards(facts);
    expect(a).toEqual(b);
    expect(a.xp.map((x) => x.idempotencyKey)).toEqual([
      'session_completed:s1:xp-v1',
      'pr_session:s1:xp-v1',
      'streak_milestone:3:2026-10-05:xp-v1',
    ]);
    expect(a.xp[0]!.amount).toBe(XP_CONFIG.session.completed_as_planned);
    // PR XP is one flat bonus per session, separate from session XP
    expect(a.xp.filter((x) => x.eventType === 'pr_session')).toHaveLength(1);
    expect(a.badges.map((x) => x.badgeKey)).toEqual(['first_session', 'first_pr']);
  });

  it('adapted completions earn less than planned but more than partial; nothing for cancelled', () => {
    const amt = (
      status: typeof facts.status | 'completed_adapted' | 'partially_completed' | 'cancelled',
    ) =>
      sessionAwards({
        ...facts,
        status: status as never,
        prCount: 0,
        streak: { current: 0, startedOn: null },
      }).xp[0]?.amount ?? 0;
    expect(amt('completed_adapted')).toBeLessThan(amt('completed_as_planned'));
    expect(amt('partially_completed')).toBeLessThan(amt('completed_adapted'));
    expect(amt('cancelled')).toBe(0);
  });

  it('XP does not scale with volume (no inputs for sets, reps or duration)', () => {
    expect(Object.keys(facts)).not.toContain('sets');
  });

  it('levels grow linearly', () => {
    expect(levelFor(0).level).toBe(1);
    expect(levelFor(149).level).toBe(1);
    expect(levelFor(150).level).toBe(2);
    expect(levelFor(450)).toMatchObject({ level: 3, xpIntoLevel: 0, xpForNext: 450 });
  });
});
