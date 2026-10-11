import type { SyncMeta } from '@/domain/models/types';
import type { BadgeCandidate, BadgeKey, XpCandidate } from '@/domain/rules/xp';
import { nowIso } from '@/utils/clock';

import type { SqlDb } from '../db';
import { queryEntities, saveEntity } from '../store';

export type XpEvent = SyncMeta & {
  id: string;
  event_type: string;
  source_entity_id: string | null;
  idempotency_key: string;
  amount: number;
  rule_version: string;
};

export type BadgeAward = SyncMeta & {
  id: string;
  badge_key: BadgeKey;
  idempotency_key: string;
  source_entity_id: string | null;
  awarded_at: string;
};

/**
 * Applies award candidates idempotently: a candidate whose idempotency key already exists is
 * skipped (and the UNIQUE constraint backs this up). Returns only the newly created awards.
 */
export async function applyAwards(
  db: SqlDb,
  xp: XpCandidate[],
  badges: BadgeCandidate[],
): Promise<{ xp: XpEvent[]; badges: BadgeAward[] }> {
  return db.transaction(async (tx) => {
    const newXp: XpEvent[] = [];
    const newBadges: BadgeAward[] = [];
    for (const c of xp) {
      const exists = await tx.first('SELECT 1 AS x FROM xp_event WHERE idempotency_key = ?', [
        c.idempotencyKey,
      ]);
      if (exists) continue;
      newXp.push(
        await saveEntity<XpEvent>(tx, 'xp_event', {
          event_type: c.eventType,
          source_entity_id: c.sourceEntityId,
          idempotency_key: c.idempotencyKey,
          amount: c.amount,
          rule_version: c.ruleVersion,
        }),
      );
    }
    for (const b of badges) {
      const exists = await tx.first('SELECT 1 AS x FROM badge_award WHERE idempotency_key = ?', [
        b.idempotencyKey,
      ]);
      if (exists) continue;
      newBadges.push(
        await saveEntity<BadgeAward>(tx, 'badge_award', {
          badge_key: b.badgeKey,
          idempotency_key: b.idempotencyKey,
          source_entity_id: b.sourceEntityId,
          awarded_at: nowIso(),
        }),
      );
    }
    return { xp: newXp, badges: newBadges };
  });
}

export async function totalXp(db: SqlDb): Promise<number> {
  const r = await db.first<{ t: number | null }>(
    'SELECT SUM(amount) AS t FROM xp_event WHERE deleted_at IS NULL',
  );
  return r?.t ?? 0;
}

export function listXpEvents(db: SqlDb, limit = 50): Promise<XpEvent[]> {
  return queryEntities<XpEvent>(
    db,
    'xp_event',
    'deleted_at IS NULL',
    [],
    `created_at DESC LIMIT ${Math.floor(limit)}`,
  );
}

export function listBadges(db: SqlDb): Promise<BadgeAward[]> {
  return queryEntities<BadgeAward>(db, 'badge_award', 'deleted_at IS NULL', [], 'awarded_at DESC');
}
