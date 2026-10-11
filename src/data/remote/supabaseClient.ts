import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { isCloudConfigured, remoteConfig } from './config';
import { secureSessionStorage } from './secureStorage';

let client: SupabaseClient | null = null;

/** Lazily created client; null when cloud credentials are not configured (local-only build). */
export function getSupabase(): SupabaseClient | null {
  if (!isCloudConfigured()) return null;
  if (!client) {
    client = createClient(remoteConfig.supabaseUrl, remoteConfig.supabaseAnonKey, {
      auth: {
        storage: secureSessionStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}

export async function getUserId(): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session?.user.id ?? null;
}
