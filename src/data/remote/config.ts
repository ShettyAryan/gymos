/**
 * Public client configuration. Only the Supabase URL and the anon/publishable key belong here —
 * both are designed to be public and are protected by RLS. Never put service-role keys or AI keys
 * in EXPO_PUBLIC_* variables: they are embedded in the app bundle.
 */
export const remoteConfig = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
};

export const isCloudConfigured = () => !!remoteConfig.supabaseUrl && !!remoteConfig.supabaseAnonKey;
