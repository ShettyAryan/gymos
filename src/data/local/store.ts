import { nowIso } from '@/utils/clock';
import { newId } from '@/utils/id';

import { sqlValue, type SqlDb, type SqlValue } from './db';
import { ENTITIES, type EntityConfig, type EntityType } from './entities';

type Row = Record<string, unknown>;
type Meta = {
  id: string;
  created_at: string;
  updated_at: string;
  version: number;
  deleted_at: string | null;
};

const cfg = (t: EntityType): EntityConfig => ENTITIES[t];

/** DB row → domain object (parse JSON columns, 0/1 → boolean). */
export function decode<T>(type: EntityType, raw: Row): T {
  const c = cfg(type);
  const out: Row = { ...raw };
  for (const k of c.json) {
    const v = out[k];
    if (typeof v === 'string') {
      try {
        out[k] = JSON.parse(v);
      } catch {
        out[k] = null;
      }
    }
  }
  for (const k of c.bool) out[k] = out[k] === 1 || out[k] === true;
  return out as T;
}

function encode(type: EntityType, obj: Row): Record<string, SqlValue> {
  const c = cfg(type);
  const out: Record<string, SqlValue> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    out[k] = c.json.includes(k) ? (v === null ? null : JSON.stringify(v)) : sqlValue(v);
  }
  return out;
}

/** Payload that is sent to the cloud for a record (omits device-local columns). */
export function syncPayload(type: EntityType, record: Row): Row {
  const omit = cfg(type).omitFromSync ?? [];
  const out: Row = {};
  for (const [k, v] of Object.entries(record)) if (!omit.includes(k)) out[k] = v;
  return out;
}

export async function getEntity<T>(db: SqlDb, type: EntityType, id: string): Promise<T | null> {
  const raw = await db.first<Row>(`SELECT * FROM ${cfg(type).table} WHERE id = ?`, [id]);
  return raw ? decode<T>(type, raw) : null;
}

export async function queryEntities<T>(
  db: SqlDb,
  type: EntityType,
  where = 'deleted_at IS NULL',
  params: SqlValue[] = [],
  orderBy?: string,
): Promise<T[]> {
  const sql = `SELECT * FROM ${cfg(type).table} WHERE ${where}${orderBy ? ` ORDER BY ${orderBy}` : ''}`;
  const rows = await db.all<Row>(sql, params);
  return rows.map((r) => decode<T>(type, r));
}

export type SaveInput<T> = Omit<
  T,
  'created_at' | 'updated_at' | 'version' | 'deleted_at' | 'id'
> & {
  id?: string;
  deleted_at?: string | null;
};

/**
 * Insert or update a record AND queue it in the sync outbox, in one transaction.
 * The version is bumped on every write; the caller never sets it.
 * Returns the persisted record (read back from the database).
 */
export async function saveEntity<T extends Meta = Meta & Record<string, unknown>>(
  db: SqlDb,
  type: EntityType,
  input: SaveInput<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const c = cfg(type);
    const id = input.id ?? newId();
    const existing = await tx.first<{ version: number; created_at: string }>(
      `SELECT version, created_at FROM ${c.table} WHERE id = ?`,
      [id],
    );
    const ts = nowIso();
    const record: Row = {
      ...input,
      id,
      created_at: existing?.created_at ?? ts,
      updated_at: ts,
      version: (existing?.version ?? 0) + 1,
      deleted_at: input.deleted_at ?? null,
    };
    await writeRow(tx, type, record);
    const saved = (await getEntity<T>(tx, type, id))!;
    if (c.syncable) await enqueueOutbox(tx, type, saved as unknown as Row);
    return saved;
  });
}

/** Partial update of an existing record (version bump + outbox). */
export async function patchEntity<T extends Meta>(
  db: SqlDb,
  type: EntityType,
  id: string,
  patch: Partial<Omit<T, 'id' | 'created_at' | 'updated_at' | 'version'>>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const current = await getEntity<T>(tx, type, id);
    if (!current) throw new Error(`${type} ${id} not found`);
    const { created_at: _c, updated_at: _u, version: _v, ...rest } = current as unknown as Row;
    return saveEntity<T>(tx, type, { ...rest, ...patch } as unknown as SaveInput<T>);
  });
}

/** Tombstone delete: the row stays (deleted_at set) so the deletion can sync before any purge. */
export async function softDelete(db: SqlDb, type: EntityType, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const current = await getEntity<Meta>(tx, type, id);
    if (!current || current.deleted_at) return;
    await patchEntity(tx, type, id, { deleted_at: nowIso() } as never);
  });
}

/** Low-level upsert of a fully formed row (used by saveEntity and by cloud restore). */
export async function writeRow(db: SqlDb, type: EntityType, record: Row): Promise<void> {
  const enc = encode(type, record);
  const cols = Object.keys(enc);
  const placeholders = cols.map(() => '?').join(', ');
  const updates = cols
    .filter((k) => k !== 'id')
    .map((k) => `${k} = excluded.${k}`)
    .join(', ');
  await db.run(
    `INSERT INTO ${cfg(type).table} (${cols.join(', ')}) VALUES (${placeholders})
     ON CONFLICT(id) DO UPDATE SET ${updates}`,
    cols.map((k) => enc[k] ?? null),
  );
}

/**
 * Queue a record for upload. Pending/failed items for the same entity are coalesced so
 * the outbox holds at most one not-yet-sent item per entity; an in-flight item is left
 * alone and a newer item is queued behind it.
 */
export async function enqueueOutbox(db: SqlDb, type: EntityType, record: Row): Promise<void> {
  const ts = nowIso();
  const payload = JSON.stringify(syncPayload(type, record));
  const operation = record.deleted_at ? 'delete' : 'upsert';
  const version = Number(record.version ?? 1);
  const existing = await db.first<{ id: string }>(
    `SELECT id FROM sync_outbox WHERE entity_type = ? AND entity_id = ? AND state IN ('pending','failed') LIMIT 1`,
    [type, String(record.id)],
  );
  if (existing) {
    await db.run(
      `UPDATE sync_outbox SET payload = ?, operation = ?, entity_version = ?, state = 'pending',
         next_attempt_at = NULL, updated_at = ? WHERE id = ?`,
      [payload, operation, version, ts, existing.id],
    );
  } else {
    await db.run(
      `INSERT INTO sync_outbox (id, entity_type, entity_id, operation, payload, entity_version, state,
         attempt_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
      [newId(), type, String(record.id), operation, payload, version, ts, ts],
    );
  }
}
