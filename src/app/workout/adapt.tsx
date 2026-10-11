import { Stack as RouterStack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import {
  Button,
  Card,
  ChipGroup,
  ErrorState,
  Header,
  LoadingState,
  Notice,
  Row,
  Screen,
  Section,
  Segmented,
  StatusPill,
  Stepper,
  Text,
} from '@/components';
import { useMutation, useQuery } from '@/data/DatabaseProvider';
import { getExerciseMap } from '@/data/local/repositories/exercises';
import { getProfile } from '@/data/local/repositories/profile';
import { getVersion } from '@/data/local/repositories/programmes';
import { incrementCounter } from '@/data/local/repositories/settings';
import { startSession } from '@/data/local/repositories/workouts';
import {
  ALL_EQUIPMENT,
  EQUIPMENT,
  LOCATION_EQUIPMENT,
  type Equipment,
} from '@/domain/models/constants';
import type { DaySnapshot, Exercise, Profile } from '@/domain/models/types';
import {
  proposeAdaptation,
  type AdaptationReason,
  type AdaptiveProposal,
  type Energy,
} from '@/domain/rules/adaptiveDay';
import { estimateSessionMinutes } from '@/domain/rules/timeEstimate';
import { PlanAlternatives } from '@/features/adaptive-day/PlanAlternatives';
import { colors, spacing, type StatusTone } from '@/theme/tokens';
import { formatDateKey } from '@/utils/dates';

export default function AdaptScreen() {
  const params = useLocalSearchParams<{ versionId: string; dayId: string; date: string }>();
  const q = useQuery(
    async (db) => {
      const [version, exercises, profile] = await Promise.all([
        getVersion(db, params.versionId),
        getExerciseMap(db),
        getProfile(db),
      ]);
      return { version, exercises, profile };
    },
    [params.versionId],
  );
  if (q.error) return <ErrorState message={q.error} />;
  if (!q.data) return <LoadingState />;
  const day = q.data.version?.snapshot.days.find((d) => d.id === params.dayId);
  if (!q.data.version || !day) return <ErrorState title="Planned session not found" />;
  return (
    <AdaptForm
      day={day}
      versionId={q.data.version.id}
      programmeId={q.data.version.programme_id}
      date={params.date}
      exercises={q.data.exercises}
      profile={q.data.profile}
    />
  );
}

type EquipmentChoice = 'usual' | 'full_gym' | 'home_gym' | 'minimal' | 'custom';

function AdaptForm(props: {
  day: DaySnapshot;
  versionId: string;
  programmeId: string;
  date: string;
  exercises: Map<string, Exercise>;
  profile: Profile | null;
}) {
  const { day, exercises, profile } = props;
  const planned = estimateSessionMinutes(
    day.exercises.map((e) => ({
      sets: e.sets,
      repMax: e.repMax,
      restSeconds: e.restSeconds,
      loggingType: exercises.get(e.exerciseId)?.logging_type ?? 'weight_reps',
    })),
  );
  const [minutes, setMinutes] = useState(Math.min(planned || 60, 30));
  const [equipChoice, setEquipChoice] = useState<EquipmentChoice>('usual');
  const [customEquip, setCustomEquip] = useState<Equipment[]>(profile?.equipment ?? []);
  const [energy, setEnergy] = useState<Energy | 'skip'>('skip');
  const [reason, setReason] = useState<AdaptationReason | null>(null);

  const equipment: Equipment[] =
    equipChoice === 'usual'
      ? (profile?.equipment ?? ALL_EQUIPMENT)
      : equipChoice === 'custom'
        ? customEquip
        : LOCATION_EQUIPMENT[equipChoice];

  // Pure and cheap: recomputed on every change so the proposal is always live.
  const proposal: AdaptiveProposal = proposeAdaptation({
    day,
    availableMinutes: minutes,
    equipment,
    energy: energy === 'skip' ? null : energy,
    avoidPatterns: profile?.avoid_patterns ?? [],
    excludedExerciseIds: profile?.excluded_exercise_ids ?? [],
    exercises,
  });

  const start = useMutation(async (db) => {
    const s = await startSession(db, {
      kind: 'adapted',
      programmeId: props.programmeId,
      versionId: props.versionId,
      day,
      plannedDate: props.date,
      proposal,
      reason,
      reasonNote: null,
      constraints: {
        availableMinutes: minutes,
        equipment,
        energy: energy === 'skip' ? null : energy,
      },
    });
    await incrementCounter(db, 'adapted_workout_approved');
    return s;
  });

  const onApprove = async () => {
    try {
      await start.run();
      router.replace('/workout/active');
    } catch (e) {
      Alert.alert('Could not start', e instanceof Error ? e.message : '');
    }
  };

  const tone: Record<string, StatusTone> = {
    included: 'success',
    substituted: 'info',
    deferred: 'warning',
    removed: 'neutral',
  };
  const label: Record<string, string> = {
    included: 'Included',
    substituted: 'Substituted',
    deferred: 'Deferred',
    removed: 'Removed',
  };

  return (
    <Screen
      edges={['bottom']}
      footer={
        proposal.feasible ? (
          <Button
            label={`Approve & start · ~${proposal.estimatedMinutes} min`}
            variant="live"
            onPress={onApprove}
            loading={start.pending}
          />
        ) : undefined
      }
    >
      <RouterStack.Screen options={{ title: 'Adapt today’s workout' }} />
      <Header
        eyebrow={`${formatDateKey(props.date)} · planned ~${planned} min`}
        title={day.title}
        subtitle="Your programme is not changed."
      />

      <Section title="Time available">
        <Segmented
          options={[planned, 45, 30, 20, 15]
            .filter((v, i, a) => v > 0 && a.indexOf(v) === i)
            .map((v) => ({ value: String(v), label: v === planned ? `Full` : `${v}m` }))}
          value={String(minutes)}
          onChange={(v) => setMinutes(Number(v))}
        />
        <Stepper
          label="Custom"
          value={minutes}
          min={5}
          max={180}
          step={5}
          format={(v) => `${v} min`}
          onChange={setMinutes}
        />
      </Section>

      <Section title="Equipment today">
        <Segmented
          options={[
            { value: 'usual', label: 'Usual' },
            { value: 'full_gym', label: 'Gym' },
            { value: 'home_gym', label: 'Home' },
            { value: 'minimal', label: 'Minimal' },
            { value: 'custom', label: 'Custom' },
          ]}
          value={equipChoice}
          onChange={setEquipChoice}
        />
        {equipChoice === 'custom' ? (
          <ChipGroup
            options={[...EQUIPMENT]}
            selected={customEquip}
            onToggle={(v) =>
              setCustomEquip(
                customEquip.includes(v) ? customEquip.filter((x) => x !== v) : [...customEquip, v],
              )
            }
          />
        ) : null}
      </Section>

      <Section title="Energy (optional)">
        <Segmented
          options={[
            { value: 'skip', label: 'Skip' },
            { value: 'low', label: 'Low' },
            { value: 'normal', label: 'Normal' },
            { value: 'high', label: 'High' },
          ]}
          value={energy}
          onChange={setEnergy}
        />
      </Section>

      <Section title="Reason (optional)">
        <Segmented
          options={[
            { value: 'schedule', label: 'Time' },
            { value: 'equipment', label: 'Kit' },
            { value: 'fatigue', label: 'Fatigue' },
            { value: 'travel', label: 'Travel' },
            { value: 'custom', label: 'Other' },
          ]}
          value={reason}
          onChange={setReason}
        />
      </Section>

      <Section title="Proposal">
        <Card>
          <Row align="flex-end">
            <View style={{ flex: 1, gap: spacing.xs }}>
              <Text variant="label" muted>
                {proposal.feasible
                  ? proposal.label === 'as_planned'
                    ? 'Fits as planned'
                    : 'Proposed'
                  : 'Not feasible'}
              </Text>
              <Text variant="heading">
                {proposal.feasible ? proposal.title : 'No realistic session today'}
              </Text>
            </View>
            {proposal.feasible ? (
              <Text variant="metric" color={colors.accent}>
                {proposal.estimatedMinutes}
                <Text variant="caption" muted>
                  {' '}
                  min
                </Text>
              </Text>
            ) : null}
          </Row>
          {proposal.infeasibleReason ? (
            <Notice tone="warning" message={proposal.infeasibleReason} />
          ) : null}
          {proposal.rationale.map((r) => (
            <Text key={r} variant="caption" muted>
              {r}
            </Text>
          ))}
          <View>
            {proposal.items.map((i) => (
              <View key={i.programmeExerciseId} style={styles.item}>
                <Row align="flex-start">
                  <View style={styles.statusCol}>
                    <StatusPill label={label[i.disposition]!} tone={tone[i.disposition]!} />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text numberOfLines={2}>
                      {i.disposition === 'substituted' ? i.exerciseName : i.plannedName}
                    </Text>
                    {i.disposition === 'substituted' ? (
                      <Text variant="caption" muted>
                        for {i.plannedName}
                      </Text>
                    ) : null}
                    {i.reasons.map((r) => (
                      <Text key={r} variant="caption" faint>
                        {r}
                      </Text>
                    ))}
                  </View>
                  {i.disposition === 'included' || i.disposition === 'substituted' ? (
                    <Text variant="caption" muted style={styles.sets}>
                      {i.proposedSets}
                      {i.proposedSets < i.plannedSets ? `/${i.plannedSets}` : ''} sets
                    </Text>
                  ) : null}
                </Row>
              </View>
            ))}
          </View>
          {proposal.warnings.map((w) => (
            <Text key={w} variant="caption" faint>
              {w}
            </Text>
          ))}
        </Card>
      </Section>

      <Section title="Other options">
        <PlanAlternatives
          date={props.date}
          dayId={day.id}
          dayTitle={day.title}
          versionId={props.versionId}
        />
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  item: {
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  statusCol: { width: 104, paddingTop: 3 },
  sets: { minWidth: 52, textAlign: 'right', paddingTop: 2, fontVariant: ['tabular-nums'] },
});
