import { Stack as RouterStack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, FlatList, View } from 'react-native';

import {
  Button,
  ChipGroup,
  EmptyState,
  ErrorState,
  ListRow,
  LoadingState,
  Row,
  Screen,
  SearchField,
  Text,
} from '@/components';
import { useMutation, useQuery } from '@/data/DatabaseProvider';
import { listExercises } from '@/data/local/repositories/exercises';
import {
  EQUIPMENT,
  labelOf,
  MOVEMENT_PATTERNS,
  MUSCLES,
  type Equipment,
  type Muscle,
} from '@/domain/models/constants';
import type { Exercise } from '@/domain/models/types';
import { PICK_TITLES, runPickAction, type PickAction } from '@/features/exercises/pickActions';
import { spacing } from '@/theme/tokens';

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
      router.back();
    } catch (err) {
      Alert.alert('Could not add exercise', err instanceof Error ? err.message : '');
    }
  };

  return (
    <Screen scroll={false} edges={['bottom']} contentStyle={{ gap: spacing.md, paddingBottom: 0 }}>
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
      <Row>
        <SearchField value={search} onChangeText={setSearch} placeholder="Search exercises" />
        <Button
          label={muscle || equipment ? 'Filters · 1+' : 'Filters'}
          variant={showFilters ? 'primary' : 'secondary'}
          onPress={() => setShowFilters((s) => !s)}
          style={{ minHeight: 48, paddingHorizontal: spacing.lg }}
        />
      </Row>
      {showFilters ? (
        <View style={{ gap: spacing.lg }}>
          <ChipGroup
            label="Muscle"
            options={[...MUSCLES]}
            selected={muscle ? [muscle] : []}
            onToggle={(m) => setMuscle(muscle === m ? null : m)}
          />
          <ChipGroup
            label="Equipment"
            options={[...EQUIPMENT]}
            selected={equipment ? [equipment] : []}
            onToggle={(v) => setEquipment(equipment === v ? null : v)}
          />
        </View>
      ) : null}
      {pick ? (
        <Text variant="caption" muted>
          Tap an exercise to select it.
        </Text>
      ) : null}
      {q.error ? <ErrorState message={q.error} onRetry={q.reload} /> : null}
      {!q.data && q.loading ? <LoadingState /> : null}
      <FlatList
        data={q.data ?? []}
        keyExtractor={(e) => e.id}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          q.data ? (
            <EmptyState
              title="No matches"
              message="The starter library is intentionally small. Add a custom exercise for anything missing."
            />
          ) : null
        }
        renderItem={({ item }) => (
          <ListRow
            title={item.name}
            subtitle={`${labelOf(MOVEMENT_PATTERNS, item.movement_pattern)} · ${
              item.equipment.length
                ? item.equipment.map((x) => labelOf(EQUIPMENT, x)).join(', ')
                : 'No equipment'
            }`}
            value={item.is_custom ? 'Custom' : undefined}
            onPress={() => onSelect(item)}
            chevron={!pick}
          />
        )}
      />
    </Screen>
  );
}
