import type { MovementPattern, Priority } from '@/domain/models/constants';
import type {
  DaySnapshot,
  Exercise,
  Programme,
  ProgrammeDay,
  ProgrammeExercise,
  ProgrammeSnapshot,
  ProgrammeVersion,
} from '@/domain/models/types';
import { hasErrors, validateProgramme, type Issue } from '@/domain/validation/programme';
import { nowIso } from '@/utils/clock';

import type { SqlDb } from '../db';
import { getEntity, patchEntity, queryEntities, saveEntity, softDelete } from '../store';

import { getExerciseMap } from './exercises';

export type ProgrammeDetail = {
  programme: Programme;
  days: { day: ProgrammeDay; exercises: ProgrammeExercise[] }[];
};

export function listProgrammes(db: SqlDb): Promise<Programme[]> {
  return queryEntities<Programme>(
    db,
    'programme',
    'deleted_at IS NULL',
    [],
    "CASE status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, updated_at DESC",
  );
}

export async function getProgrammeDetail(db: SqlDb, id: string): Promise<ProgrammeDetail | null> {
  const programme = await getEntity<Programme>(db, 'programme', id);
  if (!programme || programme.deleted_at) return null;
  const days = await queryEntities<ProgrammeDay>(
    db,
    'programme_day',
    'programme_id = ? AND deleted_at IS NULL',
    [id],
    'day_order',
  );
  const out: ProgrammeDetail['days'] = [];
  for (const day of days) {
    const exercises = await queryEntities<ProgrammeExercise>(
      db,
      'programme_exercise',
      'programme_day_id = ? AND deleted_at IS NULL',
      [day.id],
      'ex_order',
    );
    out.push({ day, exercises });
  }
  return { programme, days: out };
}

/** Marks the working copy as differing from the approved snapshot. */
async function touch(db: SqlDb, programmeId: string): Promise<void> {
  const p = await getEntity<Programme>(db, 'programme', programmeId);
  if (p && !p.has_unapproved_changes)
    await patchEntity<Programme>(db, 'programme', programmeId, { has_unapproved_changes: true });
}

export function createProgramme(
  db: SqlDb,
  input: {
    name: string;
    source?: 'manual' | 'ai';
    goal?: string | null;
    rationale?: string | null;
    ai_model?: string | null;
    ai_prompt_version?: string | null;
  },
): Promise<Programme> {
  return saveEntity<Programme>(db, 'programme', {
    name: input.name.trim() || 'Untitled programme',
    status: 'draft',
    source: input.source ?? 'manual',
    goal: input.goal ?? null,
    rationale: input.rationale ?? null,
    ai_model: input.ai_model ?? null,
    ai_prompt_version: input.ai_prompt_version ?? null,
    active_version_id: null,
    has_unapproved_changes: true,
  });
}

export async function renameProgramme(db: SqlDb, id: string, name: string): Promise<void> {
  await db.transaction(async (tx) => {
    await patchEntity<Programme>(tx, 'programme', id, {
      name: name.trim() || 'Untitled programme',
    });
    await touch(tx, id);
  });
}

export async function addDay(
  db: SqlDb,
  programmeId: string,
  input: { title: string; weekday: number | null; intended_minutes: number; focus?: string | null },
): Promise<ProgrammeDay> {
  return db.transaction(async (tx) => {
    const max = await tx.first<{ m: number | null }>(
      'SELECT MAX(day_order) AS m FROM programme_day WHERE programme_id = ? AND deleted_at IS NULL',
      [programmeId],
    );
    const day = await saveEntity<ProgrammeDay>(tx, 'programme_day', {
      programme_id: programmeId,
      day_order: (max?.m ?? -1) + 1,
      title: input.title.trim(),
      weekday: input.weekday,
      intended_minutes: input.intended_minutes,
      focus: input.focus ?? null,
      notes: null,
    });
    await touch(tx, programmeId);
    return day;
  });
}

