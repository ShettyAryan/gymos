import {
  getExerciseMap,
  saveCustomExercise,
  deleteCustomExercise,
} from '@/data/local/repositories/exercises';
import {
  addDay,
  addExerciseToDay,
  approveProgramme,
  createProgramme,
  getActiveProgramme,
  getProgrammeDetail,
  listVersions,
  moveProgrammeExercise,
  ProgrammeValidationError,
  removeProgrammeExercise,
  updateProgrammeExercise,
  validateProgrammeById,
} from '@/data/local/repositories/programmes';
import { validateProgramme } from '@/domain/validation/programme';

import { freshDb, type TestDb } from '../helpers/nodeDb';

async function legDayProgramme(db: TestDb) {
  const p = await createProgramme(db, { name: 'Lower / Upper' });
  const legs = await addDay(db, p.id, { title: 'Legs', weekday: 1, intended_minutes: 60 });
  await addExerciseToDay(db, legs.id, 'back_squat');
  await addExerciseToDay(db, legs.id, 'romanian_deadlift');
  await addExerciseToDay(db, legs.id, 'leg_extension', { priority: 'accessory' });
  return { p, legs };
}

describe('programme drafts and approval', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await freshDb();
  });
  afterEach(() => db.close());

  it('new programmes are drafts and not active until approved', async () => {
    const { p } = await legDayProgramme(db);
    expect(p.status).toBe('draft');
    expect(await getActiveProgramme(db)).toBeNull();
    const v = await approveProgramme(db, p.id);
    expect(v.version_number).toBe(1);
    const active = await getActiveProgramme(db);
    expect(active?.programme.id).toBe(p.id);
    expect(active?.version.snapshot.days[0]?.exercises.map((e) => e.exerciseId)).toEqual([
      'back_squat',
      'romanian_deadlift',
      'leg_extension',
    ]);
    expect(active?.programme.has_unapproved_changes).toBe(false);
  });

  it('blocks approval when validation fails (empty day, bad rep range)', async () => {
    const p = await createProgramme(db, { name: 'Broken' });
    const d = await addDay(db, p.id, { title: 'Day A', weekday: 2, intended_minutes: 45 });
    await expect(approveProgramme(db, p.id)).rejects.toBeInstanceOf(ProgrammeValidationError);
    const pe = await addExerciseToDay(db, d.id, 'push_up');
    await updateProgrammeExercise(db, pe.id, { rep_min: 12, rep_max: 8 });
    const issues = await validateProgrammeById(db, p.id);
    expect(issues.some((i) => i.level === 'error' && /reps/.test(i.message))).toBe(true);
    expect(await getActiveProgramme(db)).toBeNull();
  });

  it('editing an approved programme does not change the active snapshot until re-approved', async () => {
    const { p, legs } = await legDayProgramme(db);
    const v1 = await approveProgramme(db, p.id);
    const detail = await getProgrammeDetail(db, p.id);
    const squat = detail!.days[0]!.exercises[0]!;
    await updateProgrammeExercise(db, squat.id, { sets: 5 });
    await addExerciseToDay(db, legs.id, 'calf_raise');

    let active = await getActiveProgramme(db);
    expect(active?.version.id).toBe(v1.id);
    expect(active?.programme.has_unapproved_changes).toBe(true);
    expect(active?.version.snapshot.days[0]?.exercises[0]?.sets).toBe(3);
    expect(active?.version.snapshot.days[0]?.exercises).toHaveLength(3);

    const v2 = await approveProgramme(db, p.id, { changeSummary: 'More squat volume' });
    expect(v2.version_number).toBe(2);
    active = await getActiveProgramme(db);
    expect(active?.version.snapshot.days[0]?.exercises[0]?.sets).toBe(5);
    // v1 is preserved unchanged for historic sessions
    const versions = await listVersions(db, p.id);
    expect(versions.map((v) => v.version_number)).toEqual([2, 1]);
    expect(versions[1]!.snapshot.days[0]!.exercises[0]!.sets).toBe(3);
  });

  it('activating a second programme archives the first (one active programme)', async () => {
    const { p } = await legDayProgramme(db);
    await approveProgramme(db, p.id);
    const q = await createProgramme(db, { name: 'Full body' });
    const d = await addDay(db, q.id, { title: 'Full body', weekday: 3, intended_minutes: 50 });
    await addExerciseToDay(db, d.id, 'goblet_squat');
    await approveProgramme(db, q.id);
    const active = await getActiveProgramme(db);
    expect(active?.programme.id).toBe(q.id);
    expect((await getProgrammeDetail(db, p.id))?.programme.status).toBe('archived');
  });

  it('reorders and removes exercises', async () => {
    const { p } = await legDayProgramme(db);
    let detail = await getProgrammeDetail(db, p.id);
    const [a, b] = detail!.days[0]!.exercises;
    await moveProgrammeExercise(db, b!.id, -1);
    detail = await getProgrammeDetail(db, p.id);
    expect(detail!.days[0]!.exercises.map((e) => e.exercise_id).slice(0, 2)).toEqual([
      'romanian_deadlift',
      'back_squat',
    ]);
    await removeProgrammeExercise(db, a!.id);
    detail = await getProgrammeDetail(db, p.id);
    expect(detail!.days[0]!.exercises.map((e) => e.exercise_id)).toEqual([
      'romanian_deadlift',
      'leg_extension',
    ]);
  });

  it('flags a deleted custom exercise and duplicate weekdays', async () => {
    const custom = await saveCustomExercise(db, {
      name: 'Sled Push',
      movement_pattern: 'conditioning',
      primary_muscles: ['quads'],
      secondary_muscles: [],
      equipment: [],
      logging_type: 'distance',
      instructions: '',
      default_rest_seconds: 90,
      alternatives: [],
      caution: null,
      load_increment_kg: null,
    });
    const p = await createProgramme(db, { name: 'X' });
    const d1 = await addDay(db, p.id, { title: 'A', weekday: 1, intended_minutes: 30 });
    await addDay(db, p.id, { title: 'B', weekday: 1, intended_minutes: 30 });
    await addExerciseToDay(db, d1.id, custom.id);
    await deleteCustomExercise(db, custom.id);
    const issues = await validateProgrammeById(db, p.id);
    const messages = issues
      .filter((i) => i.level === 'error')
      .map((i) => i.message)
      .join('\n');
    expect(messages).toMatch(/no longer exists/);
    expect(messages).toMatch(/same weekday/);
    expect(messages).toMatch(/B has no exercises/);
  });

  it('warns about avoided movement patterns and high volume', async () => {
    const { p } = await legDayProgramme(db);
    const detail = (await getProgrammeDetail(db, p.id))!;
    for (const pe of detail.days[0]!.exercises)
      await updateProgrammeExercise(db, pe.id, { sets: 8 });
    await addExerciseToDay(db, detail.days[0]!.day.id, 'leg_press', { sets: 8 });
    const fresh = (await getProgrammeDetail(db, p.id))!;
    const issues = validateProgramme(fresh, await getExerciseMap(db), { avoidPatterns: ['hinge'] });
    expect(issues.some((i) => i.level === 'warning' && /avoid/.test(i.message))).toBe(true);
    expect(issues.some((i) => i.level === 'warning' && /working sets/.test(i.message))).toBe(true);
    expect(issues.some((i) => i.level === 'warning' && /estimated/.test(i.message))).toBe(true);
  });
});
