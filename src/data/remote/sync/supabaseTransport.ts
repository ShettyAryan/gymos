import type { SupabaseClient } from '@supabase/supabase-js';

import { TransportError, type PhotoStorage, type RemoteRecord, type SyncTransport } from './types';

const BUCKET = 'progress-photos';

function classify(
  error: { message?: string; code?: string } | null,
  status?: number,
): TransportError {
  const msg = error?.message ?? 'Sync failed';
  if (
    status === 401 ||
    status === 403 ||
    error?.code === '28000' ||
    error?.code === 'PGRST301' ||
    /jwt|not authenticated/i.test(msg)
  ) {
    return new TransportError('auth', 'Your session expired — sign in again to sync.');
  }
  if (!status || /network request failed|failed to fetch|timeout|offline/i.test(msg)) {
    return new TransportError('network', 'Network unavailable');
  }
  return new TransportError('server', msg.slice(0, 200));
}

/** Storage errors carry an HTTP status (as statusCode or status); absent = network failure. */
function storageStatus(error: object): number | undefined {
  const e = error as { statusCode?: string | number; status?: number };
  const v = Number(e.statusCode ?? e.status);
  return Number.isFinite(v) && v > 0 ? v : undefined;
}

export function supabaseTransport(sb: SupabaseClient): SyncTransport {
  return {
    async push(items) {
      const { data, error, status } = await sb.rpc('sync_push', { items });
      if (error) throw classify(error, status);
      return data;
    },
    async pull(cursor, limit) {
      let q = sb
        .from('sync_record')
        .select('entity_type, entity_id, version, payload, updated_at')
        .order('updated_at')
        .limit(limit);
      if (cursor) q = q.gt('updated_at', cursor);
      const { data, error, status } = await q;
      if (error) throw classify(error, status);
      return (data ?? []) as RemoteRecord[];
    },
  };
}

export function supabasePhotoStorage(sb: SupabaseClient): PhotoStorage {
  return {
    async userFolder() {
      const { data } = await sb.auth.getSession();
      if (!data.session) throw new TransportError('auth', 'Not signed in');
      return data.session.user.id;
    },
    async upload(path, bytes, contentType) {
      const { error } = await sb.storage
        .from(BUCKET)
        .upload(path, bytes, { contentType, upsert: true });
      if (error) throw classify(error, storageStatus(error));
    },
    async remove(paths) {
      const { error } = await sb.storage.from(BUCKET).remove(paths);
      if (error) throw classify(error, storageStatus(error));
    },
  };
}

/** Short-lived signed URL for viewing a private photo (never stored). */
export async function signedPhotoUrl(
  sb: SupabaseClient,
  path: string,
  seconds = 60,
): Promise<string | null> {
  const { data } = await sb.storage.from(BUCKET).createSignedUrl(path, seconds);
  return data?.signedUrl ?? null;
}

/** Removes every photo object in the caller's folder (used by "delete cloud data"). */
export async function removeAllPhotos(sb: SupabaseClient, userId: string): Promise<void> {
  for (;;) {
    const { data, error } = await sb.storage.from(BUCKET).list(userId, { limit: 100 });
    if (error) throw classify(error, storageStatus(error));
    if (!data || data.length === 0) return;
    await sb.storage.from(BUCKET).remove(data.map((f) => `${userId}/${f.name}`));
    if (data.length < 100) return;
  }
}
