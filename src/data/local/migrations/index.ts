import type { SqlDb } from '../db';

import { migration001 } from './001_initial';

export type Migration = { version: number; name: string; sql: string };

/**
 * Ordered, append-only list. Never edit a shipped migration — add a new one.
 * The schema version is tracked with PRAGMA user_version.
 */
export const migrations: Migration[] = [{ version: 1, name: 'initial', sql: migration001 }];

export const LATEST_SCHEMA_VERSION = migrations[migrations.length - 1]!.version;

export async function getSchemaVersion(db: SqlDb): Promise<number> {
  const row = await db.first<{ user_version: number }>('PRAGMA user_version');
  return row?.user_version ?? 0;
}

/** Applies pending migrations, each atomically with its version bump. Safe to call on every launch. */
export async function runMigrations(db: SqlDb): Promise<{ from: number; to: number }> {
  const from = await getSchemaVersion(db);
  if (from > LATEST_SCHEMA_VERSION) {
    throw new Error(
      `Database schema v${from} is newer than this app (v${LATEST_SCHEMA_VERSION}). Update the app; data was not modified.`,
    );
  }
  for (const m of migrations) {
    if (m.version <= from) continue;
    await db.transaction(async (tx) => {
      await tx.exec(m.sql);
      await tx.exec(`PRAGMA user_version = ${m.version}`);
    });
  }
  return { from, to: await getSchemaVersion(db) };
}
