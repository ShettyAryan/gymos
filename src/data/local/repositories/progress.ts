import type { SyncMeta } from '@/domain/models/types';
import type { DateKey } from '@/utils/dates';

import type { SqlDb } from '../db';
import { patchEntity, queryEntities, saveEntity, softDelete, type SaveInput } from '../store';

export const MEASUREMENT_KEYS = ['waist', 'chest', 'hips', 'arm', 'thigh', 'neck'] as const;
export type MeasurementKey = (typeof MEASUREMENT_KEYS)[number];

/** Body weight (kg) and circumference measurements (cm) — canonical units. */
export type ProgressEntry = SyncMeta & {
  id: string;
  date: DateKey;
  body_weight_kg: number | null;
  measurements: Partial<Record<MeasurementKey, number>>;
  notes: string | null;
};

export type DailyCheckin = SyncMeta & {
  id: string;
  date: DateKey;
  protein_g: number | null;
  water_ml: number | null;
  sleep_hours: number | null;
  sleep_quality: number | null;
  energy: number | null;
  soreness: number | null;
  notes: string | null;
};

export function listProgressEntries(
  db: SqlDb,
  from?: DateKey,
  to?: DateKey,
): Promise<ProgressEntry[]> {
  return from && to
    ? queryEntities<ProgressEntry>(
        db,
        'progress_entry',
        'deleted_at IS NULL AND date BETWEEN ? AND ?',
        [from, to],
        'date, created_at',
      )
    : queryEntities<ProgressEntry>(
        db,
        'progress_entry',
        'deleted_at IS NULL',
        [],
        'date, created_at',
      );
}

export function saveProgressEntry(
  db: SqlDb,
  input: SaveInput<ProgressEntry>,
): Promise<ProgressEntry> {
  const hasData = input.body_weight_kg !== null || Object.keys(input.measurements).length > 0;
  if (!hasData) throw new Error('Enter a body weight or at least one measurement.');
  if (input.body_weight_kg !== null && (input.body_weight_kg < 20 || input.body_weight_kg > 400))
    throw new Error('That body weight looks out of range.');
  for (const v of Object.values(input.measurements))
    if (v !== undefined && (v < 10 || v > 300))
      throw new Error('A measurement looks out of range.');
  return saveEntity<ProgressEntry>(db, 'progress_entry', input);
}

export function deleteProgressEntry(db: SqlDb, id: string) {
  return softDelete(db, 'progress_entry', id);
}

export async function getCheckin(db: SqlDb, date: DateKey): Promise<DailyCheckin | null> {
  const rows = await queryEntities<DailyCheckin>(
    db,
    'daily_checkin',
    'deleted_at IS NULL AND date = ?',
    [date],
  );
  return rows[0] ?? null;
}

export function listCheckins(db: SqlDb, from: DateKey, to: DateKey): Promise<DailyCheckin[]> {
  return queryEntities<DailyCheckin>(
    db,
    'daily_checkin',
    'deleted_at IS NULL AND date BETWEEN ? AND ?',
    [from, to],
    'date',
  );
}

/** One optional check-in per day; saving again updates it. Every field may be skipped. */
export async function saveCheckin(
  db: SqlDb,
  date: DateKey,
  values: Omit<DailyCheckin, keyof SyncMeta | 'id' | 'date'>,
): Promise<DailyCheckin> {
  const ranges: [keyof typeof values, number, number][] = [
    ['protein_g', 0, 600],
    ['water_ml', 0, 10000],
    ['sleep_hours', 0, 24],
    ['sleep_quality', 1, 5],
    ['energy', 1, 5],
    ['soreness', 1, 5],
  ];
  for (const [k, min, max] of ranges) {
    const v = values[k];
    if (typeof v === 'number' && (v < min || v > max))
      throw new Error(`${String(k).replace('_', ' ')} must be between ${min} and ${max}.`);
  }
  return db.transaction(async (tx) => {
    const existing = await getCheckin(tx, date);
    if (existing) return patchEntity<DailyCheckin>(tx, 'daily_checkin', existing.id, values);
    return saveEntity<DailyCheckin>(tx, 'daily_checkin', { date, ...values });
  });
}
