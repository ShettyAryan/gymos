import { Stack as RouterStack, router } from 'expo-router';
import { useState } from 'react';
import { FlatList } from 'react-native';

import {
  Button,
  EmptyState,
  ErrorState,
  ListRow,
  LoadingState,
  Screen,
  StatusPill,
} from '@/components';
import { useQuery } from '@/data/DatabaseProvider';
import { listSessionHistory, type HistoryRow } from '@/data/local/repositories/workouts';
import type { SessionStatus } from '@/domain/models/types';
import { STATUS_LABEL } from '@/domain/rules/sessionState';
import type { StatusTone } from '@/theme/tokens';
import { formatDateKey, formatDuration } from '@/utils/dates';

const PAGE = 20;

/** Short status words keep titles wide; the full label is on the session screen. */
const SHORT: Partial<Record<SessionStatus, string>> = {
  completed_as_planned: 'Done',
  completed_adapted: 'Adapted',
  partially_completed: 'Partial',
  cancelled: 'Cancelled',
};
const TONE: Partial<Record<SessionStatus, StatusTone>> = {
  completed_as_planned: 'success',
  completed_adapted: 'info',
  partially_completed: 'warning',
  cancelled: 'neutral',
};

export default function HistoryScreen() {
  const [pages, setPages] = useState(1);
  const q = useQuery((db) => listSessionHistory(db, PAGE * pages, 0), [pages]);
  if (q.error) return <ErrorState message={q.error} onRetry={q.reload} />;
  if (!q.data) return <LoadingState />;
  const rows = q.data;
  return (
    <Screen scroll={false} edges={['bottom']}>
      <RouterStack.Screen options={{ title: 'Workout history' }} />
      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        ListEmptyComponent={
          <EmptyState title="No workouts yet" message="Finished sessions appear here." />
        }
        renderItem={({ item }: { item: HistoryRow }) => (
          <ListRow
            title={item.title}
            subtitle={`${formatDateKey(item.session_date)} · ${item.set_count} sets · ${formatDuration(item.actual_duration_seconds ?? 0)}`}
            right={
              <StatusPill
                label={SHORT[item.status] ?? STATUS_LABEL[item.status]}
                tone={TONE[item.status] ?? 'neutral'}
              />
            }
            onPress={() => router.push({ pathname: '/workout/[id]', params: { id: item.id } })}
          />
        )}
        ListFooterComponent={
          rows.length >= PAGE * pages ? (
            <Button label="Load more" variant="ghost" onPress={() => setPages((p) => p + 1)} />
          ) : null
        }
      />
    </Screen>
  );
}
