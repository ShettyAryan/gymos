import { Stack as RouterStack, router } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { Button, LoadingState, Screen, Section, TextField } from '@/components';
import { useMutation, useQuery } from '@/data/DatabaseProvider';
import { getProfile, saveProfile } from '@/data/local/repositories/profile';
import {
  AvailabilitySection,
  BodySection,
  EquipmentSection,
  GoalsSection,
  LimitationsSection,
} from '@/features/onboarding/ProfileSections';
import type { Profile } from '@/domain/models/types';
import {
  draftFromProfile,
  profileInputFromDraft,
  validateDraft,
  type DraftErrors,
  type ProfileDraft,
} from '@/features/onboarding/profileDraft';

export default function EditProfileScreen() {
  const profile = useQuery((db) => getProfile(db));
  if (profile.data === undefined) return <LoadingState />;
  return <EditProfileForm profile={profile.data} />;
}

function EditProfileForm({ profile }: { profile: Profile | null }) {
  const [draft, setDraft] = useState<ProfileDraft>(() => draftFromProfile(profile));
  const [errors, setErrors] = useState<DraftErrors>({});
  const save = useMutation((db, d: ProfileDraft) =>
    saveProfile(db, profileInputFromDraft(d, profile)),
  );

  const onSave = async () => {
    const e = validateDraft(draft);
    setErrors(e);
    if (Object.keys(e).length) {
      Alert.alert('Check your details', Object.values(e).join('\n'));
      return;
    }
    try {
      await save.run(draft);
      router.back();
    } catch (err) {
      Alert.alert('Could not save', err instanceof Error ? err.message : 'Please try again.');
    }
  };

  return (
    <Screen
      edges={['bottom']}
      footer={<Button label="Save profile" onPress={onSave} loading={save.pending} />}
    >
      <RouterStack.Screen options={{ title: 'Edit profile' }} />
      <TextField
        label="Name"
        optional
        value={draft.display_name}
        onChangeText={(t) => setDraft({ ...draft, display_name: t })}
      />
      <Section title="Goals">
        <GoalsSection draft={draft} onChange={setDraft} errors={errors} />
      </Section>
      <Section title="About you">
        <BodySection draft={draft} onChange={setDraft} errors={errors} />
      </Section>
      <Section title="Availability">
        <AvailabilitySection draft={draft} onChange={setDraft} />
      </Section>
      <Section title="Equipment">
        <EquipmentSection draft={draft} onChange={setDraft} errors={errors} />
      </Section>
      <Section title="Preferences">
        <LimitationsSection draft={draft} onChange={setDraft} />
      </Section>
    </Screen>
  );
}
