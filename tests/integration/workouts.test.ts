import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  getCalendar,
  getStreak,
  recordHabitAction,
  reschedulePlannedDay,
  skipPlannedDay,
} from '@/data/local/repositories/attendance';
import { applyAwards, listBadges, totalXp } from '@/data/local/repositories/awards';
import { getExerciseMap } from '@/data/local/repositories/exercises';
import {
  addDay,
  addExerciseToDay,
  approveProgramme,
  createProgramme,
  getActiveProgramme,
  getVersion,
} from '@/data/local/repositories/programmes';
import {
  ActiveSessionExistsError,
  addExerciseToSession,
  cancelSession,
  deferExercise,
  deleteSet,
  finishSession,
  getActiveSession,
  getExerciseHistory,
  getLatestRecommendation,
  getPreviousPerformance,
  getSessionDetail,
  listPersonalRecords,
  logSet,
  NoSetsLoggedError,
  pauseSession,
  restoreSet,
  resumeSession,
  startSession,
  substituteExercise,
} from '@/data/local/repositories/workouts';
import { proposeAdaptation } from '@/domain/rules/adaptiveDay';
import { sessionAwards } from '@/domain/rules/xp';
import type { SetValues } from '@/domain/validation/set';
import { resetClock, setClock } from '@/utils/clock';
import { toDateKey } from '@/utils/dates';

import { freshDb, type TestDb } from '../helpers/nodeDb';

const v = (
  load: number | null,
  reps: number | null,
  extra: Partial<SetValues> = {},
): SetValues => ({
  load_kg: load,
  reps,
  duration_seconds: null,
  distance_m: null,
  rpe: null,
  rir: null,
  is_warmup: false,
  notes: null,
  ...extra,
});

let clock = new Date('2026-10-05T08:00:00');
const tick = (minutes: number) => {
  clock = new Date(clock.getTime() + minutes * 60_000);
};

async function setupProgramme(db: TestDb) {
  const p = await createProgramme(db, { name: 'Test plan' });
  const weekday = clock.getDay();
  const legs = await addDay(db, p.id, { title: 'Leg Day', weekday, intended_minutes: 60 });
  await addExerciseToDay(db, legs.id, 'back_squat', {
    sets: 3,
    rep_min: 5,
    rep_max: 8,
    priority: 'primary',
  });
  await addExerciseToDay(db, legs.id, 'leg_curl', {
    sets: 2,
    rep_min: 10,
    rep_max: 15,
    priority: 'accessory',
  });
  await approveProgramme(db, p.id);
  const active = (await getActiveProgramme(db))!;
  return {
    programme: active.programme,
    version: active.version,
    day: active.version.snapshot.days[0]!,
  };
}

