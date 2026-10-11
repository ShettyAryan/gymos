import type { EntityType } from '@/data/local/entities';

export type PushItem = {
  entity_type: EntityType;
  entity_id: string;
  version: number;
  payload: Record<string, unknown>;
};

export type PushResult = {
  entity_type: string;
  entity_id: string;
  status: 'applied' | 'duplicate' | 'conflict';
  server_version: number;
  server_payload: Record<string, unknown> | null;
};

export type RemoteRecord = {
  entity_type: string;
  entity_id: string;
  version: number;
  payload: Record<string, unknown>;
  updated_at: string;
};

export type TransportErrorKind = 'network' | 'auth' | 'server';

export class TransportError extends Error {
  constructor(
    public kind: TransportErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'TransportError';
  }
}

/** Remote side of sync. Implemented by Supabase in the app and by an in-memory fake in tests. */
export interface SyncTransport {
  push(items: PushItem[]): Promise<PushResult[]>;
  /** Records changed after `cursor` (exclusive), oldest first. */
  pull(cursor: string | null, limit: number): Promise<RemoteRecord[]>;
}

export interface PhotoStorage {
  upload(path: string, bytes: ArrayBuffer, contentType: string): Promise<void>;
  remove(paths: string[]): Promise<void>;
  userFolder(): Promise<string>;
}
