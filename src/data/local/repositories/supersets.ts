import { newId } from '@/utils/id';

import type { SqlDb } from '../db';
import { patchEntity } from '../store';

/** Shared superset toggle for session rows and programme rows (ordered lists). */
export async function toggleGroup<T extends { id: string; superset_group: string | null }>(
  db: SqlDb,
  type: 'workout_exercise' | 'programme_exercise',
  ordered: T[],
  id: string,
): Promise<void> {
  const i = ordered.findIndex((r) => r.id === id);
  const row = ordered[i];
  if (!row) return;
  const set = (r: T, g: string | null) =>
    patchEntity(db, type, r.id, { superset_group: g } as never);
  if (row.superset_group) {
    const group = row.superset_group;
    await set(row, null);
    const rest = ordered.filter((r) => r.id !== id && r.superset_group === group);
    if (rest.length === 1) await set(rest[0]!, null);
    return;
  }
  const next = ordered[i + 1];
  if (!next) throw new Error('Add another exercise after this one to make a superset.');
  const group = next.superset_group ?? newId();
  await set(row, group);
  if (!next.superset_group) await set(next, group);
}
