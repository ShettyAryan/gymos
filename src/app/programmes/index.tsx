import { Stack as RouterStack, router } from 'expo-router';
import { Alert } from 'react-native';

import {
  Button,
  EmptyState,
  ErrorState,
  List,
  ListRow,
  LoadingState,
  Screen,
  Section,
  Split,
  StatusPill,
} from '@/components';
import { useMutation, useQuery } from '@/data/DatabaseProvider';
import { createProgramme, listProgrammes } from '@/data/local/repositories/programmes';
import type { Programme } from '@/domain/models/types';

const statusTone = { active: 'success', draft: 'warning', archived: 'neutral' } as const;
const statusLabel = { active: 'Active', draft: 'Draft', archived: 'Archived' } as const;

export default function ProgrammesScreen() {
  const q = useQuery((db) => listProgrammes(db));
  const create = useMutation((db) => createProgramme(db, { name: 'New programme' }));

  const onCreate = async () => {
    try {
      const p = await create.run();
      router.push({ pathname: '/programmes/[id]', params: { id: p.id } });
    } catch (e) {
      Alert.alert('Could not create programme', e instanceof Error ? e.message : '');
    }
  };

  const meta = (p: Programme) =>
    [
      p.source === 'ai' ? 'AI-drafted' : 'Manual',
      p.status === 'active' && p.has_unapproved_changes ? 'unapproved edits' : null,
      `updated ${new Date(p.updated_at).toLocaleDateString()}`,
    ]
      .filter(Boolean)
      .join(' · ');

  return (
    <Screen edges={['bottom']}>
      <RouterStack.Screen options={{ title: 'Programmes' }} />
      <Split>
        <Button label="Build manually" onPress={onCreate} loading={create.pending} />
        <Button
          label="AI draft"
          variant="secondary"
          onPress={() => router.push('/programmes/ai-draft')}
        />
      </Split>
      {q.error ? <ErrorState message={q.error} onRetry={q.reload} /> : null}
      {q.loading && !q.data ? <LoadingState /> : null}
      {q.data?.length === 0 ? (
        <EmptyState
          title="No programmes yet"
          message="Build one from the exercise library, or ask the AI coach for a draft you can edit and approve."
        />
      ) : null}
      {q.data?.length ? (
        <Section title="All programmes">
          <List>
            {q.data.map((p) => (
              <ListRow
                key={p.id}
                title={p.name}
                subtitle={meta(p)}
                right={<StatusPill label={statusLabel[p.status]} tone={statusTone[p.status]} />}
                onPress={() => router.push({ pathname: '/programmes/[id]', params: { id: p.id } })}
              />
            ))}
          </List>
        </Section>
      ) : null}
    </Screen>
  );
}
