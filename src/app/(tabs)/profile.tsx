import { router } from 'expo-router';
import { Alert } from 'react-native';

import {
  ErrorState,
  Header,
  List,
  ListRow,
  LoadingState,
  OfflineBanner,
  Screen,
  Section,
  SectionAction,
  Stepper,
  Text,
  ToggleRow,
} from '@/components';
import { useMutation, useQuery } from '@/data/DatabaseProvider';
import { getActiveCampaign } from '@/data/local/repositories/campaign';
import { getProfile } from '@/data/local/repositories/profile';
import { getPreferences, updatePreferences } from '@/data/local/repositories/settings';
import { EQUIPMENT, EXPERIENCE, GOALS, labelOf, LOCATIONS } from '@/domain/models/constants';
import { setRemindersEnabled } from '@/features/settings/reminders';
import { useSyncStatus } from '@/state/sync';
import { WEEKDAY_SHORT } from '@/utils/dates';

const syncLabel: Record<string, string> = {
  disabled: 'Off · local only',
  idle: 'Backed up',
  syncing: 'Syncing…',
  offline: 'Waiting for connection',
  auth_required: 'Sign in needed',
  error: 'Sync error',
};

export default function ProfileScreen() {
  const q = useQuery(async (db) => ({
    profile: await getProfile(db),
    prefs: await getPreferences(db),
    campaign: await getActiveCampaign(db),
  }));
  const sync = useSyncStatus();
  const reminders = useMutation((db, enabled: boolean, hour?: number) =>
    setRemindersEnabled(db, enabled, hour),
  );
  const restAuto = useMutation((db, v: boolean) => updatePreferences(db, { restTimerAuto: v }));

  if (q.error) return <ErrorState message={q.error} onRetry={q.reload} />;
  if (!q.data) return <LoadingState />;
  const { profile, prefs, campaign } = q.data;

  const toggleReminders = async (v: boolean) => {
    const r = await reminders.run(v);
    if (v && !r.ok)
      Alert.alert(
        'Notifications blocked',
        'Allow notifications for GymOS in system settings to get reminders.',
      );
  };
  const edit = () => router.push('/profile/edit');
  const syncValue = `${syncLabel[sync.status] ?? sync.status}${sync.pending ? ` · ${sync.pending} pending` : ''}${sync.conflicts ? ` · ${sync.conflicts} conflict` : ''}`;

  return (
    <Screen>
      <OfflineBanner />
      <Header
        eyebrow="Profile"
        title={profile?.display_name || 'You'}
        right={<SectionAction label="Edit" onPress={edit} />}
      />

      <Section title="Training profile">
        <List>
          <ListRow
            title="Goals"
            value={profile?.goals.map((g) => labelOf(GOALS, g)).join(', ') || '—'}
            onPress={edit}
            chevron={false}
          />
          <ListRow
            title="Experience"
            value={labelOf(EXPERIENCE, profile?.experience) || '—'}
            onPress={edit}
            chevron={false}
          />
          <ListRow
            title="Week"
            value={`${profile?.weekly_target ?? '—'} sessions · ${profile?.session_minutes ?? '—'} min`}
            onPress={edit}
            chevron={false}
          />
          <ListRow
            title="Days"
            value={profile?.preferred_days.map((d) => WEEKDAY_SHORT[d]).join(' ') || '—'}
            onPress={edit}
            chevron={false}
          />
          <ListRow
            title="Equipment"
            value={`${labelOf(LOCATIONS, profile?.location) || 'Custom'} · ${profile?.equipment.length ? `${profile.equipment.length} items` : 'bodyweight'}`}
            onPress={edit}
            chevron={false}
          />
        </List>
        {profile?.equipment.length ? (
          <Text variant="caption" faint>
            {profile.equipment.map((e) => labelOf(EQUIPMENT, e)).join(' · ')}
          </Text>
        ) : null}
      </Section>

      <Section title="Training">
        <List>
          <ListRow title="Programmes" onPress={() => router.push('/programmes')} />
          <ListRow
            title="Campaign"
            value={campaign?.name ?? 'None'}
            onPress={() => router.push('/campaign')}
          />
          <ToggleRow
            label="Auto-start rest timer"
            description="After each logged working set"
            value={prefs.restTimerAuto}
            onChange={(v) => restAuto.run(v)}
          />
        </List>
      </Section>

      <Section title="Reminders">
        <List>
          <ToggleRow
            label="Training-day reminders"
            description="Local notifications on planned days"
            value={prefs.remindersEnabled}
            onChange={toggleReminders}
            divided={prefs.remindersEnabled}
          />
          {prefs.remindersEnabled ? (
            <Stepper
              label="Time"
              value={prefs.reminderHour}
              min={5}
              max={22}
              format={(h) => `${h}:00`}
              onChange={(h) => reminders.run(true, h)}
            />
          ) : null}
        </List>
      </Section>

      <Section title="Privacy & data">
        <List>
          <ListRow
            title="Cloud backup"
            value={syncValue}
            onPress={() => router.push('/settings/cloud')}
          />
          <ListRow
            title="AI coach"
            value={prefs.aiEnabled ? 'On' : 'Off'}
            onPress={() => router.push('/settings/ai')}
          />
          <ListRow title="Export or delete data" onPress={() => router.push('/settings/data')} />
        </List>
      </Section>

      <Text variant="caption" faint>
        Offline-first. Your data stays on this device unless you turn on backup.
      </Text>
    </Screen>
  );
}
