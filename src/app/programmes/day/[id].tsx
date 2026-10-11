import { Stack as RouterStack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import {
  Button,
  ChipGroup,
  ErrorState,
  LoadingState,
  Screen,
  Stepper,
  Text,
  TextField,
} from '@/components';
import { useMutation, useQuery } from '@/data/DatabaseProvider';
import { deleteDay, updateDay } from '@/data/local/repositories/programmes';
import { getEntity } from '@/data/local/store';
import type { ProgrammeDay } from '@/domain/models/types';
import { WEEKDAY_SHORT } from '@/utils/dates';

export default function DayEditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useQuery((db) => getEntity<ProgrammeDay>(db, 'programme_day', id), [id]);
  if (q.error) return <ErrorState message={q.error} />;
  if (q.data === undefined) return <LoadingState />;
  if (!q.data) return <ErrorState title="Day not found" />;
  return <DayForm day={q.data} />;
}

function DayForm({ day }: { day: ProgrammeDay }) {
  const [title, setTitle] = useState(day.title);
  const [weekday, setWeekday] = useState<number | null>(day.weekday);
  const [minutes, setMinutes] = useState(day.intended_minutes);
  const [focus, setFocus] = useState(day.focus ?? '');
  const save = useMutation((db) =>
    updateDay(db, day.id, {
      title: title.trim(),
      weekday,
      intended_minutes: minutes,
      focus: focus.trim() || null,
    }),
  );
  const remove = useMutation((db) => deleteDay(db, day.id));

  const onSave = async () => {
    if (!title.trim()) return Alert.alert('Add a title for this day.');
    await save.run();
    router.back();
  };

  return (
    <Screen
      edges={['bottom']}
      footer={<Button label="Save day" onPress={onSave} loading={save.pending} />}
    >
      <RouterStack.Screen options={{ title: 'Training day' }} />
      <TextField
        label="Title"
        value={title}
        onChangeText={setTitle}
        placeholder="e.g. Legs, Upper A"
        maxLength={40}
      />
      <TextField
        label="Focus"
        optional
        value={focus}
        onChangeText={setFocus}
        placeholder="e.g. squat strength"
        maxLength={80}
      />
      <ChipGroup
        label="Scheduled weekday"
        options={[
          { value: 'none', label: 'Unscheduled' },
          ...WEEKDAY_SHORT.map((d, i) => ({ value: String(i), label: d })),
        ]}
        selected={[weekday === null ? 'none' : String(weekday)]}
        onToggle={(v) => setWeekday(v === 'none' ? null : Number(v))}
      />
      <Text variant="caption" faint>
        Weekdays without a scheduled day are planned rest days and never break your streak.
      </Text>
      <Stepper
        label="Planned duration"
        value={minutes}
        min={10}
        max={180}
        step={5}
        format={(v) => `${v} min`}
        onChange={setMinutes}
      />
      <Button
        label="Delete day"
        variant="danger"
        onPress={() =>
          Alert.alert(
            'Delete this day?',
            'Its exercises are removed from the draft. Logged sessions are unaffected.',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: async () => {
                  await remove.run();
                  router.back();
                },
              },
            ],
          )
        }
      />
    </Screen>
  );
}