export async function updateDay(
  db: SqlDb,
  dayId: string,
  patch: Partial<Pick<ProgrammeDay, 'title' | 'weekday' | 'intended_minutes' | 'focus' | 'notes'>>,
): Promise<void> {
  await db.transaction(async (tx) => {
    const day = await patchEntity<ProgrammeDay>(tx, 'programme_day', dayId, patch);
    await touch(tx, day.programme_id);
  });
}

export async function deleteDay(db: SqlDb, dayId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const day = await getEntity<ProgrammeDay>(tx, 'programme_day', dayId);
    if (!day) return;
    const items = await queryEntities<ProgrammeExercise>(
      tx,
      'programme_exercise',
      'programme_day_id = ? AND deleted_at IS NULL',
      [dayId],
    );
    for (const it of items) await softDelete(tx, 'programme_exercise', it.id);
    await softDelete(tx, 'programme_day', dayId);
    await touch(tx, day.programme_id);
  });
}

export async function moveDay(db: SqlDb, dayId: string, direction: -1 | 1): Promise<void> {
  await db.transaction(async (tx) => {
    const day = await getEntity<ProgrammeDay>(tx, 'programme_day', dayId);
    if (!day) return;
    const days = await queryEntities<ProgrammeDay>(
      tx,
      'programme_day',
      'programme_id = ? AND deleted_at IS NULL',
      [day.programme_id],
      'day_order',
    );
    await swapOrder(tx, 'programme_day', 'day_order', days, dayId, direction);
    await touch(tx, day.programme_id);
  });
}

async function swapOrder<T extends { id: string }>(
  db: SqlDb,
  type: 'programme_day' | 'programme_exercise',
  field: 'day_order' | 'ex_order',
  list: T[],
  id: string,
  direction: -1 | 1,
): Promise<void> {
  const i = list.findIndex((x) => x.id === id);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= list.length) return;
  const reordered = [...list];
  [reordered[i], reordered[j]] = [reordered[j]!, reordered[i]!];
  for (let k = 0; k < reordered.length; k++) {
    const item = reordered[k]! as T & Record<string, unknown>;
    if (item[field] !== k) await patchEntity(db, type, item.id, { [field]: k } as never);
  }
}

export type PrescriptionInput = {
  sets: number;
  rep_min: number;
  rep_max: number;
  rest_seconds: number;
  target_rir: number | null;
  priority: Priority;
  alternative_ids: string[];
  notes: string | null;
};

export function defaultPrescription(
  ex: Exercise,
  priority: Priority = 'secondary',
): PrescriptionInput {
  const timed = ex.logging_type === 'duration' || ex.logging_type === 'hold';
  const isCompound = [
    'squat',
    'hinge',
    'horizontal_push',
    'vertical_push',
    'horizontal_pull',
    'vertical_pull',
  ].includes(ex.movement_pattern);
  return {
    sets: 3,
    rep_min: timed ? 30 : ex.logging_type === 'distance' ? 1 : isCompound ? 6 : 10,
    rep_max: timed ? 45 : ex.logging_type === 'distance' ? 1 : isCompound ? 10 : 15,
    rest_seconds: ex.default_rest_seconds,
    target_rir: null,
    priority,
    alternative_ids: ex.alternatives.slice(0, 3),
    notes: null,
  };
}

