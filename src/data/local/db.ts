/**
 * Minimal async SQL interface used by every repository.
 * The app binds it to expo-sqlite; tests bind it to better-sqlite3 running the same SQL,
 * so migrations, transactions and outbox atomicity are tested for real.
 */
export type SqlValue = string | number | null;
export type SqlParams = SqlValue[];

export interface SqlDb {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: SqlParams): Promise<{ changes: number }>;
  all<T>(sql: string, params?: SqlParams): Promise<T[]>;
  first<T>(sql: string, params?: SqlParams): Promise<T | null>;
  /**
   * Run `fn` atomically. Only statements issued through `tx` are part of the transaction.
   * Throwing inside `fn` rolls everything back.
   */
  transaction<T>(fn: (tx: SqlDb) => Promise<T>): Promise<T>;
}

/** Converts booleans/undefined to SQLite-friendly values. */
export function sqlValue(v: unknown): SqlValue {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number' || typeof v === 'string') return v;
  return JSON.stringify(v);
}
