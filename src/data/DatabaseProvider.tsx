import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { create } from 'zustand';

import { ErrorState, LoadingState, Screen } from '@/components';

import type { SqlDb } from './local/db';
import { openExpoDb } from './local/expoDb';
import { runMigrations } from './local/migrations';
import { seedIfNeeded } from './local/seed';

const DbContext = createContext<SqlDb | null>(null);

/** Bumped after every local mutation so mounted queries re-read from SQLite. */
const useDataVersion = create<{ v: number }>(() => ({ v: 0 }));

export function notifyDataChanged(): void {
  useDataVersion.setState((s) => ({ v: s.v + 1 }));
}

export function DatabaseProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<SqlDb | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const opened = await openExpoDb();
        await runMigrations(opened);
        await seedIfNeeded(opened);
        if (!cancelled) setDb(opened);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : 'Could not open the local database.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (error) {
    return (
      <Screen scroll={false}>
        <ErrorState
          title="Local database unavailable"
          message={`${error}\nYour data has not been modified.`}
          onRetry={() => {
            setError(null);
            setAttempt((a) => a + 1);
          }}
        />
      </Screen>
    );
  }
  if (!db) {
    return (
      <Screen scroll={false}>
        <LoadingState label="Opening your data…" />
      </Screen>
    );
  }
  return <DbContext.Provider value={db}>{children}</DbContext.Provider>;
}

/** Provides an already-open database (used by component tests). */
export function StaticDatabaseProvider({ db, children }: { db: SqlDb; children: ReactNode }) {
  return <DbContext.Provider value={db}>{children}</DbContext.Provider>;
}

export function useDb(): SqlDb {
  const db = useContext(DbContext);
  if (!db) throw new Error('useDb must be used inside DatabaseProvider');
  return db;
}

export type QueryState<T> = {
  data: T | undefined;
  loading: boolean;
  error: string | null;
  reload: () => void;
};

/**
 * Reads from the local database and re-runs whenever data changes (notifyDataChanged) or deps change.
 * The database is the source of truth; this hook holds no canonical state.
 */
export function useQuery<T>(fn: (db: SqlDb) => Promise<T>, deps: unknown[] = []): QueryState<T> {
  const db = useDb();
  const v = useDataVersion((s) => s.v);
  const [nonce, setNonce] = useState(0);
  const requestKey = `${v}:${nonce}:${JSON.stringify(deps)}`;
  const [state, setState] = useState<{
    key: string | null;
    data: T | undefined;
    error: string | null;
  }>({
    key: null,
    data: undefined,
    error: null,
  });
  const fnRef = useRef(fn);
  // Keep the latest closure without re-running the query on every render (declared first so it
  // runs before the query effect in the same commit).
  useEffect(() => {
    fnRef.current = fn;
  });

  useEffect(() => {
    let cancelled = false;
    fnRef
      .current(db)
      .then((data) => {
        if (!cancelled) setState({ key: requestKey, data, error: null });
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setState((s) => ({
            ...s,
            key: requestKey,
            error: e instanceof Error ? e.message : String(e),
          }));
      });
    return () => {
      cancelled = true;
    };
  }, [db, requestKey]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data: state.data, error: state.error, loading: state.key !== requestKey, reload };
}

/** Wraps a mutation: runs it, then notifies queries. Errors are rethrown to the caller. */
export function useMutation<A extends unknown[], R>(fn: (db: SqlDb, ...args: A) => Promise<R>) {
  const db = useDb();
  const [pending, setPending] = useState(false);
  const run = async (...args: A): Promise<R> => {
    setPending(true);
    try {
      const r = await fn(db, ...args);
      notifyDataChanged();
      return r;
    } finally {
      setPending(false);
    }
  };
  return { run, pending };
}
