import * as SecureStore from 'expo-secure-store';

/**
 * Auth-session storage backed by the OS keychain/keystore. SecureStore values are size-limited,
 * so long session strings are split into chunks. Only Supabase session tokens are stored here.
 */
const CHUNK = 1800;
const safe = (key: string) => key.replace(/[^A-Za-z0-9._-]/g, '_');

export const secureSessionStorage = {
  async getItem(key: string): Promise<string | null> {
    const k = safe(key);
    const count = await SecureStore.getItemAsync(`${k}__n`);
    if (count === null) return SecureStore.getItemAsync(k);
    const parts: string[] = [];
    for (let i = 0; i < Number(count); i++) {
      const p = await SecureStore.getItemAsync(`${k}__${i}`);
      if (p === null) return null;
      parts.push(p);
    }
    return parts.join('');
  },
  async setItem(key: string, value: string): Promise<void> {
    const k = safe(key);
    await this.removeItem(key);
    const n = Math.ceil(value.length / CHUNK);
    for (let i = 0; i < n; i++)
      await SecureStore.setItemAsync(`${k}__${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK));
    await SecureStore.setItemAsync(`${k}__n`, String(n));
  },
  async removeItem(key: string): Promise<void> {
    const k = safe(key);
    const count = await SecureStore.getItemAsync(`${k}__n`);
    if (count !== null) {
      for (let i = 0; i < Number(count); i++) await SecureStore.deleteItemAsync(`${k}__${i}`);
      await SecureStore.deleteItemAsync(`${k}__n`);
    }
    await SecureStore.deleteItemAsync(k);
  },
};
