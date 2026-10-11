import { useState } from 'react';

import { Button, Card, Notice, Section, StatusPill, Text } from '@/components';
import { useMutation, useQuery } from '@/data/DatabaseProvider';
import { hasValidConsent } from '@/data/local/repositories/aiConsent';
import { saveReviewNarrative, type WeeklyReview } from '@/data/local/repositories/reviews';
import { getPreferences } from '@/data/local/repositories/settings';
import type { WeeklyFacts } from '@/domain/rules/weeklyReview';

import type { WeeklyNarrative } from '../../../supabase/functions/_shared/schemas';

import { requestAi } from './aiClient';
import { AI_POLICY_VERSION } from './disclosure';

/** Facts without internal identifiers — the model only needs the numbers and titles. */
export function narrativeFacts(f: WeeklyFacts): Record<string, unknown> {
  return { ...f, sessions: f.sessions.map(({ title, status, date }) => ({ title, status, date })) };
}

/** Optional AI narrative for a weekly review, generated only from the recorded facts. */
export function AiNarrative({
  facts,
  review,
}: {
  facts: WeeklyFacts;
  review: WeeklyReview | null;
}) {
  const gate = useQuery(
    async (db) =>
      (await getPreferences(db)).aiEnabled && (await hasValidConsent(db, AI_POLICY_VERSION)),
  );
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<{ narrative: WeeklyNarrative; model: string } | null>(null);
  const gen = useMutation(async (db) => {
    const res = await requestAi<WeeklyNarrative>(db, {
      task: 'weekly_review_narrative',
      input: { facts: narrativeFacts(facts) },
    });
    if (res.ok && review) await saveReviewNarrative(db, review.id, res.output, res.model);
    return res;
  });

  if (!gate.data) return null;
  const stored = review?.ai_narrative
    ? { narrative: review.ai_narrative as WeeklyNarrative, model: review.ai_model ?? '' }
    : null;
  const shown = fresh ?? stored;

  return (
    <Section title="AI narrative (optional)">
      {shown ? (
        <Card>
          <StatusPill label="AI-written — interpretation" tone="info" />
          <Text>{shown.narrative.summary}</Text>
          {shown.narrative.highlights.map((h) => (
            <Text key={h} variant="caption" muted>
              • {h}
            </Text>
          ))}
          {shown.narrative.focusNextWeek.length ? (
            <Text variant="bodyStrong">Next week</Text>
          ) : null}
          {shown.narrative.focusNextWeek.map((h) => (
            <Text key={h} variant="caption" muted>
              • {h}
            </Text>
          ))}
          <Text variant="caption" faint>
            {shown.model} · may be wrong; the facts above are the record.
          </Text>
        </Card>
      ) : null}
      {error ? <Notice tone="warning" message={error} /> : null}
      <Button
        label={shown ? 'Regenerate narrative' : 'Write narrative with AI'}
        variant="secondary"
        loading={gen.pending}
        onPress={async () => {
          setError(null);
          const r = await gen.run();
          if (r.ok) setFresh({ narrative: r.output, model: r.model });
          else setError(r.message);
        }}
      />
    </Section>
  );
}
