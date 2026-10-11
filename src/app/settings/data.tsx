import { File, Paths } from 'expo-file-system';
import { Stack as RouterStack, router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { Alert } from 'react-native';

import { Button, Card, Notice, Screen, Section, Text } from '@/components';
import { notifyDataChanged, useDb } from '@/data/DatabaseProvider';
import { incrementCounter } from '@/data/local/repositories/settings';
import { seedIfNeeded } from '@/data/local/seed';
import { isCloudConfigured } from '@/data/remote/config';
import { outboxStats } from '@/data/remote/sync/engine';
import { deletePhotoFile } from '@/features/photos/photoFiles';
import { buildExport, deleteAllLocalData } from '@/features/settings/exportData';
import { deleteAccount, deleteCloudData } from '@/features/sync/syncService';
import { toDateKey } from '@/utils/dates';

export default function DataScreen() {
  const db = useDb();
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      Alert.alert('Something went wrong', e instanceof Error ? e.message : '');
    } finally {
      setBusy(null);
    }
  };

  const onExport = () =>
    run('export', async () => {
      const data = await buildExport(db);
      const file = new File(Paths.cache, `gymos-export-${toDateKey(new Date())}.json`);
      file.create({ overwrite: true });
      file.write(JSON.stringify(data, null, 2));
      await incrementCounter(db, 'export_completed');
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: 'application/json',
          dialogTitle: 'Save your GymOS export',
        });
      } else {
        Alert.alert('Export created', file.uri);
      }
    });

  const onDeleteLocal = async () => {
    const stats = await outboxStats(db);
    const unsynced = stats.pending + stats.failed + stats.conflict;
    Alert.alert(
      'Delete all data on this device?',
      `${unsynced ? `${unsynced} change(s) have NOT been backed up and will be lost. ` : ''}This removes workouts, programmes, progress, photos and settings from this device. It cannot be undone. Export first if unsure.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete everything',
          style: 'destructive',
          onPress: () =>
            run('local', async () => {
              const uris = await deleteAllLocalData(db);
              uris.forEach(deletePhotoFile);
              await seedIfNeeded(db);
              notifyDataChanged();
              router.replace('/onboarding');
            }),
        },
      ],
    );
  };

  const onDeleteCloud = () =>
    Alert.alert(
      'Delete cloud backup?',
      'Removes all backed-up records and private photos from the cloud. Data on this device is kept, and cloud backup is switched off.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete cloud data',
          style: 'destructive',
          onPress: () =>
            run('cloud', async () => {
              await deleteCloudData(db);
              notifyDataChanged();
              Alert.alert('Cloud data deleted');
            }),
        },
      ],
    );

  const onDeleteAccount = () =>
    Alert.alert(
      'Delete account?',
      'Deletes your account, cloud backup and private photos permanently. Data on this device is kept until you delete it separately.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete account',
          style: 'destructive',
          onPress: () =>
            run('account', async () => {
              await deleteAccount(db);
              notifyDataChanged();
              Alert.alert('Account deleted');
            }),
        },
      ],
    );

  return (
    <Screen edges={['bottom']}>
      <RouterStack.Screen options={{ title: 'Export & delete' }} />
      <Section title="Export">
        <Card>
          <Text>
            Download everything you have logged as a JSON file (documented format, see
            docs/EXPORT_FORMAT.md). Photo files are not embedded.
          </Text>
          <Button label="Export my data" onPress={onExport} loading={busy === 'export'} />
        </Card>
      </Section>
      <Section title="Delete">
        <Notice
          tone="warning"
          message="Deletion is permanent. GymOS never deletes the only copy of unsynced data without telling you first."
        />
        <Button
          label="Delete all data on this device"
          variant="danger"
          onPress={onDeleteLocal}
          loading={busy === 'local'}
        />
        {isCloudConfigured() ? (
          <>
            <Button
              label="Delete cloud backup"
              variant="danger"
              onPress={onDeleteCloud}
              loading={busy === 'cloud'}
            />
            <Button
              label="Delete account"
              variant="danger"
              onPress={onDeleteAccount}
              loading={busy === 'account'}
            />
          </>
        ) : null}
      </Section>
    </Screen>
  );
}
