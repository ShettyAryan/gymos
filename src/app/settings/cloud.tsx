import { Stack as RouterStack, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';

import {
  Button,
  Card,
  ErrorState,
  ListRow,
  LoadingState,
  Notice,
  Row,
  Screen,
  Section,
  StatusPill,
  Text,
  TextField,
  ToggleRow,
} from '@/components';
import { useDb, useMutation, useQuery } from '@/data/DatabaseProvider';
import { getPreferences } from '@/data/local/repositories/settings';
import { isCloudConfigured } from '@/data/remote/config';
import { getSupabase } from '@/data/remote/supabaseClient';
import { listOpenConflicts, resetFailed } from '@/data/remote/sync/engine';
import {
  refreshSyncStatus,
  setCloudBackup,
  signIn,
  signOut,
  signUp,
  syncNow,
} from '@/features/sync/syncService';
import { useSyncStatus } from '@/state/sync';

export default function CloudScreen() {
  const db = useDb();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const q = useQuery(async (d) => ({
    prefs: await getPreferences(d),
    conflicts: await listOpenConflicts(d),
  }));
  const sync = useSyncStatus();
  const toggle = useMutation((d, v: boolean) => setCloudBackup(d, v));
  const retry = useMutation((d) => resetFailed(d));

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    sb.auth.getSession().then(({ data }) => setUserEmail(data.session?.user.email ?? null));
    const { data } = sb.auth.onAuthStateChange((_e, session) =>
      setUserEmail(session?.user.email ?? null),
    );
    refreshSyncStatus(db);
    return () => data.subscription.unsubscribe();
  }, [db]);

  if (q.error) return <ErrorState message={q.error} />;
  if (!q.data) return <LoadingState />;
  const { prefs, conflicts } = q.data;

  const run = async (fn: () => Promise<unknown>, okMsg?: string) => {
    setBusy(true);
    try {
      await fn();
      if (okMsg) Alert.alert(okMsg);
    } catch (e) {
      Alert.alert('Something went wrong', e instanceof Error ? e.message : '');
    } finally {
      setBusy(false);
      q.reload();
    }
  };

  return (
    <Screen edges={['bottom']}>
      <RouterStack.Screen options={{ title: 'Cloud backup & sync' }} />
      <Notice
        tone="info"
        title="Optional, best-effort backup"
        message="GymOS works fully offline. Backup uses Supabase's free tier, which has no guaranteed backup or uptime (free projects pause after a week of inactivity). Export your data regularly if it matters to you."
      />
      {!isCloudConfigured() ? (
        <Card>
          <Text variant="heading">Not configured in this build</Text>
          <Text muted>
            Cloud backup needs EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY at build
            time (see README). You are in local-only mode — nothing leaves this device.
          </Text>
        </Card>
      ) : !userEmail ? (
        <Card>
          <Text variant="heading">Sign in to back up</Text>
          <TextField
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
          />
          <TextField
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="password"
          />
          <Row>
            <Button
              label="Sign in"
              grow
              loading={busy}
              disabled={!email || password.length < 8}
              onPress={() => run(() => signIn(email, password))}
            />
            <Button
              label="Create account"
              variant="secondary"
              grow
              disabled={!email || password.length < 8}
              onPress={() =>
                run(async () => {
                  const r = await signUp(email, password);
                  if (r.needsConfirmation)
                    Alert.alert('Check your email', 'Confirm your address, then sign in.');
                })
              }
            />
          </Row>
          <Text variant="caption" faint>
            Passwords need at least 8 characters. Your session token is kept in the device keychain.
          </Text>
        </Card>
      ) : (
        <>
          <Card>
            <Row>
              <Text style={{ flex: 1 }} numberOfLines={1}>
                {userEmail}
              </Text>
              <StatusPill
                label={sync.status === 'idle' ? 'Up to date' : sync.status.replace('_', ' ')}
                tone={
                  sync.status === 'idle'
                    ? 'success'
                    : sync.status === 'error' || sync.status === 'auth_required'
                      ? 'danger'
                      : 'neutral'
                }
              />
            </Row>
            <ToggleRow
              label="Back up and sync"
              description="Records and private photos (photos never go to AI)."
              value={prefs.cloudSync}
              onChange={async (v) => {
                await toggle.run(v);
                if (v) syncNow(db);
              }}
            />
            <Text variant="caption" muted>
              {sync.pending} change(s) waiting · last sync{' '}
              {sync.lastSyncAt ? new Date(sync.lastSyncAt).toLocaleString() : 'never'}
            </Text>
            {sync.lastError && sync.status !== 'idle' ? (
              <Notice tone="warning" message={sync.lastError} />
            ) : null}
            <Row>
              <Button
                label="Sync now"
                variant="secondary"
                loading={sync.status === 'syncing'}
                disabled={!prefs.cloudSync}
                onPress={() => syncNow(db)}
                grow
              />
              <Button
                label="Retry failed"
                variant="ghost"
                onPress={() => retry.run().then(() => syncNow(db))}
              />
            </Row>
          </Card>
          <Button
            label="Sign out"
            variant="secondary"
            onPress={() =>
              Alert.alert(
                'Sign out?',
                'Your data stays on this device. Unsynced changes stay queued until you sign in again.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Sign out', onPress: () => run(() => signOut(db)) },
                ],
              )
            }
          />
        </>
      )}

      {conflicts.length > 0 ? (
        <Section title="Conflicts">
          <Notice
            tone="warning"
            message="These records changed both here and in the cloud. Nothing was overwritten — choose which version to keep."
          />
          {conflicts.map((c) => (
            <ListRow
              key={c.id}
              title={c.entity_type.replace(/_/g, ' ')}
              subtitle={`Detected ${new Date(c.detected_at).toLocaleString()}`}
              onPress={() => router.push({ pathname: '/settings/conflict', params: { id: c.id } })}
            />
          ))}
        </Section>
      ) : null}
    </Screen>
  );
}
