import NetInfo from '@react-native-community/netinfo';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { useDb } from '@/data/DatabaseProvider';
import { recoverInFlight } from '@/data/remote/sync/engine';

import { refreshSyncStatus, syncNow } from './syncService';

const INTERVAL_MS = 5 * 60_000;

/**
 * Background sync triggers: launch, returning to the foreground, regaining connectivity and a
 * slow interval. Sync is fully asynchronous and never part of the logging path.
 */
export function SyncManager() {
  const db = useDb();
  useEffect(() => {
    let cancelled = false;
    recoverInFlight(db)
      .then(() => refreshSyncStatus(db))
      .then(() => {
        if (!cancelled) syncNow(db);
      })
      .catch(() => undefined);

    const appSub = AppState.addEventListener('change', (s) => {
      if (s === 'active') syncNow(db);
    });
    let wasOnline: boolean | null = null;
    const netUnsub = NetInfo.addEventListener((state) => {
      const online = state.isConnected === true && state.isInternetReachable !== false;
      if (online && wasOnline === false) syncNow(db);
      wasOnline = online;
    });
    const timer = setInterval(() => syncNow(db), INTERVAL_MS);
    return () => {
      cancelled = true;
      appSub.remove();
      netUnsub();
      clearInterval(timer);
    };
  }, [db]);
  return null;
}
