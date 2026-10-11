import { Stack as RouterStack, router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import {
  Button,
  Card,
  ErrorState,
  Header,
  List,
  ListRow,
  LoadingState,
  Metric,
  MetricRow,
  Notice,
  Row,
  Screen,
  Section,
  StatusPill,
  Text,
} from '@/components';
import { useQuery } from '@/data/DatabaseProvider';
import type { XpEvent } from '@/data/local/repositories/awards';
import {
  getSessionDetail,
  listPersonalRecords,
  type Recommendation,
} from '@/data/local/repositories/workouts';
import { queryEntities } from '@/data/local/store';
import type { SessionStatus } from '@/domain/models/types';
import { DECISION_LABEL } from '@/domain/rules/progression';
import { RECORD_LABEL, type RecordType } from '@/domain/rules/prs';
import { STATUS_LABEL } from '@/domain/rules/sessionState';
import { formatSet } from '@/features/workout/formatSet';
import { useUnits } from '@/features/workout/useUnits';
import { colors, spacing, type StatusTone } from '@/theme/tokens';
import { formatDateKey, formatDuration } from '@/utils/dates';
import { displayDistance, displayLoad, distanceUnit, loadUnit } from '@/utils/units';

const statusTone: Partial<Record<SessionStatus, StatusTone>> = {
  completed_as_planned: 'success',
  completed_adapted: 'info',
  partially_completed: 'warning',
  cancelled: 'neutral',
  in_progress: 'accent',
};

export default function SessionScreen() {
  const { id, justFinished } = useLocalSearchParams<{ id: string; justFinished?: string }>();
  const units = useUnits();
  const q = useQuery(
    async (db) => {
      const detail = await getSessionDetail(db, id);
      if (!detail) return null;
      const [prs, xp, recos] = await Promise.all([
        listPersonalRecords(db).then((all) => all.filter((p) => p.session_id === id)),
        queryEntities<XpEvent>(db, 'xp_event', 'source_entity_id = ? AND deleted_at IS NULL', [id]),
        queryEntities<Recommendation>(
          db,
          'progression_recommendation',
          'session_id = ? AND deleted_at IS NULL',
          [id],
        ),
      ]);
      return { detail, prs, xp, recos };
    },
    [id],
  );
  if (q.error) return <ErrorState message={q.error} onRetry={q.reload} />;
  if (q.data === undefined) return <LoadingState />;
  if (q.data === null) return <ErrorState title="Session not found" />;

  const { detail, prs, xp, recos } = q.data;
  const { session, items } = detail;
  const working = items.map((i) => ({ ...i, working: i.sets.filter((s) => !s.is_warmup) }));
  const done = working.filter((i) => i.working.length > 0);
  const notDone = working.filter((i) => i.working.length === 0 && i.we.target);
  const totalSets = done.reduce((n, i) => n + i.working.length, 0);
  const plan = session.original_plan_snapshot;
  const xpTotal = xp.reduce((n, x) => n + x.amount, 0);
  const nameOf = (exerciseId: string) =>
    items.find((i) => i.we.exercise_id === exerciseId)?.exercise?.name ?? 'Exercise';

  const formatPr = (type: string, value: number) => {
    if (type === 'max_load' || type === 'e1rm')
      return `${displayLoad(value, units)} ${loadUnit(units)}`;
    if (type === 'max_distance') return `${displayDistance(value, units)} ${distanceUnit(units)}`;
    if (type === 'max_duration') return formatDuration(value);
    return `${value} reps`;
  };

  return (
    <Screen
      edges={['bottom']}
      footer={
        justFinished ? <Button label="Done" onPress={() => router.replace('/')} /> : undefined
      }
    >
      <RouterStack.Screen
        options={{
          title: justFinished ? 'Session summary' : 'Session',
          headerBackVisible: !justFinished,
        }}
      />
      <View style={{ gap: spacing.md }}>
        <Header
          eyebrow={`${formatDateKey(session.session_date, { weekday: 'long', day: 'numeric', month: 'long' })}${session.session_type !== 'planned' ? ` · ${session.session_type}` : ''}`}
          title={session.title}
        />
        <StatusPill
          label={STATUS_LABEL[session.status]}
          tone={statusTone[session.status] ?? 'neutral'}
        />
      </View>

      <Card>
        <MetricRow>
          <Metric label="Time" value={formatDuration(session.actual_duration_seconds ?? 0)} />
          <Metric label="Sets" value={String(totalSets)} />
          <Metric label="Exercises" value={String(done.length)} />
        </MetricRow>
        {xpTotal > 0 ? (
          <Text variant="caption" muted>
            <Text variant="caption" color={colors.accent}>
              +{xpTotal} XP
            </Text>{' '}
            · {xp.map((x) => x.event_type.replace(/_/g, ' ')).join(', ')}
          </Text>
        ) : null}
      </Card>

      {plan && session.session_type !== 'freeform' ? (
        <Notice
          tone={session.status === 'completed_as_planned' ? 'success' : 'info'}
          title={
            session.status === 'completed_as_planned'
              ? `Full ${plan.title} completed`
              : `Original plan: ${plan.title}`
          }
          message={
            session.status === 'completed_as_planned'
              ? 'Every planned exercise reached its target.'
              : `This session is recorded as ${STATUS_LABEL[session.status].toLowerCase()} — not as the full ${plan.title}. The planned session (${plan.exercises.length} exercises) is preserved unchanged.`
          }
        />
      ) : null}

      {prs.length > 0 ? (
        <Section title="Records">
          <List>
            {prs.map((p) => (
              <ListRow
                key={p.id}
                title={nameOf(p.exercise_id)}
                subtitle={RECORD_LABEL[p.record_type as RecordType]}
                value={formatPr(p.record_type, p.value)}
                right={
                  <Text variant="label" color={colors.accent}>
                    PR
                  </Text>
                }
              />
            ))}
          </List>
        </Section>
      ) : null}

      <Section title="Logged work">
        {done.length === 0 ? <Text muted>No working sets were logged.</Text> : null}
        {done.map((i) => (
          <Card key={i.we.id}>
            <Row align="flex-start">
              <View style={{ flex: 1 }}>
                <Text variant="heading">{i.exercise?.name}</Text>
                {i.we.disposition === 'substituted' ? (
                  <Text variant="caption" muted>
                    Substituted
                  </Text>
                ) : null}
              </View>
              {i.we.target ? (
                <Text
                  variant="heading"
                  color={i.working.length >= i.we.target.sets ? colors.success : colors.text}
                  style={{ fontVariant: ['tabular-nums'] }}
                >
                  {i.working.length}
                  <Text variant="heading" color={colors.textFaint}>
                    /{i.we.target.sets}
                  </Text>
                </Text>
              ) : null}
            </Row>
            <View>
              {i.sets.map((s, idx) => (
                <Row
                  key={s.id}
                  style={{
                    minHeight: 36,
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: colors.border,
                  }}
                >
                  <Text variant="caption" faint style={{ width: 36 }}>
                    {s.is_warmup ? 'W' : idx + 1}
                  </Text>
                  <Text variant="caption" style={{ flex: 1, fontVariant: ['tabular-nums'] }}>
                    {formatSet(s, i.exercise?.logging_type ?? 'weight_reps', units)}
                  </Text>
                </Row>
              ))}
            </View>
          </Card>
        ))}
      </Section>

      {notDone.length > 0 ? (
        <Section title="Not done today">
          <List>
            {notDone.map((i) => (
              <ListRow
                key={i.we.id}
                title={i.exercise?.name ?? 'Exercise'}
                right={
                  <StatusPill
                    label={
                      i.we.disposition === 'deferred'
                        ? 'Deferred'
                        : i.we.disposition === 'removed'
                          ? 'Removed'
                          : 'Not logged'
                    }
                    tone={i.we.disposition === 'removed' ? 'neutral' : 'warning'}
                  />
                }
              />
            ))}
          </List>
          <Text variant="caption" faint>
            Deferred work stays in your programme for its next scheduled day — nothing was moved or
            crammed into tomorrow.
          </Text>
        </Section>
      ) : null}

      {recos.length > 0 ? (
        <Section title="Next time">
          <List>
            {recos.map((r) => (
              <ListRow
                key={r.id}
                title={`${nameOf(r.exercise_id)} · ${DECISION_LABEL[r.decision]}`}
                subtitle={r.rationale}
              />
            ))}
          </List>
          <Text variant="caption" faint>
            Suggestions from rule {recos[0]!.rule_version}. You can use or dismiss each one next
            session.
          </Text>
        </Section>
      ) : null}
    </Screen>
  );
}
