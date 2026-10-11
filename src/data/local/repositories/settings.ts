import { nowIso } from '@/utils/clock';

import type { SqlDb } from '../db';

/** Device-local key/value settings (never synced). Values are JSON-encoded. */
export async function getSetting<T>(db: SqlDb, key: string): Promise<T | null> {
  const row = await db.first<{ value: string }>('SELECT value FROM app_setting WHERE key = ?', [
    key,
  ]);
  if (!row) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

export async function setSetting(db: SqlDb, key: string, value: unknown): Promise<void> {
  await db.run(
    `INSERT INTO app_setting (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, JSON.stringify(value), nowIso()],
  );
}

export type AppPreferences = {
  /** Cloud backup/sync enabled (requires sign-in). Off = local-only mode. */
  cloudSync: boolean;
  /** AI features enabled (also requires consent + sign-in). */
  aiEnabled: boolean;
  /** Use the in-app mock AI instead of the Edge Function (development / no credentials). */
  mockAi: boolean;
  remindersEnabled: boolean;
  reminderHour: number;
  restTimerAuto: boolean;
};

export const DEFAULT_PREFERENCES: AppPreferences = {
  cloudSync: false,
  aiEnabled: false,
  mockAi: false,
  remindersEnabled: false,
  reminderHour: 18,
  restTimerAuto: true,
};

export async function getPreferences(db: SqlDb): Promise<AppPreferences> {
  const stored = await getSetting<Partial<AppPreferences>>(db, 'preferences');
  return { ...DEFAULT_PREFERENCES, ...(stored ?? {}) };
}

export async function updatePreferences(
  db: SqlDb,
  patch: Partial<AppPreferences>,
): Promise<AppPreferences> {
  const next = { ...(await getPreferences(db)), ...patch };
  await setSetting(db, 'preferences', next);
  return next;
}

/** Local-only diagnostic counters (PRD §8). Never transmitted. */
export async function incrementCounter(db: SqlDb, key: string): Promise<void> {
  await db.run(
    `INSERT INTO analytics_counter (key, count, last_at) VALUES (?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET count = count + 1, last_at = excluded.last_at`,
    [key, nowIso()],
  );
}
