import type { SyncMeta } from '@/domain/models/types';
import { nowIso } from '@/utils/clock';

import type { SqlDb } from '../db';
import { queryEntities, saveEntity } from '../store';

export type AiConsent = SyncMeta & {
  id: string;
  granted: boolean;
  policy_version: string;
  decided_at: string;
};

/** Latest consent decision (history is kept: each decision is a new row). */
export async function getLatestConsent(db: SqlDb): Promise<AiConsent | null> {
  const rows = await queryEntities<AiConsent>(
    db,
    'ai_consent',
    'deleted_at IS NULL',
    [],
    'decided_at DESC, rowid DESC LIMIT 1',
  );
  return rows[0] ?? null;
}

export async function hasValidConsent(db: SqlDb, policyVersion: string): Promise<boolean> {
  const c = await getLatestConsent(db);
  return !!c && c.granted && c.policy_version === policyVersion;
}

export function recordConsent(
  db: SqlDb,
  granted: boolean,
  policyVersion: string,
): Promise<AiConsent> {
  return saveEntity<AiConsent>(db, 'ai_consent', {
    granted,
    policy_version: policyVersion,
    decided_at: nowIso(),
  });
}
