import { Stack as RouterStack, router, useLocalSearchParams } from 'expo-router';
import { Alert } from 'react-native';

import {
  Button,
  Card,
  ErrorState,
  Header,
  List,
  ListRow,
  LoadingState,
  Notice,
  Screen,
  Section,
  Text,
} from '@/components';
import { LineChart } from '@/components/charts/LineChart';
import { useMutation, useQuery } from '@/data/DatabaseProvider';
import {
  deleteCustomExercise,
  getExercise,
  getExerciseMap,
} from '@/data/local/repositories/exercises';
import { getExerciseHistory, listPersonalRecords } from '@/data/local/repositories/workouts';
import {
  EQUIPMENT,
  labelOf,
  LOGGING_TYPES,
  MOVEMENT_PATTERNS,
  MUSCLES,
} from '@/domain/models/constants';
import { RECORD_LABEL, type RecordType } from '@/domain/rules/prs';
import { sessionTrend } from '@/features/progress/trends';
import { formatSetList } from '@/features/workout/formatSet';
import { useUnits } from '@/features/workout/useUnits';
import { formatDateKey, formatDuration } from '@/utils/dates';
import { displayDistance, displayLoad, distanceUnit, loadUnit } from '@/utils/units';

export default function ExerciseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const units = useUnits();
  const q = useQuery(
    async (db) => ({
      exercise: await getExercise(db, id),
      all: await getExerciseMap(db),
      history: await getExerciseHistory(db, id, 30),
      prs: await listPersonalRecords(db, id, 10),
    }),
    [id],
  );
  const remove = useMutation((db) => deleteCustomExercise(db, id));
  if (q.error) return <ErrorState message={q.error} />;
  if (!q.data) return <LoadingState />;
  const { exercise: ex, all, history, prs } = q.data;
  if (!ex) return <ErrorState title="Exercise not found" />;

  const trend = sessionTrend(history, ex.logging_type);
  const fmtValue = (type: string, v: number) =>
    type === 'max_load' || type === 'e1rm'
      ? `${displayLoad(v, units)} ${loadUnit(units)}`
      : type === 'max_duration'
        ? formatDuration(v)
        : type === 'max_distance'
          ? `${displayDistance(v, units)} ${distanceUnit(units)}`
          : `${v} reps`;

  return (
    <Screen edges={['bottom']}>
      <RouterStack.Screen
        options={{
          title: '',
          headerRight: ex.is_custom
            ? () => (
                <Button
                  compact
                  variant="ghost"
                  label="Edit"
                  onPress={() =>
                    router.push({ pathname: '/exercises/edit', params: { id: ex.id } })
                  }
                />
              )
            : undefined,
        }}
      />
      <Header
        eyebrow={`${labelOf(MOVEMENT_PATTERNS, ex.movement_pattern)} · ${labelOf(LOGGING_TYPES, ex.logging_type)}${ex.is_custom ? ' · Custom' : ''}`}
        title={ex.name}
      />
      <List>
        <ListRow
          title="Primary"
          value={ex.primary_muscles.map((m) => labelOf(MUSCLES, m)).join(', ') || '—'}
        />
        {ex.secondary_muscles.length ? (
          <ListRow
            title="Secondary"
            value={ex.secondary_muscles.map((m) => labelOf(MUSCLES, m)).join(', ')}
          />
        ) : null}
        <ListRow
          title="Equipment"
          value={
            ex.equipment.length ? ex.equipment.map((e) => labelOf(EQUIPMENT, e)).join(', ') : 'None'
          }
        />
        <ListRow title="Default rest" value={`${ex.default_rest_seconds}s`} />
      </List>
      {ex.instructions ? <Text muted>{ex.instructions}</Text> : null}
      {ex.caution ? <Notice tone="warning" message={ex.caution} /> : null}

      <Section title={`Trend · ${trend.metric}`}>
        <Card>
          <LineChart
            points={trend.points.map((p, i) => ({
              x: i,
              y: ex.logging_type === 'weight_reps' ? (displayLoad(p.value, units) ?? 0) : p.value,
              label: formatDateKey(p.date, { day: 'numeric', month: 'short' }),
            }))}
            accessibilityLabel={`${trend.metric} over ${trend.points.length} sessions`}
          />
          {ex.logging_type === 'weight_reps' ? (
            <Text variant="caption" faint>
              Estimated 1RM is a calculation from your logged sets, not a tested max.
            </Text>
          ) : null}
        </Card>
      </Section>

      {prs.length > 0 ? (
        <Section title="Records">
          <List>
            {prs.map((p) => (
              <ListRow
                key={p.id}
                title={RECORD_LABEL[p.record_type as RecordType]}
                subtitle={new Date(p.achieved_at).toLocaleDateString()}
                value={fmtValue(p.record_type, p.value)}
              />
            ))}
          </List>
        </Section>
      ) : null}

      <Section title="Strength Memory">
        {history.length === 0 ? <Text muted>No sessions logged for this exercise yet.</Text> : null}
        <List>
          {history.map((h) => (
            <ListRow
              key={h.sessionId}
              title={formatSetList(h.sets, ex.logging_type, units)}
              subtitle={`${formatDateKey(h.date)} · ${h.title}`}
              onPress={() =>
                router.push({ pathname: '/workout/[id]', params: { id: h.sessionId } })
              }
            />
          ))}
        </List>
      </Section>

      {ex.alternatives.length > 0 ? (
        <Section title="Alternatives">
          <List>
            {ex.alternatives.map((a) => (
              <ListRow
                key={a}
                title={all.get(a)?.name ?? a}
                onPress={() => router.push({ pathname: '/exercises/[id]', params: { id: a } })}
              />
            ))}
          </List>
        </Section>
      ) : null}

      {ex.is_custom ? (
        <Button
          label="Delete custom exercise"
          variant="danger"
          onPress={() =>
            Alert.alert(
              'Delete exercise?',
              'Past sessions keep their records. Programmes using it will need a replacement before approval.',
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
      ) : null}
    </Screen>
  );
}
