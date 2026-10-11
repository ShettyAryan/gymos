import type { SqlDb } from '@/data/local/db';
import { queueLocalPhotos } from '@/data/local/repositories/photos';
import {
  getPreferences,
  getSetting,
  incrementCounter,
  updatePreferences,
} from '@/data/local/repositories/settings';
import { isCloudConfigured } from '@/data/remote/config';
import { getSupabase } from '@/data/remote/supabaseClient';
import {
  listOpenConflicts,
  outboxStats,
  runSync,
  type SyncSummary,
} from '@/data/remote/sync/engine';
import { processPhotoQueue } from '@/data/remote/sync/photoQueue';
import {
  removeAllPhotos,
  supabasePhotoStorage,
  supabaseTransport,
} from '@/data/remote/sync/supabaseTransport';
import { readPhotoBytes } from '@/features/photos/photoFiles';
import { useSyncStatus } from '@/state/sync';

let running: Promise<SyncSummary | null> | null = null;

/** Updates the UI status from the durable outbox. */
export async function refreshSyncStatus(db: SqlDb): Promise<void> {
  const [stats, conflicts, prefs, last] = await Promise.all([
    outboxStats(db),
    listOpenConflicts(db),
    getPreferences(db),
    getSetting<string>(db, 'last_sync_at'),
  ]);
  const set = useSyncStatus.getState().set;
  set({ pending: stats.pending + stats.failed, conflicts: conflicts.length, lastSyncAt: last });
  if (!prefs.cloudSync || !isCloudConfigured()) set({ status: 'disabled' });
}

/**
 * One background sync pass (never on the set-logging path; never throws). Skipped when cloud
 * backup is off, not configured, or signed out. Concurrent calls share the same run.
 */
export function syncNow(db: SqlDb): Promise<SyncSummary | null> {
  if (running) return running;
  running = (async () => {
    const set = useSyncStatus.getState().set;
    try {
      const prefs = await getPreferences(db);
      const sb = getSupabase();
      if (!prefs.cloudSync || !sb) {
        set({ status: 'disabled' });
        return null;
      }
      const { data } = await sb.auth.getSession();
      if (!data.session) {
        set({ status: 'auth_required', lastError: 'Sign in to back up your data.' });
        return null;
      }
      set({ status: 'syncing' });
      const summary = await runSync(db, supabaseTransport(sb));
      if (summary.status === 'ok') {
        await processPhotoQueue(db, supabasePhotoStorage(sb), readPhotoBytes).catch(
          () => undefined,
        );
        await incrementCounter(db, 'sync_succeeded');
      } else {
        await incrementCounter(db, 'sync_failed');
      }
      set({ status: summary.status === 'ok' ? 'idle' : summary.status, lastError: summary.error });
      return summary;
    } catch (e) {
      set({ status: 'error', lastError: e instanceof Error ? e.message : 'Sync failed' });
      return null;
    } finally {
      await refreshSyncStatus(db).catch(() => undefined);
      running = null;
    }
  })();
  return running;
}

export async function signIn(email: string, password: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error('Cloud backup is not configured in this build.');
  const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error(error.message);
}

export async function signUp(
  email: string,
  password: string,
): Promise<{ needsConfirmation: boolean }> {
  const sb = getSupabase();
  if (!sb) throw new Error('Cloud backup is not configured in this build.');
  const { data, error } = await sb.auth.signUp({ email: email.trim(), password });
  if (error) throw new Error(error.message);
  return { needsConfirmation: !data.session };
}

/** Signing out never deletes local data. */
export async function signOut(db: SqlDb): Promise<void> {
  await getSupabase()?.auth.signOut();
  await updatePreferences(db, { cloudSync: false, aiEnabled: false });
  useSyncStatus.getState().set({ status: 'disabled' });
}

export async function setCloudBackup(db: SqlDb, enabled: boolean): Promise<void> {
  await updatePreferences(db, { cloudSync: enabled });
  if (enabled) await queueLocalPhotos(db);
  await refreshSyncStatus(db);
}

/** Deletes cloud copies (records + private photos). Local data stays; cloud backup is switched off. */
export async function deleteCloudData(db: SqlDb): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error('Cloud backup is not configured in this build.');
  const { data } = await sb.auth.getSession();
  if (!data.session) throw new Error('Sign in first.');
  await removeAllPhotos(sb, data.session.user.id);
  const { error } = await sb.rpc('delete_my_cloud_data');
  if (error) throw new Error(error.message);
  await updatePreferences(db, { cloudSync: false });
  await db.transaction(async (tx) => {
    await tx.run("UPDATE progress_photo SET remote_path = NULL, upload_status = 'local_only'");
    await tx.run("DELETE FROM app_setting WHERE key IN ('sync_cursor','last_sync_at')");
  });
  await incrementCounter(db, 'cloud_data_deleted');
}

/** Deletes the account server-side (Edge Function), then signs out. Local data is untouched. */
export async function deleteAccount(db: SqlDb): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error('Cloud backup is not configured in this build.');
  const { error } = await sb.functions.invoke('delete-account', { body: {} });
  if (error) throw new Error('Account deletion failed. Please try again.');
  await signOut(db);
}
