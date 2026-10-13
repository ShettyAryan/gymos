import { addMonths, monthGrid, monthStart } from '@/components/MonthCalendar';
import {
  exerciseTrends,
  muscleVolume,
  readinessFrom,
  volumeStatus,
  weeklySeries,
  type InsightExercise,
  type InsightSet,
} from '@/domain/rules/insights';
import { computeStreak, type CalendarDay } from '@/domain/rules/schedule';

const ex = (
  id: string,
  primary: InsightExercise['primary_muscles'],
  secondary: InsightExercise['secondary_muscles'] = [],
): InsightExercise => ({
  id,
  name: id,
  movement_pattern: 'horizontal_push',
  primary_muscles: primary,
  secondary_muscles: secondary,
  logging_type: 'weight_reps',
  load_increment_kg: 2.5,
});
const EX = new Map([
  ['bench', ex('bench', ['chest'], ['triceps', 'shoulders'])],
  ['curl', ex('curl', ['biceps'])],
]);

const set = (
  exerciseId: string,
  date: string,
  load: number,
  reps: number,
  extra: Partial<InsightSet> = {},
): InsightSet => ({
  sessionId: `s-${exerciseId}-${date}`,
  exerciseId,
  date,
  load_kg: load,
  reps,
  is_warmup: false,
  set_kind: 'normal',
  rpe: null,
  rir: null,
  ...extra,
});

describe('volumeStatus', () => {
  it.each([
    [0, 'none'],
    [5, 'under'],
    [8, 'low'],
    [10, 'good'],
    [20, 'good'],
    [24, 'high'],
    [30, 'very_high'],
  ] as const)('%d sets/week → %s for a 10–20 range', (w, s) => {
    expect(volumeStatus(w, [10, 20])).toBe(s);
  });
});

describe('muscleVolume', () => {
  it('counts primary as 1 set and secondary as ½, ignores warm-ups, includes drop sets', () => {
    const sets = [
      set('bench', '2026-10-12', 60, 10),
      set('bench', '2026-10-12', 60, 10),
      set('bench', '2026-10-12', 40, 10, { is_warmup: true }),
      set('bench', '2026-10-12', 45, 12, { set_kind: 'drop' }),
    ];
    const { rows, weeksAnalysed, earlyData } = muscleVolume(sets, EX, '2026-10-13', [
      'hypertrophy',
    ]);
    const get = (m: string) => rows.find((r) => r.muscle === m)!;
    expect(weeksAnalysed).toBe(1); // a new user isn't averaged over 4 empty weeks
    expect(earlyData).toBe(true);
    expect(get('chest').weeklySets).toBe(3);
    expect(get('triceps').weeklySets).toBe(1.5);
    expect(get('chest').status).toBe('under');
    expect(get('quads').status).toBe('none');
  });

  it('uses the strength range when the goal is strength', () => {
    const { rows } = muscleVolume([set('curl', '2026-10-13', 10, 10)], EX, '2026-10-13', [
      'strength',
    ]);
    expect(rows[0]!.range).toEqual([6, 15]);
  });
});

describe('exerciseTrends', () => {
  it('needs 3 sessions before calling a trend, then reports improvement and stalls', () => {
    const dates = ['2026-09-01', '2026-09-04', '2026-09-08', '2026-09-11', '2026-09-15'];
    const loads = [60, 62.5, 65, 67.5, 70];
    const rising = dates.map((d, i) => set('bench', d, loads[i]!, 5));
    expect(exerciseTrends(rising.slice(0, 2), EX)[0]!.trend).toBe('new');
    const t = exerciseTrends(rising, EX)[0]!;
    expect(t.trend).toBe('improving');
    expect(t.stalledSessions).toBe(0);

    const flat = dates.map((d) => set('bench', d, 60, 5));
    const f = exerciseTrends(flat, EX)[0]!;
    expect(f.trend).toBe('flat');
    expect(f.stalledSessions).toBe(4);
  });

  it('ignores drop sets and warm-ups when estimating strength', () => {
    const dates = ['2026-09-01', '2026-09-04', '2026-09-08'];
    const sets = dates.flatMap((d) => [
      set('bench', d, 60, 5),
      set('bench', d, 100, 5, { is_warmup: true }),
      set('bench', d, 100, 5, { set_kind: 'drop' }),
    ]);
    expect(exerciseTrends(sets, EX)[0]!.trend).toBe('flat');
  });
});

