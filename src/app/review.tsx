import { Stack as RouterStack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import {
  Button,
  Card,
  ErrorState,
  List,
  ListRow,
  LoadingState,
  Metric,
  MetricRow,
  Notice,
  PeriodNav,
  Screen,
  Section,
  StatusPill,
  Text,
  TextField,
} from '@/components';
import { useMutation, useQuery } from '@/data/DatabaseProvider';
import { today } from '@/data/local/repositories/attendance';
import {
  getWeeklyFacts,
  getWeeklyReview,
  recordWeeklyReview,
  type WeeklyReview,
} from '@/data/local/repositories/reviews';
import { incrementCounter } from '@/data/local/repositories/settings';
import { reviewNotes, type WeeklyFacts } from '@/domain/rules/weeklyReview';
import { AiNarrative } from '@/features/coach/AiNarrative';
import { addDays, formatDateKey, startOfWeek } from '@/utils/dates';

export default function ReviewScreen() {
  const params = useLocalSearchParams<{ week?: string }>();
  const [offset, setOffset] = useState(params.week === 'last' ? -1 : 0);
  const weekStart = addDays(startOfWeek(today()), offset * 7);
  const q = useQuery(
    async (db) => {
      const facts = await getWeeklyFacts(db, weekStart);
      await incrementCounter(db, 'weekly_review_viewed');
      return { facts, review: await getWeeklyReview(db, weekStart) };
    },
    [weekStart],
  );
  if (q.error) return <ErrorState message={q.error} />;
  if (!q.data) return <LoadingState />;
  return (
    <ReviewBody
      key={weekStart}
      weekStart={weekStart}
      facts={q.data.facts}
      review={q.data.review}
      onPrev={() => setOffset((o) => o - 1)}
      onNext={offset < 0 ? () => setOffset((o) => o + 1) : undefined}
    />
  );
}

function ReviewBody({
  weekStart,
  facts,
  review,
  onPrev,
  onNext,
}: {
  weekStart: string;
  facts: WeeklyFacts;
  review: WeeklyReview | null;
  onPrev: () => void;
  onNext?: () => void;
}) {
  const [reflection, setReflection] = useState(review?.reflection ?? '');
  const record = useMutation((db) => recordWeeklyReview(db, weekStart, reflection.trim() || null));
  const notes = reviewNotes(facts);
  const a = facts.adherence;

  return (
    <Screen edges={['bottom']}>
      <RouterStack.Screen options={{ title: 'Weekly review' }} />
      <PeriodNav
        label={`${formatDateKey(facts.weekStart, { day: 'numeric', month: 'short' })} – ${formatDateKey(facts.weekEnd, { day: 'numeric', month: 'short' })}`}
        onPrev={onPrev}
        onNext={onNext}
      />

      <Card>
        <MetricRow>
          <Metric
            label="Attended"
            value={`${a.attended}/${a.planned}`}
            hint={facts.weeklyTarget ? `commitment ${facts.weeklyTarget}` : undefined}
          />
          <Metric label="Adapted" value={String(a.adapted)} />
          <Metric label="Records" value={String(facts.prs.length)} />
        </MetricRow>
      </Card>

      <Section title="Recorded">
        <List>
          {notes
            .filter((n) => n.kind === 'fact')
            .map((n) => (
              <ListRow key={n.text} title={n.text} />
            ))}
          {facts.strength.map((s) => (
            <ListRow
              key={s.exercise}
              title={s.exercise}
              subtitle="Best estimated 1RM"
              value={`${s.previousBest} → ${s.best} kg`}
            />
          ))}
        </List>
      </Section>

      <Section title="Interpretation · suggestions, not facts">
        {notes.filter((n) => n.kind === 'interpretation').length === 0 ? (
          <Text muted>Nothing to suggest — steady week.</Text>
        ) : null}
        {notes
          .filter((n) => n.kind === 'interpretation')
          .map((n) => (
            <Notice key={n.text} tone="neutral" message={n.text} />
          ))}
      </Section>

      <AiNarrative facts={facts} review={review} />

      <Section title="Your reflection">
        <TextField
          label="What went well? What will you adjust?"
          optional
          multiline
          value={reflection}
          onChangeText={setReflection}
          maxLength={1000}
        />
        <Button
          label={review ? 'Update review' : 'Record review'}
          onPress={async () => {
            try {
              await record.run();
              Alert.alert(
                'Review recorded',
                review ? 'Updated.' : 'Nice — reflecting each week builds the habit.',
              );
            } catch (e) {
              Alert.alert('Not saved', e instanceof Error ? e.message : '');
            }
          }}
          loading={record.pending}
        />
        {review ? (
          <StatusPill
            label={`Recorded ${new Date(review.recorded_at).toLocaleDateString()}`}
            tone="success"
          />
        ) : null}
      </Section>
    </Screen>
  );
}
