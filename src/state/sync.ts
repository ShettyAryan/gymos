import { create } from 'zustand';

export type SyncUiStatus = 'disabled' | 'idle' | 'syncing' | 'offline' | 'auth_required' | 'error';

type SyncState = {
  status: SyncUiStatus;
  lastSyncAt: string | null;
  lastError: string | null;
  pending: number;
  conflicts: number;
  set: (patch: Partial<Omit<SyncState, 'set'>>) => void;
};

/** Transient sync status for the UI; the outbox in SQLite is the durable source of truth. */
export const useSyncStatus = create<SyncState>((set) => ({
  status: 'disabled',
  lastSyncAt: null,
  lastError: null,
  pending: 0,
  conflicts: 0,
  set: (patch) => set(patch),
}));
