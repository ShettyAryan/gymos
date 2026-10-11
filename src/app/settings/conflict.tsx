import { Stack as RouterStack, router, useLocalSearchParams } from 'expo-router';
import { Alert } from 'react-native';

import { Button, Card, ErrorState, LoadingState, Screen, Text } from '@/components';
import { useDb, useMutation, useQuery } from '@/data/DatabaseProvider';
import { listOpenConflicts, resolveConflict } from '@/data/remote/sync/engine';
import { syncNow } from '@/features/sync/syncService';

const HIDDEN = new Set(['id', 'created_at', 'version', 'deleted_at']);

function diff(local: Record<string, unknown>, remote: Record<string, unknown> | null) {
  const keys = [...new Set([...Object.keys(local), ...Object.keys(remote ?? {})])].filter(
    (k) => !HIDDEN.has(k),
  );
  return keys
    .filter((k) => JSON.stringify(local[k]) !== JSON.stringify(remote?.[k]))
    .map((k) => ({ key: k, local: local[k], remote: remote?.[k] }));
}

export default function ConflictScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDb();
  const q = useQuery(
    async (d) => (await listOpenConflicts(d)).find((c) => c.id === id) ?? null,
    [id],
  );
  const resolve = useMutation((d, choice: 'keep_local' | 'use_remote') =>
    resolveConflict(d, id, choice),
  );
  if (q.error) return <ErrorState message={q.error} />;
  if (q.data === undefined) return <LoadingState />;
  if (!q.data) return <ErrorState title="Conflict already resolved" />;
  const local = JSON.parse(q.data.local_payload) as Record<string, unknown>;
  const remote = q.data.remote_payload
    ? (JSON.parse(q.data.remote_payload) as Record<string, unknown>)
    : null;
  const fields = diff(local, remote);

  const choose = (choice: 'keep_local' | 'use_remote') =>
    Alert.alert(
      choice === 'keep_local' ? 'Keep this device’s version?' : 'Use the cloud version?',
      'The other version will be replaced.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: async () => {
            await resolve.run(choice);
            syncNow(db);
            router.back();
          },
        },
      ],
    );

  return (
    <Screen edges={['bottom']}>
      <RouterStack.Screen options={{ title: 'Resolve conflict' }} />
      <Text muted>
        {q.data.entity_type.replace(/_/g, ' ')} · this device v{q.data.local_version} vs cloud v
        {q.data.remote_version ?? '—'}
      </Text>
      {fields.length === 0 ? <Text muted>Only metadata differs.</Text> : null}
      {fields.map((f) => (
        <Card key={f.key}>
          <Text variant="label" muted>
            {f.key.replace(/_/g, ' ').toUpperCase()}
          </Text>
          <Text variant="caption">This device: {JSON.stringify(f.local)?.slice(0, 300)}</Text>
          <Text variant="caption" muted>
            Cloud: {JSON.stringify(f.remote)?.slice(0, 300)}
          </Text>
        </Card>
      ))}
      <Button label="Keep this device’s version" onPress={() => choose('keep_local')} />
      <Button
        label="Use cloud version"
        variant="secondary"
        disabled={!remote}
        onPress={() => choose('use_remote')}
      />
    </Screen>
  );
}
