import { Stack as RouterStack } from 'expo-router';
import { Alert } from 'react-native';

import {
  Button,
  Card,
  ErrorState,
  LoadingState,
  Notice,
  Screen,
  Section,
  StatusPill,
  Text,
  ToggleRow,
} from '@/components';
import { useMutation, useQuery } from '@/data/DatabaseProvider';
import { getLatestConsent, recordConsent } from '@/data/local/repositories/aiConsent';
import { getPreferences, updatePreferences } from '@/data/local/repositories/settings';
import { isCloudConfigured } from '@/data/remote/config';
import { syncConsentToServer } from '@/features/coach/aiClient';
import { AI_DISCLOSURE, AI_POLICY_VERSION } from '@/features/coach/disclosure';

export default function AiSettingsScreen() {
  const q = useQuery(async (db) => ({
    prefs: await getPreferences(db),
    consent: await getLatestConsent(db),
  }));
  const grant = useMutation(async (db) => {
    await recordConsent(db, true, AI_POLICY_VERSION);
    await updatePreferences(db, { aiEnabled: true });
    await syncConsentToServer(true).catch(() => undefined);
  });
  const revoke = useMutation(async (db) => {
    await recordConsent(db, false, AI_POLICY_VERSION);
    await updatePreferences(db, { aiEnabled: false });
    await syncConsentToServer(false).catch(() => undefined);
  });
  const setMock = useMutation((db, v: boolean) => updatePreferences(db, { mockAi: v }));

  if (q.error) return <ErrorState message={q.error} />;
  if (!q.data) return <LoadingState />;
  const { prefs, consent } = q.data;
  const active =
    prefs.aiEnabled && consent?.granted && consent.policy_version === AI_POLICY_VERSION;

  return (
    <Screen edges={['bottom']}>
      <RouterStack.Screen options={{ title: 'AI coach & data' }} />
      <StatusPill
        label={active ? 'AI coach enabled' : 'AI coach disabled'}
        tone={active ? 'success' : 'neutral'}
      />
      <Card>
        <Text variant="heading">{AI_DISCLOSURE.title}</Text>
        {AI_DISCLOSURE.points.map((p) => (
          <Text key={p} muted>
            • {p}
          </Text>
        ))}
        <Text variant="caption" faint>
          Provider terms last checked {AI_DISCLOSURE.checkedOn} · notice version {AI_POLICY_VERSION}
        </Text>
      </Card>
      {!isCloudConfigured() ? (
        <Notice
          tone="info"
          message="This build has no cloud backend configured, so real AI requests are unavailable. Developers can use Mock AI below."
        />
      ) : null}
      {active ? (
        <Button
          label="Turn off AI and withdraw consent"
          variant="danger"
          onPress={() =>
            Alert.alert(
              'Turn off AI coach?',
              'No further data will be sent. Your local AI history can be cleared from the Coach tab.',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Turn off', style: 'destructive', onPress: () => revoke.run() },
              ],
            )
          }
        />
      ) : (
        <Button
          label="I understand — enable AI coach"
          onPress={() => grant.run()}
          loading={grant.pending}
        />
      )}
      <Section title="Developer">
        <ToggleRow
          label="Mock AI (development)"
          description="Generates labelled test responses on-device with no network. For trying the flows without credentials."
          value={prefs.mockAi}
          onChange={(v) => setMock.run(v)}
        />
      </Section>
    </Screen>
  );
}