export async function addExerciseToDay(
  db: SqlDb,
  dayId: string,
  exerciseId: string,
  prescription?: Partial<PrescriptionInput>,
): Promise<ProgrammeExercise> {
  return db.transaction(async (tx) => {
    const day = await getEntity<ProgrammeDay>(tx, 'programme_day', dayId);
    if (!day || day.deleted_at) throw new Error('Training day not found.');
    const ex = await getEntity<Exercise>(tx, 'exercise', exerciseId);
    if (!ex || ex.deleted_at) throw new Error('Exercise not found.');
    const max = await tx.first<{ m: number | null }>(
      'SELECT MAX(ex_order) AS m FROM programme_exercise WHERE programme_day_id = ? AND deleted_at IS NULL',
      [dayId],
    );
    const order = (max?.m ?? -1) + 1;
    const pe = await saveEntity<ProgrammeExercise>(tx, 'programme_exercise', {
      programme_day_id: dayId,
      exercise_id: exerciseId,
      ex_order: order,
      ...defaultPrescription(ex, order === 0 ? 'primary' : 'secondary'),
      ...prescription,
    });
    await touch(tx, day.programme_id);
    return pe;
  });
}

async function dayOfItem(db: SqlDb, itemId: string) {
  const pe = await getEntity<ProgrammeExercise>(db, 'programme_exercise', itemId);
  if (!pe) throw new Error('Programme exercise not found.');
  const day = await getEntity<ProgrammeDay>(db, 'programme_day', pe.programme_day_id);
  return { pe, day: day! };
}

export async function updateProgrammeExercise(
  db: SqlDb,
  itemId: string,
  patch: Partial<PrescriptionInput> & { exercise_id?: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const { day } = await dayOfItem(tx, itemId);
    await patchEntity<ProgrammeExercise>(tx, 'programme_exercise', itemId, patch);
    await touch(tx, day.programme_id);
  });
}

export async function removeProgrammeExercise(db: SqlDb, itemId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const { day } = await dayOfItem(tx, itemId);
    await softDelete(tx, 'programme_exercise', itemId);
    await touch(tx, day.programme_id);
  });
}

export async function moveProgrammeExercise(
  db: SqlDb,
  itemId: string,
  direction: -1 | 1,
): Promise<void> {
  await db.transaction(async (tx) => {
    const { pe, day } = await dayOfItem(tx, itemId);
    const items = await queryEntities<ProgrammeExercise>(
      tx,
      'programme_exercise',
      'programme_day_id = ? AND deleted_at IS NULL',
      [pe.programme_day_id],
      'ex_order',
    );
    await swapOrder(tx, 'programme_exercise', 'ex_order', items, itemId, direction);
    await touch(tx, day.programme_id);
  });
}

export async function validateProgrammeById(
  db: SqlDb,
  id: string,
  avoidPatterns: MovementPattern[] = [],
): Promise<Issue[]> {
  const detail = await getProgrammeDetail(db, id);
  if (!detail) return [{ level: 'error', message: 'Programme not found.' }];
  return validateProgramme(detail, await getExerciseMap(db), { avoidPatterns });
}

export function buildSnapshot(
  detail: ProgrammeDetail,
  exercises: Map<string, Exercise>,
  versionNumber: number,
): ProgrammeSnapshot {
  return {
    programmeId: detail.programme.id,
    name: detail.programme.name,
    versionNumber,
    days: detail.days.map(({ day, exercises: items }): DaySnapshot => ({
      id: day.id,
      title: day.title,
      dayOrder: day.day_order,
      weekday: day.weekday,
      intendedMinutes: day.intended_minutes,
      focus: day.focus,
      exercises: items.map((pe) => ({
        programmeExerciseId: pe.id,
        exerciseId: pe.exercise_id,
        exerciseName: exercises.get(pe.exercise_id)?.name ?? 'Unknown exercise',
        order: pe.ex_order,
        sets: pe.sets,
        repMin: pe.rep_min,
        repMax: pe.rep_max,
        restSeconds: pe.rest_seconds,
        targetRir: pe.target_rir,
        priority: pe.priority,
        alternativeIds: pe.alternative_ids.filter((a) => exercises.has(a)),
        notes: pe.notes,
      })),
    })),
  };
}

/**
 * Explicit user approval: validates, freezes an immutable snapshot as a new version, and activates
 * this programme (archiving any other active programme). Sessions reference the version, so later
 * edits never rewrite history.
 */
