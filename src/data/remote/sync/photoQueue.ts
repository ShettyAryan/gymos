import type { SqlDb } from '@/data/local/db';
import { listPhotoQueue, setRemotePath, setUploadState } from '@/data/local/repositories/photos';
import { newId } from '@/utils/id';

import type { PhotoStorage } from './types';

export type PhotoQueueResult = { uploaded: number; deleted: number; failed: number };

/**
 * Independent photo upload queue (TRD §10/§13). Uploads go to a private bucket under
 * "<userId>/<random uuid>.jpg". The local file is never deleted by sync. Deletions remove the
 * private object after the record was tombstoned locally.
 */
export async function processPhotoQueue(
  db: SqlDb,
  storage: PhotoStorage,
  readBytes: (uri: string) => Promise<ArrayBuffer>,
): Promise<PhotoQueueResult> {
  const result: PhotoQueueResult = { uploaded: 0, deleted: 0, failed: 0 };
  const queue = await listPhotoQueue(db);
  const folder = await storage.userFolder();
  for (const p of queue) {
    try {
      if (p.upload_status === 'pending_delete') {
        if (p.remote_path) await storage.remove([p.remote_path]);
        await setRemotePath(db, p.id, null);
        await setUploadState(db, p.id, 'local_only');
        result.deleted += 1;
        continue;
      }
      if (!p.local_uri) {
        await setUploadState(db, p.id, 'failed', 'Local file missing');
        result.failed += 1;
        continue;
      }
      await setUploadState(db, p.id, 'uploading');
      const path = p.remote_path ?? `${folder}/${newId()}.jpg`;
      await storage.upload(path, await readBytes(p.local_uri), 'image/jpeg');
      if (!p.remote_path) await setRemotePath(db, p.id, path);
      await setUploadState(db, p.id, 'uploaded');
      result.uploaded += 1;
    } catch (e) {
      await setUploadState(
        db,
        p.id,
        p.upload_status === 'pending_delete' ? 'pending_delete' : 'failed',
        String((e as Error).message ?? e).slice(0, 200),
      );
      result.failed += 1;
    }
  }
  return result;
}
