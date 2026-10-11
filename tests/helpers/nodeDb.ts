import Database from 'better-sqlite3';

import type { SqlDb, SqlParams } from '@/data/local/db';
import { runMigrations } from '@/data/local/migrations';
import { seedIfNeeded } from '@/data/local/seed';

export type TestDb = SqlDb & { raw: Database.Database; close: () => void };

/**
 * better-sqlite3 implementation of SqlDb running the exact same SQL as the app.
 * Mirrors the app's locking contract: while a transaction is open, a write through the ROOT
 * handle (instead of the `tx` handle) throws — in the app it would deadlock on the write lock.
 * Foreign keys stay off to mirror the app configuration.
 */
export function openTestDb(file = ':memory:'): TestDb {
  const raw = new Database(file);
  raw.pragma('journal_mode = WAL');
  let inTx = false;
  const all = async <T>(sql: string, params: SqlParams = []) =>
    raw.prepare(sql).all(...params) as T[];
  const first = async <T>(sql: string, params: SqlParams = []) =>
    (raw.prepare(sql).get(...params) as T | undefined) ?? null;

  const tx: SqlDb = {
    all,
    first,
    exec: async (sql) => {
      raw.exec(sql);
    },
    run: async (sql, params: SqlParams = []) => ({
      changes: raw.prepare(sql).run(...params).changes,
    }),
    transaction: (fn) => fn(tx),
  };

  const guard = () => {
    if (inTx)
      throw new Error(
        'Root write while a transaction is open (would deadlock in the app). Use the tx handle.',
      );
  };

  const root: TestDb = {
    raw,
    close: () => raw.close(),
    all,
    first,
    exec: async (sql) => {
      guard();
      raw.exec(sql);
    },
    run: async (sql, params: SqlParams = []) => {
      guard();
      return { changes: raw.prepare(sql).run(...params).changes };
    },
    transaction: async (fn) => {
      guard();
      raw.exec('BEGIN IMMEDIATE');
      inTx = true;
      try {
        const r = await fn(tx);
        raw.exec('COMMIT');
        return r;
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      } finally {
        inTx = false;
      }
    },
  };
  return root;
}

/** Migrated + seeded database (in-memory unless a file path is given). */
export async function freshDb(file?: string): Promise<TestDb> {
  const db = openTestDb(file);
  await runMigrations(db);
  await seedIfNeeded(db);
  return db;
}
