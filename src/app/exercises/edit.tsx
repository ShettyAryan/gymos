import { Stack as RouterStack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import {
  Button,
  ChipGroup,
  ErrorState,
  LoadingState,
  Notice,
  Screen,
  Segmented,
  Stepper,
  Text,
  TextField,
} from '@/components';
import { useMutation, useQuery } from '@/data/DatabaseProvider';
import { getExercise, saveCustomExercise } from '@/data/local/repositories/exercises';
import {
  EQUIPMENT,
  LOGGING_TYPES,
  MOVEMENT_PATTERNS,
  MUSCLES,
  type Equipment,
  type LoggingType,
  type MovementPattern,
  type Muscle,
} from '@/domain/models/constants';
import type { Exercise } from '@/domain/models/types';
import { runPickAction, type PickAction } from '@/features/exercises/pickActions';
import { formatClock } from '@/utils/dates';

export default function EditExerciseScreen() {
  const params = useLocalSearchParams<{ id?: string; pick?: PickAction; target?: string }>();
  const q = useQuery(async (db) => (params.id ? getExercise(db, params.id) : null), [params.id]);
  if (q.error) return <ErrorState message={q.error} />;
  if (q.data === undefined) return <LoadingState />;
  if (params.id && (!q.data || !q.data.is_custom))
    return <ErrorState title="Only custom exercises can be edited" />;
  return (
    <ExerciseForm
      existing={q.data}
      pick={params.pick && params.target ? { action: params.pick, target: params.target } : null}
    />
  );
}

const toggle = <T,>(list: T[], v: T) =>
  list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

function ExerciseForm({
  existing,
  pick,
}: {
  existing: Exercise | null;
  pick: { action: PickAction; target: string } | null;
}) {
  const [name, setName] = useState(existing?.name ?? '');
  const [pattern, setPattern] = useState<MovementPattern | null>(
    existing?.movement_pattern ?? null,
  );
  const [primary, setPrimary] = useState<Muscle[]>(existing?.primary_muscles ?? []);
  const [equipment, setEquipment] = useState<Equipment[]>(existing?.equipment ?? []);
  const [loggingType, setLoggingType] = useState<LoggingType>(
    existing?.logging_type ?? 'weight_reps',
  );
  const [rest, setRest] = useState(existing?.default_rest_seconds ?? 90);
  const [instructions, setInstructions] = useState(existing?.instructions ?? '');
  const [caution, setCaution] = useState(existing?.caution ?? '');

  const save = useMutation(async (db) => {
    const ex = await saveCustomExercise(db, {
      id: existing?.id,
      name: name.trim(),
      movement_pattern: pattern!,
      primary_muscles: primary,
      secondary_muscles: existing?.secondary_muscles ?? [],
      equipment,
      logging_type: loggingType,
      instructions: instructions.trim(),
      default_rest_seconds: rest,
      alternatives: existing?.alternatives ?? [],
      caution: caution.trim() || null,
      load_increment_kg: existing?.load_increment_kg ?? null,
    });
    if (pick) await runPickAction(db, pick.action, pick.target, ex.id);
    return ex;
  });

  const onSave = async () => {
    const problems = [
      !name.trim() && 'Add a name.',
      !pattern && 'Pick a movement pattern.',
      primary.length === 0 && 'Pick at least one primary muscle.',
    ].filter(Boolean);
    if (problems.length) return Alert.alert('Almost there', problems.join('\n'));
    try {
      await save.run();
      router.back();
      if (pick) router.back();
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : '');
    }
  };

  return (
    <Screen
      edges={['bottom']}
      footer={
        <Button
          label={existing ? 'Save exercise' : 'Create exercise'}
          onPress={onSave}
          loading={save.pending}
        />
      }
    >
      <RouterStack.Screen
        options={{ title: existing ? 'Edit custom exercise' : 'New custom exercise' }}
      />
      <TextField label="Name" value={name} onChangeText={setName} maxLength={60} />
      <ChipGroup
        label="Movement pattern"
        options={[...MOVEMENT_PATTERNS]}
        selected={pattern ? [pattern] : []}
        onToggle={(v) => setPattern(v)}
      />
      <ChipGroup
        label="Primary muscles"
        options={[...MUSCLES]}
        selected={primary}
        onToggle={(v) => setPrimary(toggle(primary, v))}
      />
      <ChipGroup
        label="Required equipment (none = bodyweight)"
        options={[...EQUIPMENT]}
        selected={equipment}
        onToggle={(v) => setEquipment(toggle(equipment, v))}
      />
      <Segmented
        label="How is it logged?"
        options={LOGGING_TYPES.slice(0, 3).map((l) => ({ ...l }))}
        value={
          (['weight_reps', 'bodyweight_reps', 'assisted_bodyweight'] as LoggingType[]).includes(
            loggingType,
          )
            ? loggingType
            : null
        }
        onChange={setLoggingType}
      />
      <Segmented
        options={LOGGING_TYPES.slice(3).map((l) => ({ ...l }))}
        value={
          (['duration', 'distance', 'hold'] as LoggingType[]).includes(loggingType)
            ? loggingType
            : null
        }
        onChange={setLoggingType}
      />
      <Stepper
        label="Default rest"
        value={rest}
        min={0}
        max={600}
        step={15}
        format={formatClock}
        onChange={setRest}
      />
      <TextField
        label="Instructions"
        optional
        multiline
        value={instructions}
        onChangeText={setInstructions}
        maxLength={600}
      />
      <TextField
        label="Caution note"
        optional
        value={caution}
        onChangeText={setCaution}
        maxLength={200}
      />
      <Notice
        tone="info"
        message="Custom exercises are yours: they sync with your backup and can be used in programmes and workouts."
      />
      <Text variant="caption" faint>
        Keep instructions practical; avoid medical claims.
      </Text>
    </Screen>
  );
}
