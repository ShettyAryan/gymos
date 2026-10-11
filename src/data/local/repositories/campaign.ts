import type { DateKey } from '@/utils/dates';
import { nowIso } from '@/utils/clock';

import type { SqlDb } from '../db';
import {
  getEntity,
  patchEntity,
  queryEntities,
  saveEntity,
  softDelete,
  type SaveInput,
} from '../store';

import type { SyncMeta } from '@/domain/models/types';
import { milestoneAward } from '@/domain/rules/xp';

import { applyAwards } from './awards';

export type CampaignStatus = 'active' | 'completed' | 'archived';
export type Campaign = SyncMeta & {
  id: string;
  name: string;
  goal: string | null;
  start_date: DateKey;
  target_date: DateKey | null;
  status: CampaignStatus;
};

export type MilestoneKind = 'custom' | 'photoshoot' | 'body_weight' | 'sessions';
export type Milestone = SyncMeta & {
  id: string;
  campaign_id: string;
  title: string;
  kind: MilestoneKind;
  target_value: number | null;
  due_date: DateKey | null;
  status: 'open' | 'done';
  completed_at: string | null;
};

export async function getActiveCampaign(db: SqlDb): Promise<Campaign | null> {
  const rows = await queryEntities<Campaign>(
    db,
    'campaign',
    "status = 'active' AND deleted_at IS NULL",
  );
  return rows[0] ?? null;
}

export function listCampaigns(db: SqlDb): Promise<Campaign[]> {
  return queryEntities<Campaign>(db, 'campaign', 'deleted_at IS NULL', [], 'start_date DESC');
}

/** One active campaign at a time: creating a new active campaign archives the previous one. */
export async function createCampaign(
  db: SqlDb,
  input: { name: string; goal: string | null; start_date: DateKey; target_date: DateKey | null },
): Promise<Campaign> {
  if (!input.name.trim()) throw new Error('Campaign name is required.');
  if (input.target_date && input.target_date < input.start_date) {
    throw new Error('Target date must be on or after the start date.');
  }
  return db.transaction(async (tx) => {
    const current = await getActiveCampaign(tx);
    if (current) await patchEntity<Campaign>(tx, 'campaign', current.id, { status: 'archived' });
    return saveEntity<Campaign>(tx, 'campaign', {
      ...input,
      name: input.name.trim(),
      status: 'active',
    });
  });
}

export async function updateCampaign(
  db: SqlDb,
  id: string,
  patch: Partial<Pick<Campaign, 'name' | 'goal' | 'target_date' | 'status'>>,
): Promise<Campaign> {
  return db.transaction(async (tx) => {
    const c = await patchEntity<Campaign>(tx, 'campaign', id, patch);
    if (patch.status === 'completed') {
      await applyAwards(
        tx,
        [],
        [
          {
            badgeKey: 'campaign_complete',
            idempotencyKey: 'badge:campaign_complete',
            sourceEntityId: id,
          },
        ],
      );
    }
    return c;
  });
}

export function listMilestones(db: SqlDb, campaignId: string): Promise<Milestone[]> {
  return queryEntities<Milestone>(
    db,
    'campaign_milestone',
    'campaign_id = ? AND deleted_at IS NULL',
    [campaignId],
    "COALESCE(due_date, '9999-12-31'), created_at",
  );
}

export function saveMilestone(db: SqlDb, input: SaveInput<Milestone>): Promise<Milestone> {
  if (!input.title.trim()) throw new Error('Milestone title is required.');
  return saveEntity<Milestone>(db, 'campaign_milestone', { ...input, title: input.title.trim() });
}

/** Completing a milestone awards XP once (idempotent); un-completing never removes history. */
export async function setMilestoneDone(db: SqlDb, id: string, done: boolean): Promise<Milestone> {
  return db.transaction(async (tx) => {
    const m = await patchEntity<Milestone>(tx, 'campaign_milestone', id, {
      status: done ? 'done' : 'open',
      completed_at: done ? nowIso() : null,
    });
    if (done) await applyAwards(tx, [milestoneAward(id)], []);
    return m;
  });
}

export function deleteMilestone(db: SqlDb, id: string) {
  return softDelete(db, 'campaign_milestone', id);
}

export function getCampaign(db: SqlDb, id: string) {
  return getEntity<Campaign>(db, 'campaign', id);
}
