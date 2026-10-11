import type { SqlDb } from '@/data/local/db';
import { ENTITIES } from '@/data/local/entities';
import { getSchemaVersion } from '@/data/local/migrations';
import { decode } from '@/data/local/store';
import type { EntityType } from '@/data/local/entities';
import { nowIso } from '@/utils/clock';

/**
 * Data export (FR-14). Documented in docs/EXPORT_FORMAT.md:
 * { format: "gymos-export", formatVersion: 1, exportedAt, schemaVersion, tables: { <entity>: rows[] } }
 * All user records are included (tombstones too, flagged by deleted_at). Built-in exercises are
 * omitted (they ship with the app); photos are listed as metadata — image files are not embedded.
 */
export const EXPORT_FORMAT_VERSION = 1;

export async function buildExport(db: SqlDb): Promise<Record<string, unknown>> {
  const tables: Record<string, unknown[]> = {};
  for (const type of Object.keys(ENTITIES) as EntityType[]) {
    const where = type === 'exercise' ? 'WHERE is_custom = 1' : '';
    const rows = await db.all<Record<string, unknown>>(
      `SELECT * FROM ${ENTITIES[type].table} ${where}`,
    );
    tables[type] = rows.map((r) => decode(type, r));
  }
  tables.ai_message = await db.all('SELECT * FROM ai_message ORDER BY created_at');
  return {
    format: 'gymos-export',
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: nowIso(),
    schemaVersion: await getSchemaVersion(db),
    units: {
      load: 'kg',
      length: 'cm',
      distance: 'm',
      duration: 's',
      timestamps: 'UTC ISO-8601',
      dates: 'local YYYY-MM-DD',
    },
    notes: 'Progress photo image files are not embedded; see progress_photo for metadata.',
    tables,
  };
}

/** Wipes every local table (after explicit confirmation in the UI). Schema stays; seed is re-applied. */
export async function deleteAllLocalData(db: SqlDb): Promise<string[]> {
  const photoUris = (
    await db.all<{ local_uri: string | null }>('SELECT local_uri FROM progress_photo')
  )
    .map((r) => r.local_uri)
    .filter((u): u is string => !!u);
  await db.transaction(async (tx) => {
    for (const cfg of Object.values(ENTITIES)) await tx.run(`DELETE FROM ${cfg.table}`);
    for (const t of [
      'sync_outbox',
      'sync_conflict',
      'ai_message',
      'analytics_counter',
      'app_setting',
    ])
      await tx.run(`DELETE FROM ${t}`);
  });
  return photoUris;
}
