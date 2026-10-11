import * as SQLite from 'expo-sqlite';

import type { SqlDb, SqlParams } from './db';

/**
 * expo-sqlite binding. All writes and transactions are serialized through one in-process lock on
 * a single connection, so a background sync can never make a set-logging write fail with
 * "database is locked". Reads are not serialized (WAL allows concurrent readers).
 */
function createLock() {
  let tail: Promise<unknown> = Promise.resolve();
  return function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = tail.then(fn, fn);
    tail = run.catch(() => undefined);
    return run;
  };
}

export async function openExpoDb(name = 'gymos.db'): Promise<SqlDb> {
  const db = await SQLite.openDatabaseAsync(name);
  // Foreign keys stay off: integrity is enforced in repositories (docs/DECISIONS.md, D-03).
  await db.execAsync(
    'PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;',
  );
  const withLock = createLock();

  const read = {
    all: <T>(sql: string, params: SqlParams = []) => db.getAllAsync<T>(sql, params),
    first: <T>(sql: string, params: SqlParams = []) => db.getFirstAsync<T>(sql, params),
  };

  // Inside a transaction the lock is already held: statements go straight to the connection.
  const inTx: SqlDb = {
    ...read,
    exec: (sql) => db.execAsync(sql),
    run: async (sql, params: SqlParams = []) => ({
      changes: (await db.runAsync(sql, params)).changes,
    }),
    transaction: (fn) => fn(inTx),
  };

  return {
    ...read,
    exec: (sql) => withLock(() => db.execAsync(sql)),
    run: (sql, params: SqlParams = []) =>
      withLock(async () => ({ changes: (await db.runAsync(sql, params)).changes })),
    transaction: <T>(fn: (tx: SqlDb) => Promise<T>) =>
      withLock(async () => {
        let result: T | undefined;
        await db.withTransactionAsync(async () => {
          result = await fn(inTx);
        });
        return result as T;
      }),
  };
}
