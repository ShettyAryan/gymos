import { router } from 'expo-router';
import { Alert } from 'react-native';

import type { SqlDb } from '@/data/local/db';
import { getVersion } from '@/data/local/repositories/programmes';
import { incrementCounter } from '@/data/local/repositories/settings';
import { ActiveSessionExistsError, startSession } from '@/data/local/repositories/workouts';
import type { DateKey } from '@/utils/dates';

/** Starts a planned day from an approved version. plannedDate null = off-schedule (extra) session. */
export async function startPlanned(
  db: SqlDb,
  versionId: string,
  dayId: string,
  plannedDate: DateKey | null,
) {
  const v = await getVersion(db, versionId);
  const day = v?.snapshot.days.find((d) => d.id === dayId);
  if (!v || !day) throw new Error('Planned session not found.');
  const s = await startSession(db, {
    kind: 'planned',
    programmeId: v.programme_id,
    versionId,
    day,
    plannedDate,
  });
  await incrementCounter(db, 'workout_started');
  return s;
}

export async function startFreeform(db: SqlDb) {
  const s = await startSession(db, { kind: 'freeform' });
  await incrementCounter(db, 'workout_started');
  return s;
}

/** Shared UI handling for start actions. */
export async function runStart(fn: () => Promise<unknown>) {
  try {
    await fn();
    router.push('/workout/active');
  } catch (e) {
    if (e instanceof ActiveSessionExistsError) {
      Alert.alert('Workout in progress', e.message, [
        { text: 'OK', style: 'cancel' },
        { text: 'Open it', onPress: () => router.push('/workout/active') },
      ]);
      return;
    }
    Alert.alert('Could not start', e instanceof Error ? e.message : '');
  }
}
