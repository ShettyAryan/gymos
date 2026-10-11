import {
  TransportError,
  type PushItem,
  type PushResult,
  type RemoteRecord,
  type SyncTransport,
} from '@/data/remote/sync/types';

/**
 * In-memory server mirroring the semantics of supabase/migrations sync_push (which is itself
 * tested in tests/sql against real Postgres): versioned upserts, idempotent duplicates, conflicts,
 * and per-user award idempotency keys.
 */
export class FakeServer {
  records = new Map<string, RemoteRecord>();
  private clock = 0;
  pushCalls = 0;
  /** Queue of failures to inject into the next push calls. */
  failNext: ('network' | 'auth' | 'server' | 'ack_lost')[] = [];

  transport(): SyncTransport {
    return {
      push: async (items) => this.push(items),
      pull: async (cursor, limit) => this.pull(cursor, limit),
    };
  }

  private key = (t: string, id: string) => `${t}|${id}`;

  push(items: PushItem[]): PushResult[] {
    this.pushCalls += 1;
    const failure = this.failNext.shift();
    if (failure && failure !== 'ack_lost')
      throw new TransportError(failure, `injected ${failure} failure`);
    const results = items.map((it): PushResult => {
      const existing = this.records.get(this.key(it.entity_type, it.entity_id));
      const base = { entity_type: it.entity_type, entity_id: it.entity_id };
      if (!existing) {
        const ik = it.payload.idempotency_key;
        if (
          ik &&
          [...this.records.values()].some(
            (r) => r.entity_type === it.entity_type && r.payload.idempotency_key === ik,
          )
        ) {
          return { ...base, status: 'duplicate', server_version: it.version, server_payload: null };
        }
        this.records.set(this.key(it.entity_type, it.entity_id), {
          ...base,
          version: it.version,
          payload: it.payload,
          updated_at: this.tick(),
        });
        return { ...base, status: 'applied', server_version: it.version, server_payload: null };
      }
      if (existing.version === it.version) {
        const same = JSON.stringify(existing.payload) === JSON.stringify(it.payload);
        return {
          ...base,
          status: same ? 'duplicate' : 'conflict',
          server_version: existing.version,
          server_payload: same ? null : existing.payload,
        };
      }
      if (existing.version < it.version) {
        this.records.set(this.key(it.entity_type, it.entity_id), {
          ...base,
          version: it.version,
          payload: it.payload,
          updated_at: this.tick(),
        });
        return { ...base, status: 'applied', server_version: it.version, server_payload: null };
      }
      return {
        ...base,
        status: 'conflict',
        server_version: existing.version,
        server_payload: existing.payload,
      };
    });
    // Simulates a timeout after the server committed: the client never sees the acknowledgement.
    if (failure === 'ack_lost') throw new TransportError('network', 'timeout after commit');
    return results;
  }

  pull(cursor: string | null, limit: number): RemoteRecord[] {
    return [...this.records.values()]
      .filter((r) => cursor === null || r.updated_at > cursor)
      .sort((a, b) => (a.updated_at < b.updated_at ? -1 : 1))
      .slice(0, limit);
  }

  /** Simulates an edit made on another device. */
  remoteEdit(type: string, id: string, patch: Record<string, unknown>) {
    const r = this.records.get(this.key(type, id))!;
    this.records.set(this.key(type, id), {
      ...r,
      version: r.version + 1,
      payload: { ...r.payload, ...patch },
      updated_at: this.tick(),
    });
  }

  count(type: string) {
    return [...this.records.values()].filter((r) => r.entity_type === type).length;
  }

  private tick() {
    this.clock += 1;
    return `2026-10-11T00:00:${String(this.clock).padStart(6, '0')}Z`;
  }
}