describe('workout logger', () => {
  let db: TestDb;
  beforeEach(async () => {
    clock = new Date('2026-10-05T08:00:00');
    setClock(() => clock);
    db = await freshDb();
  });
  afterEach(() => {
    db.close();
    resetClock();
  });

  it('planned session: log → finish → completed_as_planned with attendance and XP', async () => {
    const { programme, version, day } = await setupProgramme(db);
    const s = await startSession(db, {
      kind: 'planned',
      programmeId: programme.id,
      versionId: version.id,
      day,
      plannedDate: toDateKey(clock),
    });
    let detail = (await getSessionDetail(db, s.id))!;
    expect(detail.session.original_plan_snapshot?.exercises).toHaveLength(2);
    const [squat, curl] = detail.items;
    await logSet(db, squat!.we.id, v(40, 5, { is_warmup: true }));
    for (let i = 0; i < 3; i++) await logSet(db, squat!.we.id, v(100, 5));
    for (let i = 0; i < 2; i++) await logSet(db, curl!.we.id, v(30, 12));
    tick(45);
    const r = await finishSession(db, s.id);
    expect(r.session.status).toBe('completed_as_planned');
    expect(r.session.actual_duration_seconds).toBe(45 * 60);
    expect(r.prs).toHaveLength(0); // first ever performance is a baseline
    expect(r.recommendations.map((x) => x.decision)).toEqual(['increase_reps', 'increase_reps']);
    expect(await totalXp(db)).toBe(50);
    const cal = await getCalendar(db, toDateKey(clock), toDateKey(clock), toDateKey(clock));
    expect(cal[0]!.occurrences[0]!.outcome).toBe('completed_as_planned');
    expect((await listBadges(db)).map((b) => b.badge_key)).toEqual(['first_session']);
    detail = (await getSessionDetail(db, s.id))!;
    expect(detail.items[0]!.sets).toHaveLength(4);
  });

  it('only one active session; active session survives a simulated force-close/relaunch', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gymos-'));
    const file = path.join(dir, 'gymos.db');
    const a = await freshDb(file);
    const s = await startSession(a, { kind: 'freeform' });
    await expect(startSession(a, { kind: 'freeform' })).rejects.toBeInstanceOf(
      ActiveSessionExistsError,
    );
    const we = await addExerciseToSession(a, s.id, 'push_up');
    await logSet(a, we.id, v(null, 15));
    await logSet(a, we.id, v(null, 12));
    a.raw.close(); // abrupt close — no finish, no cleanup

    const b = await freshDb(file);
    const active = await getActiveSession(b);
    expect(active?.id).toBe(s.id);
    const detail = (await getSessionDetail(b, s.id))!;
    expect(detail.items[0]!.sets.map((x) => x.reps)).toEqual([15, 12]);
    await logSet(b, detail.items[0]!.we.id, v(null, 10));
    const r = await finishSession(b, s.id);
    expect(r.session.status).toBe('completed_as_planned');
    expect(r.session.session_type).toBe('freeform');
    b.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('adapted session keeps the original plan separate and completes as completed_adapted', async () => {
    const { programme, version, day } = await setupProgramme(db);
    const proposal = proposeAdaptation({
      day,
      availableMinutes: 20,
      equipment: ['barbell', 'rack', 'machine'],
      energy: 'normal',
      avoidPatterns: [],
      excludedExerciseIds: [],
      exercises: await getExerciseMap(db),
    });
    expect(proposal.feasible).toBe(true);
    const s = await startSession(db, {
      kind: 'adapted',
      programmeId: programme.id,
      versionId: version.id,
      day,
      plannedDate: toDateKey(clock),
      proposal,
      reason: 'schedule',
      reasonNote: null,
      constraints: { availableMinutes: 20, equipment: [], energy: 'normal' },
    });
    const detail = (await getSessionDetail(db, s.id))!;
    expect(detail.session.session_type).toBe('adapted');
    expect(detail.session.title).toBe('Shortened Leg Day');
    expect(detail.session.original_plan_snapshot).toEqual(day); // untouched copy of the plan
    const deferred = detail.items.filter((i) => i.we.disposition === 'deferred');
    expect(deferred.map((i) => i.we.exercise_id)).toContain('leg_curl');
    const squat = detail.items.find((i) => i.we.exercise_id === 'back_squat')!;
    for (let i = 0; i < squat.we.target!.sets; i++) await logSet(db, squat.we.id, v(100, 6));
    const r = await finishSession(db, s.id);
    expect(r.session.status).toBe('completed_adapted');
    expect(await totalXp(db)).toBe(40);
    const cal = await getCalendar(db, toDateKey(clock), toDateKey(clock), toDateKey(clock));
    expect(cal[0]!.occurrences[0]!.outcome).toBe('completed_adapted');
    // the approved programme version itself is untouched
    expect((await getVersion(db, version.id))!.snapshot).toEqual(version.snapshot);
  });

  it('partial session is labelled partially_completed, not the full plan', async () => {
    const { programme, version, day } = await setupProgramme(db);
    const s = await startSession(db, {
      kind: 'planned',
      programmeId: programme.id,
      versionId: version.id,
      day,
      plannedDate: toDateKey(clock),
    });
    const d = (await getSessionDetail(db, s.id))!;
    await logSet(db, d.items[0]!.we.id, v(100, 5));
    const r = await finishSession(db, s.id);
    expect(r.session.status).toBe('partially_completed');
    expect(await totalXp(db)).toBe(25);
  });

  it('cannot finish with no working sets; can cancel instead (no XP)', async () => {
    const s = await startSession(db, { kind: 'freeform' });
    await expect(finishSession(db, s.id)).rejects.toBeInstanceOf(NoSetsLoggedError);
    await cancelSession(db, s.id);
    expect(await getActiveSession(db)).toBeNull();
    expect(await totalXp(db)).toBe(0);
  });

  it('finishing twice is rejected and never duplicates XP', async () => {
    const s = await startSession(db, { kind: 'freeform' });
    const we = await addExerciseToSession(db, s.id, 'push_up');
    await logSet(db, we.id, v(null, 10));
    await finishSession(db, s.id);
    await expect(finishSession(db, s.id)).rejects.toThrow(/already finished/);
    expect(await totalXp(db)).toBe(25);
  });

  it('replaying award candidates (e.g. after a sync pull) cannot duplicate XP or badges', async () => {
    const facts = {
      sessionId: 'x',
      status: 'completed_as_planned' as const,
      sessionType: 'planned' as const,
      prCount: 1,
      completedSessions: 1,
      adaptedCompletions: 0,
      prSessions: 1,
      streak: { current: 0, startedOn: null },
    };
    const { xp, badges } = sessionAwards(facts);
    const first = await applyAwards(db, xp, badges);
    const second = await applyAwards(db, xp, badges);
    const third = await applyAwards(db, xp, badges);
    expect(first.xp).toHaveLength(2);
    expect(second.xp).toHaveLength(0);
    expect(third.badges).toHaveLength(0);
    expect(await totalXp(db)).toBe(70);
    // the database itself rejects a duplicate key even if application logic were bypassed
    await expect(
      db.run(
        `INSERT INTO xp_event (id, event_type, idempotency_key, amount, rule_version, created_at, updated_at) VALUES ('dup','t','session_completed:x:xp-v1',50,'xp-v1','t','t')`,
      ),
    ).rejects.toThrow(/UNIQUE/);
  });

  it('detects PRs against prior sessions and shows previous performance', async () => {
    const s1 = await startSession(db, { kind: 'freeform' });
    const w1 = await addExerciseToSession(db, s1.id, 'bench_press');
    await logSet(db, w1.id, v(80, 5));
    await finishSession(db, s1.id);
    tick(60 * 24 * 2);
    const s2 = await startSession(db, { kind: 'freeform' });
    const w2 = await addExerciseToSession(db, s2.id, 'bench_press');
    const prev = await getPreviousPerformance(db, 'bench_press', s2.id);
    expect(prev?.sets.map((x) => [x.load_kg, x.reps])).toEqual([[80, 5]]);
    await logSet(db, w2.id, v(82.5, 5));
    const r = await finishSession(db, s2.id);
    expect(r.prs.map((p) => p.recordType).sort()).toEqual(['e1rm', 'max_load']);
    expect(await listPersonalRecords(db, 'bench_press')).toHaveLength(2);
    expect(await getExerciseHistory(db, 'bench_press')).toHaveLength(2);
    expect(await totalXp(db)).toBe(25 + 25 + 20);
  });

  it('progression recommendation is stored with its rule version and is not auto-applied', async () => {
    const { programme, version, day } = await setupProgramme(db);
    const s = await startSession(db, {
      kind: 'planned',
      programmeId: programme.id,
      versionId: version.id,
      day,
      plannedDate: toDateKey(clock),
    });
    const d = (await getSessionDetail(db, s.id))!;
    for (let i = 0; i < 3; i++) await logSet(db, d.items[0]!.we.id, v(100, 8));
    await finishSession(db, s.id);
    const rec = await getLatestRecommendation(db, 'back_squat');
    expect(rec).toMatchObject({
      decision: 'increase_load',
      rule_version: 'progression-v1',
      status: 'pending',
    });
    expect(rec!.suggestion.loadKg).toBe(102.5);
    // programme prescription unchanged
    expect((await getActiveProgramme(db))!.version.snapshot.days[0]!.exercises[0]!.sets).toBe(3);
  });

  it('substitution mid-session after sets were logged keeps logged work on the original exercise', async () => {
    const { programme, version, day } = await setupProgramme(db);
    const s = await startSession(db, {
      kind: 'planned',
      programmeId: programme.id,
      versionId: version.id,
      day,
      plannedDate: toDateKey(clock),
    });
    let d = (await getSessionDetail(db, s.id))!;
    await logSet(db, d.items[0]!.we.id, v(100, 5));
    await substituteExercise(db, d.items[0]!.we.id, 'leg_press', 'Rack busy');
    d = (await getSessionDetail(db, s.id))!;
    expect(d.items.map((i) => [i.we.exercise_id, i.we.disposition, i.we.target?.sets])).toEqual([
      ['back_squat', 'included', 1],
      ['leg_press', 'substituted', 2],
      ['leg_curl', 'included', 2],
    ]);
    await deferExercise(db, d.items[2]!.we.id, null);
    await logSet(db, d.items[1]!.we.id, v(150, 10));
    await logSet(db, d.items[1]!.we.id, v(150, 10));
    const r = await finishSession(db, s.id);
    expect(r.session.status).toBe('completed_adapted');
  });

  it('delete + undo restores a set', async () => {
    const s = await startSession(db, { kind: 'freeform' });
    const we = await addExerciseToSession(db, s.id, 'push_up');
    const set = await logSet(db, we.id, v(null, 10));
    await deleteSet(db, set.id);
    expect((await getSessionDetail(db, s.id))!.items[0]!.sets).toHaveLength(0);
    await restoreSet(db, set.id);
    expect((await getSessionDetail(db, s.id))!.items[0]!.sets).toHaveLength(1);
  });

  it('pause time is excluded from duration', async () => {
    const s = await startSession(db, { kind: 'freeform' });
    const we = await addExerciseToSession(db, s.id, 'push_up');
    await logSet(db, we.id, v(null, 10));
    tick(10);
    await pauseSession(db, s.id);
    tick(30);
    await resumeSession(db, s.id);
    tick(5);
    const r = await finishSession(db, s.id);
    expect(r.session.actual_duration_seconds).toBe(15 * 60);
  });

  it('rejects implausible or incomplete sets', async () => {
    const s = await startSession(db, { kind: 'freeform' });
    const we = await addExerciseToSession(db, s.id, 'bench_press');
    await expect(logSet(db, we.id, v(null, 5))).rejects.toThrow(/load/);
    await expect(logSet(db, we.id, v(5000, 5))).rejects.toThrow();
    await expect(logSet(db, we.id, v(60, 5, { rpe: 11 }))).rejects.toThrow();
  });

  it('habit action is not a workout and earns a small fixed XP once per day', async () => {
    const { version, day } = await setupProgramme(db);
    await recordHabitAction(db, {
      date: toDateKey(clock),
      plannedDayId: day.id,
      versionId: version.id,
      action: 'Planned next session',
    });
    await recordHabitAction(db, {
      date: toDateKey(clock),
      plannedDayId: null,
      versionId: null,
      action: 'Prepared gear',
    });
    expect(await totalXp(db)).toBe(5);
    expect(await getActiveSession(db)).toBeNull();
    const cal = await getCalendar(db, toDateKey(clock), toDateKey(clock), toDateKey(clock));
    expect(cal[0]!.occurrences[0]!.outcome).toBe('habit_action');
    expect((await getStreak(db, toDateKey(clock))).current).toBe(0);
  });

  it('reschedule and excused skip do not break the streak', async () => {
    const { version, day } = await setupProgramme(db);
    const d0 = toDateKey(clock);
    await skipPlannedDay(db, {
      date: d0,
      plannedDayId: day.id,
      versionId: version.id,
      reason: 'illness',
    });
    tick(60 * 24 * 7);
    const d1 = toDateKey(clock);
    await reschedulePlannedDay(db, {
      date: d1,
      plannedDayId: day.id,
      versionId: version.id,
      to: toDateKey(new Date(clock.getTime() + 86_400_000)),
    });
    const streak = await getStreak(db, d1);
    expect(streak.current).toBe(0);
    const cal = await getCalendar(db, d0, toDateKey(new Date(clock.getTime() + 86_400_000)), d1);
    expect(cal.flatMap((c) => c.occurrences).map((o) => o.outcome)).toEqual([
      'excused',
      'rescheduled',
      'upcoming',
    ]);
  });
});
