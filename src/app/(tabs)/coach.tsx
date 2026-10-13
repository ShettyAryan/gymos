import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import {
  Button,
  Card,
  ErrorState,
  Header,
  List,
  ListRow,
  LoadingState,
  Notice,
  OfflineBanner,
  Row,
  Screen,
  Section,
  SectionAction,
  Text,
  TextField,
} from '@/components';
import { useMutation, useQuery } from '@/data/DatabaseProvider';
import { hasValidConsent } from '@/data/local/repositories/aiConsent';
import {
  addMessage,
  clearMessages,
  listMessages,
  type AiMessage,
} from '@/data/local/repositories/aiMessages';
import { getPreferences } from '@/data/local/repositories/settings';
import { requestAi } from '@/features/coach/aiClient';
import { coachContext } from '@/features/coach/aiContext';
import { AI_POLICY_VERSION } from '@/features/coach/disclosure';
import { useNetworkStatus } from '@/state/network';
import { colors, spacing } from '@/theme/tokens';

import type { CoachAnswer } from '../../../supabase/functions/_shared/schemas';

export default function CoachScreen() {
  const q = useQuery(async (db) => ({
    prefs: await getPreferences(db),
    consent: await hasValidConsent(db, AI_POLICY_VERSION),
    messages: await listMessages(db),
  }));
  const online = useNetworkStatus((s) => s.online);
  const [question, setQuestion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const ask = useMutation(async (db, text: string) => {
    const context = await coachContext(db);
    const res = await requestAi<CoachAnswer>(db, {
      task: 'coach_question',
      input: { question: text, context },
    });
    if (!res.ok) return res;
    await addMessage(db, {
      role: 'user',
      task: 'coach_question',
      content: text,
      model: null,
      prompt_version: null,
    });
    await addMessage(db, {
      role: 'assistant',
      task: 'coach_question',
      content: JSON.stringify(res.output),
      model: res.model,
      prompt_version: res.promptVersion,
    });
    return res;
  });
  const clear = useMutation((db) => clearMessages(db));

  if (q.error) return <ErrorState message={q.error} onRetry={q.reload} />;
  if (!q.data) return <LoadingState />;
  const { prefs, consent, messages } = q.data;
  const aiReady = prefs.aiEnabled && consent;

  const onAsk = async () => {
    const text = question.trim();
    if (!text) return;
    setError(null);
    const r = await ask.run(text);
    if (!r.ok) setError(r.message);
    else setQuestion('');
  };

  return (
    <Screen>
      <OfflineBanner />
      <Header eyebrow="Reviews & assistant" title="Coach" />

      <Section title="Accountability">
        <List>
          <ListRow
            title="Training insights"
            subtitle="Over/undertrained muscles, balance, plateaus, next loads"
            onPress={() => router.push('/insights')}
          />
          <ListRow
            title="Weekly review"
            subtitle="Planned vs completed, records, next-week focus"
            onPress={() => router.push('/review')}
          />
          <ListRow
            title="Campaign"
            subtitle="Target date and milestones"
            onPress={() => router.push('/campaign')}
          />
        </List>
      </Section>

      <Section
        title="AI assistant"
        action={
          aiReady ? (
            <SectionAction label="Settings" onPress={() => router.push('/settings/ai')} />
          ) : undefined
        }
      >
        {!aiReady ? (
          <Card>
            <Text variant="heading">Off</Text>
            <Text muted>
              Optional. When enabled, minimal summaries of your training are sent to a third-party
              AI provider (Groq). Read exactly what is shared first.
            </Text>
            <View style={{ alignSelf: 'flex-start' }}>
              <Button label="Review & enable" compact onPress={() => router.push('/settings/ai')} />
            </View>
          </Card>
        ) : (
          <>
            {prefs.mockAi ? (
              <Notice
                tone="warning"
                title="Mock AI (development)"
                message="Responses are generated locally for testing, not by a real model."
              />
            ) : null}
            {online === false && !prefs.mockAi ? (
              <Notice
                tone="warning"
                message="You are offline. AI needs a connection; everything else keeps working."
              />
            ) : null}
            <List>
              <ListRow
                title="Draft a programme"
                subtitle="You review, edit and approve before anything activates"
                onPress={() => router.push('/programmes/ai-draft')}
              />
            </List>
            {messages.map((m) => (
              <MessageEntry key={m.id} m={m} />
            ))}
            <TextField
              label="Ask about your programme, progress or schedule"
              value={question}
              onChangeText={setQuestion}
              multiline
              maxLength={800}
              placeholder="e.g. Why did my squat stall this month?"
            />
            {error ? <Notice tone="warning" message={error} /> : null}
            <Row>
              <Button
                label="Ask"
                onPress={onAsk}
                loading={ask.pending}
                disabled={!question.trim()}
                grow
              />
              {messages.length ? (
                <Button
                  label="Clear"
                  variant="ghost"
                  onPress={() =>
                    Alert.alert(
                      'Clear AI history?',
                      'Deletes the conversation stored on this device.',
                      [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Clear', style: 'destructive', onPress: () => clear.run() },
                      ],
                    )
                  }
                />
              ) : null}
            </Row>
            <Text variant="caption" faint>
              AI responses can be wrong and are not medical advice. Suggestions never change your
              programme unless you edit and approve it yourself.
            </Text>
          </>
        )}
      </Section>
    </Screen>
  );
}

/** Conversation entries read like a log: a micro-label, then the text. No chat bubbles. */
function MessageEntry({ m }: { m: AiMessage }) {
  if (m.role === 'user') {
    return (
      <View style={{ gap: spacing.xs }}>
        <Text variant="label" muted>
          You
        </Text>
        <Text>{m.content}</Text>
      </View>
    );
  }
  let a: CoachAnswer | null = null;
  try {
    a = JSON.parse(m.content) as CoachAnswer;
  } catch {
    a = null;
  }
  if (!a) return null;
  return (
    <Card>
      <Text variant="label" color={colors.info} numberOfLines={1}>
        AI suggestion · {m.model}
      </Text>
      {a.safetyNote ? <Notice tone="warning" message={a.safetyNote} /> : null}
      <Text>{a.answer}</Text>
      {a.dataGaps.length ? (
        <Text variant="caption" muted>
          Missing data: {a.dataGaps.join('; ')}
        </Text>
      ) : null}
      {a.assumptions.length ? (
        <Text variant="caption" faint>
          Assumptions: {a.assumptions.join('; ')}
        </Text>
      ) : null}
      {a.caveats.length ? (
        <Text variant="caption" faint>
          Caveats: {a.caveats.join('; ')}
        </Text>
      ) : null}
      {a.proposedChanges.map((c) => (
        <Notice
          key={c.description}
          tone="neutral"
          title="Proposed change — not applied"
          message={`${c.description} — ${c.rationale}`}
        />
      ))}
    </Card>
  );
}
