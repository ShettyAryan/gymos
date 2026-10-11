import { Stack as RouterStack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import {
  Button,
  ErrorState,
  List,
  ListRow,
  LoadingState,
  Screen,
  Section,
  Segmented,
  Stepper,
  Text,
  TextField,
} from '@/components';
import { useMutation, useQuery } from '@/data/DatabaseProvider';
import { getExerciseMap } from '@/data/local/repositories/exercises';
import {
  removeProgrammeExercise,
  updateProgrammeExercise,
} from '@/data/local/repositories/programmes';
import { getEntity } from '@/data/local/store';
import { PRIORITIES, type Priority } from '@/domain/models/constants';
import type { Exercise, ProgrammeExercise } from '@/domain/models/types';
import { prescriptionSchema } from '@/domain/validation/programme';
import { formatClock } from '@/utils/dates';

export default function ProgrammeItemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useQuery(
    async (db) => ({
      item: await getEntity<ProgrammeExercise>(db, 'programme_exercise', id),
      exercises: await getExerciseMap(db),
    }),
    [id],
  );
  if (q.error) return <ErrorState message={q.error} />;
  if (!q.data) return <LoadingState />;
  if (!q.data.item || q.data.item.deleted_at)
    return <ErrorState title="Exercise not found in programme" />;
  return <ItemForm key={q.data.item.version} item={q.data.item} exercises={q.data.exercises} />;
}

function ItemForm({
  item,
  exercises,
}: {
  item: ProgrammeExercise;
  exercises: Map<string, Exercise>;
}) {
  const ex = exercises.get(item.exercise_id);
  const timed = ex?.logging_type === 'duration' || ex?.logging_type === 'hold';
  const [sets, setSets] = useState(item.sets);
  const [repMin, setRepMin] = useState(item.rep_min);
  const [repMax, setRepMax] = useState(item.rep_max);
  const [rest, setRest] = useState(item.rest_seconds);
  const [rir, setRir] = useState<string>(
    item.target_rir === null ? 'none' : String(item.target_rir),
  );
  const [priority, setPriority] = useState<Priority>(item.priority);
  const [notes, setNotes] = useState(item.notes ?? '');

  const save = useMutation((db) =>
    updateProgrammeExercise(db, item.id, {
      sets,
      rep_min: repMin,
      rep_max: repMax,
      rest_seconds: rest,
      target_rir: rir === 'none' ? null : Number(rir),
      priority,
      notes: notes.trim() || null,
    }),
  );
  const remove = useMutation((db) => removeProgrammeExercise(db, item.id));
  const removeAlt = useMutation((db, altId: string) =>
    updateProgrammeExercise(db, item.id, {
      alternative_ids: item.alternative_ids.filter((a) => a !== altId),
    }),
  );

  const onSave = async () => {
    const check = prescriptionSchema.safeParse({
      sets,
      rep_min: repMin,
      rep_max: repMax,
      rest_seconds: rest,
      target_rir: rir === 'none' ? null : Number(rir),
    });
    if (!check.success)
      return Alert.alert(
        'Check the prescription',
        check.error.issues.map((i) => i.message).join('\n'),
      );
    await save.run();
    router.back();
  };

  const unit = timed ? 's' : ' reps';
  return (
    <Screen
      edges={['bottom']}
      footer={<Button label="Save" onPress={onSave} loading={save.pending} />}
    >
      <RouterStack.Screen options={{ title: ex?.name ?? 'Exercise' }} />
      <Section title="Exercise">
        <List>
          <ListRow
            title={ex?.name ?? 'Missing exercise'}
            value="Replace"
            onPress={() =>
              router.push({
                pathname: '/exercises',
                params: { pick: 'replace_programme_exercise', target: item.id },
              })
            }
          />
        </List>
      </Section>
      <Section title="Prescription">
        <Stepper label="Working sets" value={sets} min={1} max={8} onChange={setSets} />
        {ex?.logging_type !== 'distance' ? (
          <>
            <Stepper
              label={timed ? 'Min seconds' : 'Min reps'}
              value={repMin}
              min={1}
              max={timed ? 600 : 100}
              step={timed ? 5 : 1}
              format={(v) => `${v}${unit}`}
              onChange={(v) => {
                setRepMin(v);
                if (v > repMax) setRepMax(v);
              }}
            />
            <Stepper
              label={timed ? 'Max seconds' : 'Max reps'}
              value={repMax}
              min={1}
              max={timed ? 600 : 100}
              step={timed ? 5 : 1}
              format={(v) => `${v}${unit}`}
              onChange={(v) => {
                setRepMax(v);
                if (v < repMin) setRepMin(v);
              }}
            />
          </>
        ) : null}
        <Stepper
          label="Rest between sets"
          value={rest}
          min={0}
          max={600}
          step={15}
          format={formatClock}
          onChange={setRest}
        />
      </Section>
      <Section title="Effort & priority">
        <Segmented
          label="Reps in reserve · optional"
          options={[
            { value: 'none', label: 'None' },
            ...['0', '1', '2', '3', '4'].map((v) => ({ value: v, label: v })),
          ]}
          value={rir}
          onChange={setRir}
        />
        <Segmented
          label="Priority (used by Adaptive Day)"
          options={[...PRIORITIES]}
          value={priority}
          onChange={setPriority}
        />
        <Text variant="caption" faint>
          When time is short, Adaptive Day keeps primary work first and defers accessories.
        </Text>
      </Section>
      <TextField
        label="Notes"
        optional
        multiline
        value={notes}
        onChangeText={setNotes}
        maxLength={300}
      />

      <Section title="Alternatives">
        {item.alternative_ids.length === 0 ? <Text muted>No alternatives set.</Text> : null}
        <List>
          {item.alternative_ids.map((a) => (
            <ListRow
              key={a}
              title={exercises.get(a)?.name ?? 'Missing exercise'}
              value="Remove"
              chevron={false}
              onPress={() =>
                Alert.alert('Remove alternative?', exercises.get(a)?.name ?? '', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Remove', onPress: () => removeAlt.run(a) },
                ])
              }
            />
          ))}
        </List>
        <Button
          label="Add alternative"
          variant="secondary"
          compact
          inline
          onPress={() =>
            router.push({
              pathname: '/exercises',
              params: { pick: 'add_alternative', target: item.id },
            })
          }
        />
        <Text variant="caption" faint>
          Used first when equipment is unavailable or you substitute during a workout.
        </Text>
      </Section>

      <Button
        label="Remove from day"
        variant="danger"
        onPress={() =>
          Alert.alert('Remove exercise?', undefined, [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Remove',
              style: 'destructive',
              onPress: async () => {
                await remove.run();
                router.back();
              },
            },
          ])
        }
      />
    </Screen>
  );
}
