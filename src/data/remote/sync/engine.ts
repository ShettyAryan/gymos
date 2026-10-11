import type { SqlDb } from '@/data/local/db';
import { ENTITIES, isEntityType, type EntityType } from '@/data/local/entities';
import { getSetting, setSetting } from '@/data/local/repositories/settings';
import { getEntity, writeRow } from '@/data/local/store';
import { now, nowIso } from '@/utils/clock';
import { newId } from '@/utils/id';

import { TransportError, type PushItem, type RemoteRecord, type SyncTransport } from './types';

/**
 * Outbox sync (TRD §10). Guarantees:
 * - Items are deleted from the outbox ONLY after server acknowledgement (applied/duplicate).
 * - Network failures/timeouts never drop data: items return to the queue with backoff + jitter.
 * - Auth expiry is handled separately (no attempt counted, surfaced as auth_required).
 * - Conflicts are never overwritten: the local record is kept and a visible conflict is recorded.
 * - Pulled records never overwrite local records that have unsent changes.
 */
export const SYNC_CONFIG = {
  batchSize: 100,
  pullPageSize: 500,
  maxAttempts: 8,
  baseBackoffMs: 5_000,
  maxBackoffMs: 30 * 60_000,
};

export type SyncSummary = {
  pushed: number;
  duplicates: number;
  conflicts: number;
  pulled: number;
  failed: number;
  status: 'ok' | 'offline' | 'auth_required' | 'error';
  error: string | null;
};

type OutboxRow = {
  id: string;
  entity_type: string;
  entity_id: string;
  operation: string;
  payload: string;
  entity_version: number;
  state: string;
  attempt_count: number;
};

/** Exponential backoff with full jitter. `random` injectable for tests. */
export function backoffMs(attempt: number, random = Math.random): number {
  const cap = Math.min(
    SYNC_CONFIG.maxBackoffMs,
    SYNC_CONFIG.baseBackoffMs * 2 ** Math.max(0, attempt - 1),
  );
  return Math.round(cap / 2 + (random() * cap) / 2);
}

/** On launch: items stuck "in_flight" by a crash go back to the queue (the server is idempotent). */
export async function recoverInFlight(db: SqlDb): Promise<void> {
  await db.run("UPDATE sync_outbox SET state = 'pending' WHERE state = 'in_flight'");
}

export async function outboxStats(db: SqlDb) {
  const r = await db.first<{ pending: number; failed: number; conflict: number; stuck: number }>(
    `SELECT
       SUM(CASE WHEN state IN ('pending','in_flight') THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN state = 'failed' THEN 1 ELSE 0 END) AS failed,
       SUM(CASE WHEN state = 'conflict' THEN 1 ELSE 0 END) AS conflict,
       SUM(CASE WHEN state = 'failed' AND attempt_count >= ? THEN 1 ELSE 0 END) AS stuck
     FROM sync_outbox`,
    [SYNC_CONFIG.maxAttempts],
  );
  return {
    pending: r?.pending ?? 0,
    failed: r?.failed ?? 0,
    conflict: r?.conflict ?? 0,
    stuck: r?.stuck ?? 0,
  };
}

/** Manual "retry now": clears backoff and attempt limits for failed items. */
export async function resetFailed(db: SqlDb): Promise<void> {
  await db.run(
    "UPDATE sync_outbox SET state = 'pending', attempt_count = 0, next_attempt_at = NULL WHERE state = 'failed'",
  );
}

