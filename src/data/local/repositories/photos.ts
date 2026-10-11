import type { SyncMeta } from '@/domain/models/types';
import { nowIso } from '@/utils/clock';

import type { SqlDb } from '../db';
import { getEntity, patchEntity, queryEntities, saveEntity } from '../store';

export type PhotoCategory = 'front' | 'side' | 'back' | 'other';
export type UploadStatus =
  'local_only' | 'pending' | 'uploading' | 'uploaded' | 'failed' | 'pending_delete';

/**
 * Private progress photo. `local_uri` is a file in the app's private document directory;
 * `remote_path` is a private-bucket object path (never a public URL). Photos are never sent to AI.
 */
export type ProgressPhoto = SyncMeta & {
  id: string;
  category: PhotoCategory;
  captured_at: string;
  local_uri: string | null;
  remote_path: string | null;
  upload_status: UploadStatus;
  upload_error: string | null;
  campaign_id: string | null;
  notes: string | null;
};

export function listPhotos(db: SqlDb): Promise<ProgressPhoto[]> {
  return queryEntities<ProgressPhoto>(
    db,
    'progress_photo',
    'deleted_at IS NULL',
    [],
    'captured_at DESC',
  );
}

export function getPhoto(db: SqlDb, id: string) {
  return getEntity<ProgressPhoto>(db, 'progress_photo', id);
}

export function addPhoto(
  db: SqlDb,
  input: {
    localUri: string;
    category: PhotoCategory;
    campaignId: string | null;
    notes: string | null;
    cloudBackup: boolean;
  },
): Promise<ProgressPhoto> {
  return saveEntity<ProgressPhoto>(db, 'progress_photo', {
    category: input.category,
    captured_at: nowIso(),
    local_uri: input.localUri,
    remote_path: null,
    upload_status: input.cloudBackup ? 'pending' : 'local_only',
    upload_error: null,
    campaign_id: input.campaignId,
    notes: input.notes,
  });
}

/**
 * Device-local upload state. Updated without a version bump or outbox entry because these
 * columns are never synced (see ENTITIES.progress_photo.omitFromSync).
 */
export async function setUploadState(
  db: SqlDb,
  id: string,
  status: UploadStatus,
  error: string | null = null,
): Promise<void> {
  await db.run('UPDATE progress_photo SET upload_status = ?, upload_error = ? WHERE id = ?', [
    status,
    error,
    id,
  ]);
}

export function setRemotePath(db: SqlDb, id: string, remotePath: string | null) {
  return patchEntity<ProgressPhoto>(db, 'progress_photo', id, { remote_path: remotePath });
}

/**
 * Tombstones the photo. If a cloud copy exists it is marked pending_delete so the upload queue
 * removes the private object; the caller removes the local file after this commits.
 */
export async function deletePhotoRecord(db: SqlDb, id: string): Promise<ProgressPhoto | null> {
  return db.transaction(async (tx) => {
    const p = await getPhoto(tx, id);
    if (!p || p.deleted_at) return null;
    await patchEntity<ProgressPhoto>(tx, 'progress_photo', id, { deleted_at: nowIso() });
    await setUploadState(tx, id, p.remote_path ? 'pending_delete' : 'local_only');
    return p;
  });
}

/** Photos waiting for the upload queue (new uploads and cloud deletions). */
export function listPhotoQueue(db: SqlDb): Promise<ProgressPhoto[]> {
  return queryEntities<ProgressPhoto>(
    db,
    'progress_photo',
    "(deleted_at IS NULL AND upload_status IN ('pending','failed')) OR upload_status = 'pending_delete'",
    [],
    'captured_at',
  );
}

/** When cloud backup is switched on, existing local-only photos join the queue. */
export async function queueLocalPhotos(db: SqlDb): Promise<void> {
  await db.run(
    "UPDATE progress_photo SET upload_status = 'pending' WHERE deleted_at IS NULL AND upload_status = 'local_only' AND remote_path IS NULL",
  );
}

/** Device-local path for a photo restored from the private backup (not synced). */
export async function setLocalUri(db: SqlDb, id: string, localUri: string): Promise<void> {
  await db.run("UPDATE progress_photo SET local_uri = ?, upload_status = 'uploaded' WHERE id = ?", [
    localUri,
    id,
  ]);
}
