import { nowIso } from '@/utils/clock';

import type { SqlDb } from '../db';
import { getSetting, setSetting } from '../repositories/settings';
import { writeRow } from '../store';

import { SEED_EXERCISES, SEED_VERSION } from './exercises';

/**
 * Idempotent seeding of the built-in exercise library. Re-runs only when SEED_VERSION changes.
 * Built-in rows are not queued for sync (every install has them); custom exercises are.
 */
export async function seedIfNeeded(db: SqlDb): Promise<boolean> {
  const current = await getSetting<number>(db, 'seed_version');
  if (current === SEED_VERSION) return false;
  await db.transaction(async (tx) => {
    const ts = nowIso();
    for (const e of SEED_EXERCISES) {
      await writeRow(tx, 'exercise', {
        ...e,
        caution: e.caution ?? null,
        load_increment_kg: e.load_increment_kg ?? null,
        is_custom: false,
        created_at: ts,
        updated_at: ts,
        version: SEED_VERSION,
        deleted_at: null,
      });
    }
    await setSetting(tx, 'seed_version', SEED_VERSION);
  });
  return true;
}