async function pushOutbox(
  db: SqlDb,
  transport: SyncTransport,
  summary: SyncSummary,
  random: () => number,
): Promise<void> {
  for (;;) {
    const batch = await db.transaction(async (tx) => {
      const rows = await tx.all<OutboxRow>(
        `SELECT * FROM sync_outbox
         WHERE (state = 'pending' OR (state = 'failed' AND attempt_count < ? AND (next_attempt_at IS NULL OR next_attempt_at <= ?)))
         ORDER BY created_at LIMIT ?`,
        [SYNC_CONFIG.maxAttempts, nowIso(), SYNC_CONFIG.batchSize],
      );
      if (rows.length) {
        await tx.run(
          `UPDATE sync_outbox SET state = 'in_flight', updated_at = ? WHERE id IN (${rows.map(() => '?').join(',')})`,
          [nowIso(), ...rows.map((r) => r.id)],
        );
      }
      return rows;
    });
    if (batch.length === 0) return;

    const items: PushItem[] = batch.map((r) => ({
      entity_type: r.entity_type as EntityType,
      entity_id: r.entity_id,
      version: r.entity_version,
      payload: JSON.parse(r.payload),
    }));

    let results;
    try {
      results = await transport.push(items);
    } catch (e) {
      const kind = e instanceof TransportError ? e.kind : 'network';
      await db.transaction(async (tx) => {
        for (const r of batch) {
          if (kind === 'auth') {
            await tx.run("UPDATE sync_outbox SET state = 'pending', updated_at = ? WHERE id = ?", [
              nowIso(),
              r.id,
            ]);
          } else {
            const attempts = r.attempt_count + 1;
            await tx.run(
              "UPDATE sync_outbox SET state = 'failed', attempt_count = ?, next_attempt_at = ?, last_error = ?, updated_at = ? WHERE id = ?",
              [
                attempts,
                new Date(now().getTime() + backoffMs(attempts, random)).toISOString(),
                String((e as Error).message).slice(0, 200),
                nowIso(),
                r.id,
              ],
            );
          }
        }
      });
      summary.failed += kind === 'auth' ? 0 : batch.length;
      summary.status = kind === 'auth' ? 'auth_required' : kind === 'network' ? 'offline' : 'error';
      summary.error = (e as Error).message;
      return;
    }

    await db.transaction(async (tx) => {
      for (const r of batch) {
        const res = results.find(
          (x) => x.entity_type === r.entity_type && x.entity_id === r.entity_id,
        );
        if (!res) {
          // Not acknowledged → keep it queued.
          await tx.run("UPDATE sync_outbox SET state = 'pending' WHERE id = ?", [r.id]);
          continue;
        }
        if (res.status === 'applied' || res.status === 'duplicate') {
          await tx.run('DELETE FROM sync_outbox WHERE id = ?', [r.id]);
          if (res.status === 'applied') summary.pushed += 1;
          else summary.duplicates += 1;
        } else {
          await tx.run("UPDATE sync_outbox SET state = 'conflict', updated_at = ? WHERE id = ?", [
            nowIso(),
            r.id,
          ]);
          await recordConflict(
            tx,
            r.entity_type,
            r.entity_id,
            r.payload,
            r.entity_version,
            res.server_payload,
            res.server_version,
          );
          summary.conflicts += 1;
        }
      }
    });
    if (batch.length < SYNC_CONFIG.batchSize) return;
  }
}

async function recordConflict(
  db: SqlDb,
  entityType: string,
  entityId: string,
  localPayload: string,
  localVersion: number,
  remotePayload: Record<string, unknown> | null,
  remoteVersion: number | null,
) {
  const open = await db.first<{ id: string }>(
    'SELECT id FROM sync_conflict WHERE entity_type = ? AND entity_id = ? AND resolved_at IS NULL',
    [entityType, entityId],
  );
  const remote = remotePayload ? JSON.stringify(remotePayload) : null;
  if (open) {
    await db.run(
      'UPDATE sync_conflict SET local_payload = ?, remote_payload = ?, local_version = ?, remote_version = ?, detected_at = ? WHERE id = ?',
      [localPayload, remote, localVersion, remoteVersion, nowIso(), open.id],
    );
  } else {
    await db.run(
      'INSERT INTO sync_conflict (id, entity_type, entity_id, local_payload, remote_payload, local_version, remote_version, detected_at) VALUES (?,?,?,?,?,?,?,?)',
      [newId(), entityType, entityId, localPayload, remote, localVersion, remoteVersion, nowIso()],
    );
  }
}

/**
 * Applies remote records locally (new-device restore and catch-up). Rules:
 * - local row missing → insert (award rows skipped if the same idempotency key already exists locally)
 * - remote newer and no unsent local change → overwrite synced columns (device-local columns kept)
 * - remote newer but local change pending → visible conflict, local kept
 * - remote same/older → ignore
 */
export async function applyRemote(db: SqlDb, records: RemoteRecord[]): Promise<number> {
  const sorted = [...records]
    .filter((r) => isEntityType(r.entity_type))
    .sort(
      (a, b) =>
        ENTITIES[a.entity_type as EntityType].restoreOrder -
        ENTITIES[b.entity_type as EntityType].restoreOrder,
    );
  let applied = 0;
  await db.transaction(async (tx) => {
    for (const r of sorted) {
      const type = r.entity_type as EntityType;
      const payload: Record<string, unknown> = {
        ...r.payload,
        id: r.entity_id,
        version: r.version,
      };
      const local = await getEntity<{ version: number }>(tx, type, r.entity_id);
      if (!local) {
        if ((type === 'xp_event' || type === 'badge_award') && payload.idempotency_key) {
          const dupe = await tx.first(
            `SELECT 1 AS x FROM ${ENTITIES[type].table} WHERE idempotency_key = ?`,
            [String(payload.idempotency_key)],
          );
          if (dupe) continue;
        }
        await writeRow(tx, type, payload);
        applied += 1;
        continue;
      }
      if (r.version <= local.version) continue;
      const pending = await tx.first<{ id: string; payload: string; entity_version: number }>(
        "SELECT id, payload, entity_version FROM sync_outbox WHERE entity_type = ? AND entity_id = ? AND state IN ('pending','failed','in_flight','conflict') LIMIT 1",
        [type, r.entity_id],
      );
      if (pending) {
        await tx.run("UPDATE sync_outbox SET state = 'conflict' WHERE id = ?", [pending.id]);
        await recordConflict(
          tx,
          type,
          r.entity_id,
          pending.payload,
          pending.entity_version,
          r.payload,
          r.version,
        );
        continue;
      }
      await writeRow(tx, type, payload);
      applied += 1;
    }
  });
  return applied;
}