export async function approveProgramme(
  db: SqlDb,
  id: string,
  opts: { changeSummary?: string | null; avoidPatterns?: MovementPattern[] } = {},
): Promise<ProgrammeVersion> {
  return db.transaction(async (tx) => {
    const detail = await getProgrammeDetail(tx, id);
    if (!detail) throw new Error('Programme not found.');
    const exercises = await getExerciseMap(tx);
    const issues = validateProgramme(detail, exercises, {
      avoidPatterns: opts.avoidPatterns ?? [],
    });
    if (hasErrors(issues)) {
      throw new ProgrammeValidationError(issues.filter((i) => i.level === 'error'));
    }
    const max = await tx.first<{ m: number | null }>(
      'SELECT MAX(version_number) AS m FROM programme_version WHERE programme_id = ?',
      [id],
    );
    const versionNumber = (max?.m ?? 0) + 1;
    const version = await saveEntity<ProgrammeVersion>(tx, 'programme_version', {
      programme_id: id,
      version_number: versionNumber,
      snapshot: buildSnapshot(detail, exercises, versionNumber),
      change_summary: opts.changeSummary ?? null,
      approved_at: nowIso(),
    });
    const others = await queryEntities<Programme>(
      tx,
      'programme',
      "status = 'active' AND id != ? AND deleted_at IS NULL",
      [id],
    );
    for (const o of others)
      await patchEntity<Programme>(tx, 'programme', o.id, { status: 'archived' });
    await patchEntity<Programme>(tx, 'programme', id, {
      status: 'active',
      active_version_id: version.id,
      has_unapproved_changes: false,
    });
    return version;
  });
}

export class ProgrammeValidationError extends Error {
  constructor(public issues: Issue[]) {
    super(issues.map((i) => i.message).join('\n'));
    this.name = 'ProgrammeValidationError';
  }
}

export async function getVersion(db: SqlDb, versionId: string): Promise<ProgrammeVersion | null> {
  return getEntity<ProgrammeVersion>(db, 'programme_version', versionId);
}

export async function listVersions(db: SqlDb, programmeId: string): Promise<ProgrammeVersion[]> {
  return queryEntities<ProgrammeVersion>(
    db,
    'programme_version',
    'programme_id = ? AND deleted_at IS NULL',
    [programmeId],
    'version_number DESC',
  );
}

export type ActiveProgramme = { programme: Programme; version: ProgrammeVersion };

/** The approved snapshot currently in effect (never the unapproved working copy). */
export async function getActiveProgramme(db: SqlDb): Promise<ActiveProgramme | null> {
  const rows = await queryEntities<Programme>(
    db,
    'programme',
    "status = 'active' AND deleted_at IS NULL",
  );
  const programme = rows[0];
  if (!programme?.active_version_id) return null;
  const version = await getVersion(db, programme.active_version_id);
  return version ? { programme, version } : null;
}

/** Every approved version, oldest first — used to resolve which plan applied on a past date. */
export async function listAllApprovedVersions(db: SqlDb): Promise<ProgrammeVersion[]> {
  return queryEntities<ProgrammeVersion>(
    db,
    'programme_version',
    'deleted_at IS NULL',
    [],
    'approved_at',
  );
}

export async function archiveProgramme(db: SqlDb, id: string): Promise<void> {
  await patchEntity<Programme>(db, 'programme', id, { status: 'archived' });
}

/** Deletes a draft/archived programme (tombstones). Approved versions remain for session history. */
export async function deleteProgramme(db: SqlDb, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const detail = await getProgrammeDetail(tx, id);
    if (!detail) return;
    if (detail.programme.status === 'active')
      throw new Error('Archive or replace the active programme before deleting it.');
    for (const { day, exercises } of detail.days) {
      for (const e of exercises) await softDelete(tx, 'programme_exercise', e.id);
      await softDelete(tx, 'programme_day', day.id);
    }
    await softDelete(tx, 'programme', id);
  });
}
