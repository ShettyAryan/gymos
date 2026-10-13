import type { Equipment, Muscle } from '@/domain/models/constants';
import type { Exercise } from '@/domain/models/types';

import type { SqlDb, SqlValue } from '../db';
import { getEntity, queryEntities, saveEntity, softDelete, type SaveInput } from '../store';

export type ExerciseFilter = {
  search?: string;
  muscle?: Muscle | null;
  equipment?: Equipment | null;
  /** Only exercises doable with this equipment set (every requirement available). */
  availableEquipment?: Equipment[] | null;
  customOnly?: boolean;
};

export async function listExercises(db: SqlDb, filter: ExerciseFilter = {}): Promise<Exercise[]> {
  const where: string[] = ['deleted_at IS NULL'];
  const params: SqlValue[] = [];
  if (filter.search?.trim()) {
    where.push('name LIKE ? COLLATE NOCASE');
    params.push(`%${filter.search.trim()}%`);
  }
  if (filter.customOnly) where.push('is_custom = 1');
  const rows = await queryEntities<Exercise>(
    db,
    'exercise',
    where.join(' AND '),
    params,
    'name COLLATE NOCASE',
  );
  return rows.filter((e) => {
    if (
      filter.muscle &&
      !e.primary_muscles.includes(filter.muscle) &&
      !e.secondary_muscles.includes(filter.muscle)
    ) {
      return false;
    }
    if (filter.equipment && !e.equipment.includes(filter.equipment)) return false;
    if (
      filter.availableEquipment &&
      !e.equipment.every((q) => filter.availableEquipment!.includes(q))
    )
      return false;
    return true;
  });
}

export function getExercise(db: SqlDb, id: string): Promise<Exercise | null> {
  return getEntity<Exercise>(db, 'exercise', id);
}

export async function getExerciseMap(db: SqlDb): Promise<Map<string, Exercise>> {
  // Includes soft-deleted custom exercises so historic sessions still resolve names.
  const rows = await queryEntities<Exercise>(db, 'exercise', '1 = 1');
  return new Map(rows.map((e) => [e.id, e]));
}

export type CustomExerciseInput = Omit<SaveInput<Exercise>, 'is_custom'>;

export function saveCustomExercise(db: SqlDb, input: CustomExerciseInput): Promise<Exercise> {
  return saveEntity<Exercise>(db, 'exercise', { ...input, is_custom: true });
}

export async function deleteCustomExercise(db: SqlDb, id: string): Promise<void> {
  const e = await getExercise(db, id);
  if (!e?.is_custom) throw new Error('Only custom exercises can be deleted.');
  await softDelete(db, 'exercise', id);
}

/** Exercises logged most recently (newest first) — the quickest picks when adding to a workout. */
export async function listRecentExercises(db: SqlDb, limit = 8): Promise<Exercise[]> {
  const rows = await db.all<{ exercise_id: string }>(
    `SELECT exercise_id, MAX(completed_at) AS last FROM workout_set WHERE deleted_at IS NULL
     GROUP BY exercise_id ORDER BY last DESC LIMIT ?`,
    [limit],
  );
  const map = await getExerciseMap(db);
  return rows.map((r) => map.get(r.exercise_id)).filter((e): e is Exercise => !!e && !e.deleted_at);
}

/** Suggested swaps for an exercise: its listed alternatives, then same pattern & muscle. */
export async function listAlternatives(
  db: SqlDb,
  exerciseId: string,
  limit = 6,
): Promise<Exercise[]> {
  const map = await getExerciseMap(db);
  const ex = map.get(exerciseId);
  if (!ex) return [];
  const listed = ex.alternatives
    .map((a) => map.get(a))
    .filter((e): e is Exercise => !!e && !e.deleted_at);
  const similar = [...map.values()]
    .filter(
      (e) =>
        !e.deleted_at &&
        e.id !== ex.id &&
        !listed.includes(e) &&
        e.movement_pattern === ex.movement_pattern &&
        e.primary_muscles.some((m) => ex.primary_muscles.includes(m)),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...listed, ...similar].slice(0, limit);
}