async function pullRemote(
  db: SqlDb,
  transport: SyncTransport,
  summary: SyncSummary,
): Promise<void> {
  let cursor = await getSetting<string>(db, 'sync_cursor');
  for (;;) {
    const page = await transport.pull(cursor, SYNC_CONFIG.pullPageSize);
    if (page.length === 0) return;
    summary.pulled += await applyRemote(db, page);
    cursor = page[page.length - 1]!.updated_at;
    await setSetting(db, 'sync_cursor', cursor);
    if (page.length < SYNC_CONFIG.pullPageSize) return;
  }
}

/** One sync pass: push the outbox, then pull remote changes. Never throws for transport errors. */
export async function runSync(
  db: SqlDb,
  transport: SyncTransport,
  opts: { random?: () => number } = {},
): Promise<SyncSummary> {
  const summary: SyncSummary = {
    pushed: 0,
    duplicates: 0,
    conflicts: 0,
    pulled: 0,
    failed: 0,
    status: 'ok',
    error: null,
  };
  await pushOutbox(db, transport, summary, opts.random ?? Math.random);
  if (summary.status !== 'ok') return summary;
  try {
    await pullRemote(db, transport, summary);
  } catch (e) {
    const kind = e instanceof TransportError ? e.kind : 'network';
    summary.status = kind === 'auth' ? 'auth_required' : kind === 'network' ? 'offline' : 'error';
    summary.error = (e as Error).message;
  }
  if (summary.status === 'ok') await setSetting(db, 'last_sync_at', nowIso());
  return summary;
}

export type SyncConflictRow = {
  id: string;
  entity_type: string;
  entity_id: string;
  local_payload: string;
  remote_payload: string | null;
  local_version: number;
  remote_version: number | null;
  detected_at: string;
};

export function listOpenConflicts(db: SqlDb): Promise<SyncConflictRow[]> {
  return db.all<SyncConflictRow>(
    'SELECT * FROM sync_conflict WHERE resolved_at IS NULL ORDER BY detected_at DESC',
  );
}

/**
 * Resolve a conflict explicitly (user choice):
 * - keep_local: re-queue the local record with a version above the server's, so it wins next push.
 * - use_remote: overwrite the local record with the server copy and drop the queued local change.
 */
export async function resolveConflict(
  db: SqlDb,
  conflictId: string,
  choice: 'keep_local' | 'use_remote',
): Promise<void> {
  await db.transaction(async (tx) => {
    const c = await tx.first<SyncConflictRow>('SELECT * FROM sync_conflict WHERE id = ?', [
      conflictId,
    ]);
    if (!c || !isEntityType(c.entity_type)) return;
    const type = c.entity_type;
    if (choice === 'use_remote' && c.remote_payload) {
      await writeRow(tx, type, {
        ...JSON.parse(c.remote_payload),
        id: c.entity_id,
        version: c.remote_version ?? c.local_version,
      });
      await tx.run('DELETE FROM sync_outbox WHERE entity_type = ? AND entity_id = ?', [
        type,
        c.entity_id,
      ]);
    } else {
      const version = Math.max(c.local_version, c.remote_version ?? 0) + 1;
      await tx.run(`UPDATE ${ENTITIES[type].table} SET version = ? WHERE id = ?`, [
        version,
        c.entity_id,
      ]);
      const payload = { ...JSON.parse(c.local_payload), version };
      await tx.run(
        "UPDATE sync_outbox SET state = 'pending', entity_version = ?, payload = ?, attempt_count = 0, next_attempt_at = NULL WHERE entity_type = ? AND entity_id = ?",
        [version, JSON.stringify(payload), type, c.entity_id],
      );
    }
    await tx.run('UPDATE sync_conflict SET resolved_at = ?, resolution = ? WHERE id = ?', [
      nowIso(),
      choice,
      conflictId,
    ]);
  });
}
