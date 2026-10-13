import { getStreak } from '@/data/local/repositories/attendance';
import { listExercises, saveCustomExercise } from '@/data/local/repositories/exercises';
import { migration001 } from '@/data/local/migrations/001_initial';
import { LATEST_SCHEMA_VERSION, runMigrations } from '@/data/local/migrations';
import {
  addDay,
  addExerciseToDay,
  approveProgramme,
  createProgramme,
  getActiveProgramme,
  getProgrammeDetail,
  toggleProgrammeSuperset,
} from '@/data/local/repositories/programmes';
import {
  addExerciseToSession,
  finishSession,
  getPreviousPerformance,
  getSessionDetail,
  logSet,
  setExerciseFinished,
  startSession,
  substituteExercise,
  toggleSessionSuperset,
  undoSubstitution,
} from '@/data/local/repositories/workouts';
import { seedIfNeeded } from '@/data/local/seed';
import { SEED_EXERCISES } from '@/data/local/seed/exercises';
import type { SetValues } from '@/domain/validation/set';
import { resetClock, setClock } from '@/utils/clock';
import { toDateKey } from '@/utils/dates';

import { freshDb, openTestDb, type TestDb } from '../helpers/nodeDb';

const v = (load: number | null, reps: number, extra: Partial<SetValues> = {}): SetValues => ({
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
const tick = (days: number) => {
  clock = new Date(clock.getTime() + days * 86_400_000);
};

describe('schema v2 upgrade and library v2', () => {
  it('upgrades a v1 database in place without losing sets', async () => {
    const db = openTestDb();
    await db.exec(migration001);
    await db.exec('PRAGMA user_version = 1');
    await db.run(
      `INSERT INTO workout_set (id, workout_exercise_id, session_id, exercise_id, set_order, load_kg, reps, is_warmup, completed_at, created_at, updated_at)
       VALUES ('s1','we1','sess1','bench_press',0,80,5,0,'t','t','t')`,
    );
    expect(await runMigrations(db)).toEqual({ from: 1, to: LATEST_SCHEMA_VERSION });
    const row = await db.first<{ load_kg: number; set_kind: string }>(
      'SELECT load_kg, set_kind FROM workout_set',
    );
    expect(row).toEqual({ load_kg: 80, set_kind: 'normal' });
    db.close();
  });

  it('re-seeding to v2 adds the new exercises and keeps custom ones', async () => {
    const db = await freshDb();
    await db.run("DELETE FROM exercise WHERE id IN ('hack_squat','pec_deck')");
    await db.run("UPDATE app_setting SET value = '1' WHERE key = 'seed_version'");
    const custom = await saveCustomExercise(db, {
      name: 'My Sled Push',
      movement_pattern: 'conditioning',
      primary_muscles: ['quads'],
      secondary_muscles: [],
      equipment: [],
      logging_type: 'distance',
      instructions: '',
      default_rest_seconds: 60,
      alternatives: [],
      caution: null,
      load_increment_kg: null,
    });
    expect(await seedIfNeeded(db)).toBe(true);
    const all = await listExercises(db);
    expect(all.length).toBe(SEED_EXERCISES.length + 1);
    expect(all.some((e) => e.id === custom.id)).toBe(true);
    expect(SEED_EXERCISES.length).toBeGreaterThanOrEqual(140);
    db.close();
  });
});

describe('workout logger additions', () => {
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

  async function plannedSession(withSuperset = false) {
    const p = await createProgramme(db, { name: 'Plan' });
    const d = await addDay(db, p.id, {
      title: 'Push',
      weekday: clock.getDay(),
      intended_minutes: 60,
    });
    const a = await addExerciseToDay(db, d.id, 'bench_press', { sets: 2, rep_min: 8, rep_max: 12 });
    await addExerciseToDay(db, d.id, 'cable_fly', { sets: 2, rep_min: 10, rep_max: 15 });
    if (withSuperset) await toggleProgrammeSuperset(db, a.id);
    await approveProgramme(db, p.id);
    const active = (await getActiveProgramme(db))!;
    const day = active.version.snapshot.days[0]!;
    return startSession(db, {
      kind: 'planned',
      programmeId: p.id,
      versionId: active.version.id,
      day,
      plannedDate: toDateKey(clock),
    });
  }

  it('drop sets add volume but do not count toward target sets, history or progression', async () => {
    const s = await plannedSession();
    const [bench, fly] = (await getSessionDetail(db, s.id))!.items;
    await logSet(db, bench!.we.id, v(60, 12));
    await logSet(db, bench!.we.id, v(45, 10, { set_kind: 'drop' }));
    await logSet(db, fly!.we.id, v(15, 15));
    await logSet(db, fly!.we.id, v(15, 15));
    // bench has 1/2 target sets (the drop set doesn't count) → partial, not "as planned"
    const r = await finishSession(db, s.id);
    expect(r.session.status).toBe('partially_completed');
    const prev = await getPreviousPerformance(db, 'bench_press');
    expect(prev?.sets.map((x) => x.load_kg)).toEqual([60]);
    const benchRec = r.recommendations.find((x) => x.exerciseId === 'bench_press')!;
    expect(benchRec.basedOnSetIds).toHaveLength(1);
  });

  it('rejects a set that is both a warm-up and a drop set', async () => {
    const s = await startSession(db, { kind: 'freeform' });
    const we = await addExerciseToSession(db, s.id, 'bench_press');
    await expect(
      logSet(db, we.id, v(40, 5, { is_warmup: true, set_kind: 'drop' })),
    ).rejects.toThrow(/warm-up or a drop set/);
  });

  it('finish exercise marks it done and can be reopened; completion stays honest', async () => {
    const s = await plannedSession();
    const [bench] = (await getSessionDetail(db, s.id))!.items;
    await logSet(db, bench!.we.id, v(60, 10));
    await setExerciseFinished(db, bench!.we.id, true);
    let d = (await getSessionDetail(db, s.id))!;
    expect(d.items[0]!.we.finished_at).toBeTruthy();
    await setExerciseFinished(db, bench!.we.id, false);
    d = (await getSessionDetail(db, s.id))!;
    expect(d.items[0]!.we.finished_at).toBeNull();
  });

  it('a substitution can be undone before any set is logged on the substitute', async () => {
    const s = await plannedSession();
    const [bench] = (await getSessionDetail(db, s.id))!.items;
    await substituteExercise(db, bench!.we.id, 'db_bench_press', 'Bench busy');
    let row = (await getSessionDetail(db, s.id))!.items[0]!.we;
    expect([row.exercise_id, row.disposition]).toEqual(['db_bench_press', 'substituted']);
    await undoSubstitution(db, row.id);
    row = (await getSessionDetail(db, s.id))!.items[0]!.we;
    expect([row.exercise_id, row.disposition, row.replaced_exercise_id]).toEqual([
      'bench_press',
      'included',
      null,
    ]);
  });

  it('cannot undo a substitution after sets were logged on it', async () => {
    const s = await plannedSession();
    const [bench] = (await getSessionDetail(db, s.id))!.items;
    await substituteExercise(db, bench!.we.id, 'db_bench_press', null);
    await logSet(db, bench!.we.id, v(30, 10));
    await expect(undoSubstitution(db, bench!.we.id)).rejects.toThrow(/Delete them first/);
  });

  it('supersets: link with next, unlink dissolves the pair', async () => {
    const s = await startSession(db, { kind: 'freeform' });
    const a = await addExerciseToSession(db, s.id, 'db_curl');
    const b = await addExerciseToSession(db, s.id, 'triceps_pushdown');
    await toggleSessionSuperset(db, a.id);
    let items = (await getSessionDetail(db, s.id))!.items;
    expect(items[0]!.we.superset_group).toBeTruthy();
    expect(items[0]!.we.superset_group).toBe(items[1]!.we.superset_group);
    await toggleSessionSuperset(db, b.id);
    items = (await getSessionDetail(db, s.id))!.items;
    expect(items.map((i) => i.we.superset_group)).toEqual([null, null]);
  });

  it('supersets planned in a programme carry into the session', async () => {
    const s = await plannedSession(true);
    const items = (await getSessionDetail(db, s.id))!.items;
    expect(items[0]!.we.superset_group).toBeTruthy();
    expect(items[0]!.we.superset_group).toBe(items[1]!.we.superset_group);
    const detail = await getProgrammeDetail(db, s.programme_id!);
    expect(detail!.days[0]!.exercises.every((e) => e.superset_group)).toBe(true);
  });

  it('freeform sessions count as training days in the streak (no programme needed)', async () => {
    for (let i = 0; i < 3; i++) {
      const s = await startSession(db, { kind: 'freeform' });
      const we = await addExerciseToSession(db, s.id, 'push_up');
      await logSet(db, we.id, v(null, 10));
      await finishSession(db, s.id);
      tick(1);
    }
    expect((await getStreak(db, toDateKey(clock))).current).toBe(3);
  });

  it('a freeform session on a planned day keeps the streak instead of counting it as missed', async () => {
    const p = await createProgramme(db, { name: 'Daily' });
    for (let wd = 0; wd < 7; wd++) {
      const d = await addDay(db, p.id, { title: `D${wd}`, weekday: wd, intended_minutes: 30 });
      await addExerciseToDay(db, d.id, 'push_up');
    }
    await approveProgramme(db, p.id);
    for (let i = 0; i < 2; i++) {
      const s = await startSession(db, { kind: 'freeform' });
      const we = await addExerciseToSession(db, s.id, 'bodyweight_squat');
      await logSet(db, we.id, v(null, 15));
      await finishSession(db, s.id);
      tick(1);
    }
    expect((await getStreak(db, toDateKey(clock))).current).toBe(2);
  });
});
