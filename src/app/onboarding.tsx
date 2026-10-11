import { router } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import {
  Button,
  Card,
  Header,
  Notice,
  ProgressBar,
  Row,
  Screen,
  Stack,
  Text,
  TextField,
} from '@/components';
import { DateField } from '@/components/DateField';
import { useMutation } from '@/data/DatabaseProvider';
import { createCampaign } from '@/data/local/repositories/campaign';
import { completeOnboarding } from '@/data/local/repositories/profile';
import { incrementCounter } from '@/data/local/repositories/settings';
import {
  AvailabilitySection,
  BodySection,
  EquipmentSection,
  GoalsSection,
  LimitationsSection,
} from '@/features/onboarding/ProfileSections';
import {
  draftFromProfile,
  profileInputFromDraft,
  validateDraft,
  type DraftErrors,
} from '@/features/onboarding/profileDraft';
import { now } from '@/utils/clock';
import { isDateKey, toDateKey } from '@/utils/dates';

const STEPS = [
  'welcome',
  'goals',
  'body',
  'availability',
  'equipment',
  'limitations',
  'campaign',
] as const;
type Step = (typeof STEPS)[number];

const TITLES: Record<Step, { title: string; subtitle: string }> = {
  welcome: { title: 'Welcome to GymOS', subtitle: 'Your private training operating system' },
  goals: { title: 'Your goals', subtitle: 'What are you training for?' },
  body: { title: 'About you', subtitle: 'All optional' },
  availability: { title: 'Your week', subtitle: 'How much time can you commit?' },
  equipment: { title: 'Equipment', subtitle: 'What you usually have access to' },
  limitations: { title: 'Preferences', subtitle: 'Movements to leave out' },
  campaign: { title: 'Campaign', subtitle: 'An optional target to aim for' },
};

export default function OnboardingScreen() {
  const [stepIndex, setStepIndex] = useState(0);
  const [draft, setDraft] = useState(() => draftFromProfile(null));
  const [errors, setErrors] = useState<DraftErrors>({});
  const [campaignName, setCampaignName] = useState('');
  const [campaignTarget, setCampaignTarget] = useState('');
  const finish = useMutation(async (db) => {
    await db.transaction(async (tx) => {
      await completeOnboarding(tx, profileInputFromDraft(draft, null));
      if (campaignName.trim()) {
        await createCampaign(tx, {
          name: campaignName,
          goal: null,
          start_date: toDateKey(now()),
          target_date: campaignTarget && isDateKey(campaignTarget) ? campaignTarget : null,
        });
      }
      await incrementCounter(tx, 'onboarding_completed');
    });
  });

  const step = STEPS[stepIndex]!;
  const isLast = stepIndex === STEPS.length - 1;

  const next = async () => {
    const scope =
      step === 'goals'
        ? 'goals'
        : step === 'body'
          ? 'body'
          : step === 'equipment'
            ? 'equipment'
            : null;
    if (scope) {
      const e = validateDraft(draft, scope);
      setErrors(e);
      if (Object.keys(e).length) return;
    }
    if (step === 'campaign' && campaignTarget && !isDateKey(campaignTarget)) return;
    if (!isLast) {
      setStepIndex((i) => i + 1);
      return;
    }
    try {
      await finish.run();
      router.replace('/');
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Please try again.');
    }
  };

  return (
    <Screen
      edges={['top', 'bottom']}
      footer={
        <Row>
          {stepIndex > 0 ? (
            <Button label="Back" variant="secondary" onPress={() => setStepIndex((i) => i - 1)} />
          ) : null}
          <Button
            label={step === 'welcome' ? 'Get started' : isLast ? 'Finish setup' : 'Continue'}
            onPress={next}
            loading={finish.pending}
            grow
            testID="onboarding-next"
          />
        </Row>
      }
    >
      <ProgressBar
        value={(stepIndex + 1) / STEPS.length}
        label={`Step ${stepIndex + 1} of ${STEPS.length}`}
      />
      <Header title={TITLES[step].title} subtitle={TITLES[step].subtitle} />
      {step === 'welcome' ? (
        <Stack gap={16}>
          <Card>
            <Text variant="bodyStrong">Works offline, no account needed</Text>
            <Text muted>
              Everything you log is saved on this device first. Cloud backup and the AI coach are
              optional and can be enabled later in Profile.
            </Text>
          </Card>
          <Card>
            <Text variant="bodyStrong">Honest progress</Text>
            <Text muted>
              GymOS rewards consistency, records exactly what you did, and never pretends an adapted
              or partial session was the full plan.
            </Text>
          </Card>
          <TextField
            label="What should we call you?"
            optional
            value={draft.display_name}
            onChangeText={(t) => setDraft({ ...draft, display_name: t })}
            maxLength={40}
          />
        </Stack>
      ) : null}
      {step === 'goals' ? <GoalsSection draft={draft} onChange={setDraft} errors={errors} /> : null}
      {step === 'body' ? <BodySection draft={draft} onChange={setDraft} errors={errors} /> : null}
      {step === 'availability' ? <AvailabilitySection draft={draft} onChange={setDraft} /> : null}
      {step === 'equipment' ? (
        <EquipmentSection draft={draft} onChange={setDraft} errors={errors} />
      ) : null}
      {step === 'limitations' ? <LimitationsSection draft={draft} onChange={setDraft} /> : null}
      {step === 'campaign' ? (
        <Stack gap={16}>
          <Text muted>
            A campaign is one focused block — e.g. &quot;12-week cut&quot; or &quot;Photoshoot
            prep&quot;. Skip it if you just want to train; you can start one any time.
          </Text>
          <TextField
            label="Campaign name"
            optional
            value={campaignName}
            onChangeText={setCampaignName}
            maxLength={60}
          />
          {campaignName.trim() ? (
            <DateField
              label="Target date"
              optional
              value={campaignTarget}
              onChange={setCampaignTarget}
              quick={[
                { label: '8 weeks', days: 56 },
                { label: '12 weeks', days: 84 },
                { label: '16 weeks', days: 112 },
              ]}
            />
          ) : null}
          <Notice
            tone="info"
            message="You can add starting measurements and private progress photos from the Progress tab after setup."
          />
        </Stack>
      ) : null}
    </Screen>
  );
}