describe('readinessFrom', () => {
  it('orders ready-to-increase first and keeps the current load for the delta', () => {
    const r = readinessFrom(
      [
        { exerciseId: 'curl', decision: 'repeat_target', loadKg: 12, rationale: 'x' },
        { exerciseId: 'bench', decision: 'increase_load', loadKg: 62.5, rationale: 'y' },
        { exerciseId: 'unknown', decision: 'increase_load', loadKg: 1, rationale: 'z' },
      ],
      new Map([['bench', 60]]),
      EX,
    );
    expect(r.map((x) => x.exerciseId)).toEqual(['bench', 'curl']);
    expect([r[0]!.currentLoadKg, r[0]!.nextLoadKg]).toEqual([60, 62.5]);
  });
});

describe('weeklySeries', () => {
  it('buckets sessions, working sets and volume into Monday-start weeks', () => {
    const pts = weeklySeries(
      [
        { id: 'a', date: '2026-10-12' },
        { id: 'b', date: '2026-10-05' },
      ],
      [
        set('bench', '2026-10-12', 50, 10),
        set('bench', '2026-10-12', 20, 10, { is_warmup: true }),
        set('curl', '2026-10-06', 10, 10),
      ],
      '2026-10-13',
      3,
    );
    expect(pts.map((p) => p.weekStart)).toEqual(['2026-09-28', '2026-10-05', '2026-10-12']);
    expect(pts.map((p) => p.sessions)).toEqual([0, 1, 1]);
    expect(pts.map((p) => p.sets)).toEqual([0, 1, 1]);
    expect(pts.map((p) => p.volumeKg)).toEqual([0, 100, 500]);
  });
});

describe('training-day streak', () => {
  const day = (date: string, d: Partial<CalendarDay> = {}): CalendarDay => ({
    date,
    occurrences: [],
    rest: true,
    extraSessions: 0,
    habitAction: false,
    ...d,
  });
  const missed = (date: string): CalendarDay =>
    day(date, {
      rest: false,
      occurrences: [
        {
          date,
          dayId: 'd',
          title: 'Push',
          versionId: 'v',
          rescheduledFrom: null,
          outcome: 'missed',
          sessionId: null,
        },
      ],
    });

  it('freeform-only days build a streak and rest days are neutral', () => {
    const s = computeStreak([
      day('2026-10-10', { extraSessions: 1 }),
      day('2026-10-11'),
      day('2026-10-12', { extraSessions: 2 }),
    ]);
    expect(s.current).toBe(2);
    expect(s.currentStartedOn).toBe('2026-10-10');
  });

  it('a freeform session on a missed planned day still counts; a bare miss resets', () => {
    expect(
      computeStreak([
        day('2026-10-11', { extraSessions: 1 }),
        { ...missed('2026-10-12'), extraSessions: 1 },
      ]).current,
    ).toBe(2);
    expect(
      computeStreak([day('2026-10-11', { extraSessions: 1 }), missed('2026-10-12')]).current,
    ).toBe(0);
  });
});

describe('monthGrid', () => {
  it('is Monday-first and only includes days of the month', () => {
    const g = monthGrid('2026-10-13'); // 1 Oct 2026 is a Thursday
    expect(g[0]).toEqual([
      null,
      null,
      null,
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ]);
    expect(g.flat().filter(Boolean)).toHaveLength(31);
    expect(g.every((w) => w.length === 7)).toBe(true);
  });

  it('handles month arithmetic across years', () => {
    expect(monthStart('2026-12-25')).toBe('2026-12-01');
    expect(addMonths('2026-12-01', 1)).toBe('2027-01-01');
    expect(addMonths('2026-01-01', -1)).toBe('2025-12-01');
    expect(monthGrid('2027-02-01').flat().filter(Boolean)).toHaveLength(28);
  });
});
