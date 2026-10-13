import { Stack as RouterStack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import {
  Button,
  ChipGroup,
  EmptyState,
  ErrorState,
  List,
  ListRow,
  LoadingState,
  Row,
  Screen,
  SearchField,
  Text,
} from '@/components';
import { useMutation, useQuery } from '@/data/DatabaseProvider';
import {
  listAlternatives,
  listExercises,
  listRecentExercises,
} from '@/data/local/repositories/exercises';
import { getEntity } from '@/data/local/store';
import {
  EQUIPMENT,
  labelOf,
  MOVEMENT_PATTERNS,
  MUSCLES,
  type Equipment,
  type Muscle,
} from '@/domain/models/constants';
import type { Exercise, WorkoutExercise } from '@/domain/models/types';
import { PICK_TITLES, runPickAction, type PickAction } from '@/features/exercises/pickActions';
import { colors, radius, spacing } from '@/theme/tokens';
import { haptics } from '@/utils/haptics';

const QUICK_MUSCLES: Muscle[] = [
  'chest',
  'back',
  'shoulders',
  'biceps',
  'triceps',
  'quads',
  'hamstrings',
  'glutes',
  'calves',
  'core',
  'cardio',
];

const subtitle = (e: Exercise) =>
  `${labelOf(MOVEMENT_PATTERNS, e.movement_pattern)} · ${e.equipment.length ? e.equipment.map((x) => labelOf(EQUIPMENT, x)).join(', ') : 'No equipment'}`;

export default function ExerciseLibraryScreen() {
  const params = useLocalSearchParams<{ pick?: PickAction; target?: string }>();
  const pick = params.pick && params.target ? { action: params.pick, target: params.target } : null;
  const [search, setSearch] = useState('');
  const [muscle, setMuscle] = useState<Muscle | null>(null);
  const [equipment, setEquipment] = useState<Equipment | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const q = useQuery(
    (db) => listExercises(db, { search, muscle, equipment }),
    [search, muscle, equipment],
  );
  const extras = useQuery(
    async (db) => {
      let suggested: Exercise[] = [];
      let replacing: string | null = null;
      if (pick?.action === 'substitute_workout_exercise') {
        const we = await getEntity<WorkoutExercise>(db, 'workout_exercise', pick.target);
        if (we) {
          suggested = await listAlternatives(db, we.exercise_id);
          replacing = (await getEntity<Exercise>(db, 'exercise', we.exercise_id))?.name ?? null;
        }
      }
      const recent =
        pick && pick.action !== 'add_alternative' ? await listRecentExercises(db, 6) : [];
      return { suggested, recent, replacing };
    },
    [pick?.action, pick?.target],
  );
  const choose = useMutation((db, exerciseId: string) =>
    runPickAction(db, pick!.action, pick!.target, exerciseId),
  );

  const onSelect = async (e: Exercise) => {
    if (!pick) {
      router.push({ pathname: '/exercises/[id]', params: { id: e.id } });
      return;
    }
    try {
      await choose.run(e.id);
      haptics.success();
      router.back();
    } catch (err) {
      Alert.alert('Could not add exercise', err instanceof Error ? err.message : '');
    }
  };

  const browsing = !search.trim() && !muscle && !equipment;
  const suggested = browsing ? (extras.data?.suggested ?? []) : [];
  const recent = browsing
    ? (extras.data?.recent ?? []).filter((e) => !suggested.some((s) => s.id === e.id))
    : [];

  return (
    <Screen
      scroll={false}
      edges={['bottom']}
      contentStyle={{ gap: spacing.md, paddingBottom: 0 }}
      footer={
        pick ? (
          <Button label="Cancel" variant="secondary" onPress={() => router.back()} />
        ) : undefined
      }
    >
      <RouterStack.Screen
        options={{
          title: pick ? PICK_TITLES[pick.action] : 'Exercise library',
          headerRight: () => (
            <Button
              label="Custom"
              compact
              variant="ghost"
              onPress={() =>
                router.push({
                  pathname: '/exercises/edit',
                  params: pick ? { pick: pick.action, target: pick.target } : {},
                })
              }
            />
          ),
        }}
      />
      {extras.data?.replacing ? (
        <Text variant="caption" muted>
          Replacing <Text variant="caption">{extras.data.replacing}</Text>. Sets you already logged
          stay with it.
        </Text>
      ) : null}
      <Row>
        <SearchField
          value={search}
          onChangeText={setSearch}
          placeholder={`Search ${q.data && browsing ? q.data.length : ''} exercises`}
        />
        <Button
          label={equipment ? 'Kit · 1' : 'Kit'}
          variant={showFilters ? 'primary' : 'secondary'}
          onPress={() => setShowFilters((s) => !s)}
          style={{ minHeight: 48, paddingHorizontal: spacing.lg }}
        />
      </Row>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.quick}
        style={styles.quickWrap}
        keyboardShouldPersistTaps="handled"
      >
        {QUICK_MUSCLES.map((m) => {
          const on = muscle === m;
          return (
            <Pressable
              key={m}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`Filter: ${labelOf(MUSCLES, m)}`}
              onPress={() => {
                haptics.select();
                setMuscle(on ? null : m);
              }}
              style={[styles.chip, on ? styles.chipOn : null]}
            >
              <Text variant="caption" color={on ? colors.onInk : colors.text}>
                {labelOf(MUSCLES, m)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {showFilters ? (
        <ChipGroup
          label="Equipment"
          options={[...EQUIPMENT]}
          selected={equipment ? [equipment] : []}
          onToggle={(v) => setEquipment(equipment === v ? null : v)}
        />
      ) : null}
      {q.error ? <ErrorState message={q.error} onRetry={q.reload} /> : null}
      {!q.data && q.loading ? <LoadingState /> : null}
      <FlatList
        data={q.data ?? []}
        keyExtractor={(e) => e.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListHeaderComponent={
          suggested.length || recent.length ? (
            <View style={styles.header}>
              {suggested.length ? (
                <View style={styles.group}>
                  <Text variant="label" muted>
                    Suggested swaps
                  </Text>
                  <List>
                    {suggested.map((e) => (
                      <ListRow
                        key={e.id}
                        title={e.name}
                        subtitle={subtitle(e)}
                        onPress={() => onSelect(e)}
                        chevron={false}
                      />
                    ))}
                  </List>
                </View>
              ) : null}
              {recent.length ? (
                <View style={styles.group}>
                  <Text variant="label" muted>
                    Recently used
                  </Text>
                  <List>
                    {recent.map((e) => (
                      <ListRow
                        key={e.id}
                        title={e.name}
                        subtitle={subtitle(e)}
                        onPress={() => onSelect(e)}
                        chevron={false}
                      />
                    ))}
                  </List>
                </View>
              ) : null}
              <Text variant="label" muted>
                All exercises
              </Text>
            </View>
          ) : null
        }
        ListEmptyComponent={
          q.data ? (
            <EmptyState
              title="No matches"
              message="Try another name or muscle, or add it as a custom exercise."
            />
          ) : null
        }
        renderItem={({ item }) => (
          <ListRow
            title={item.name}
            subtitle={subtitle(item)}
            value={item.is_custom ? 'Custom' : undefined}
            onPress={() => onSelect(item)}
            chevron={!pick}
          />
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  quickWrap: { flexGrow: 0, marginHorizontal: -20 },
  quick: { gap: spacing.sm, paddingHorizontal: 20 },
  chip: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
  },
  chipOn: { backgroundColor: colors.ink },
  header: { gap: spacing.md, paddingBottom: spacing.sm },
  group: { gap: spacing.sm },
});
