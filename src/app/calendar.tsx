import { Stack as RouterStack, router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  Card,
  ErrorState,
  List,
  ListRow,
  LoadingState,
  Metric,
  MetricRow,
  Screen,
  Section,
  StatusPill,
  Text,
} from '@/components';
import { addMonths, MonthCalendar, monthStart } from '@/components/MonthCalendar';
import { useQuery } from '@/data/DatabaseProvider';
import { getCalendar, today } from '@/data/local/repositories/attendance';
import {
  OUTCOME_LABEL,
  weekAdherence,
  type CalendarDay,
  type OccurrenceOutcome,
} from '@/domain/rules/schedule';
import { colors, spacing, toneColor, type StatusTone } from '@/theme/tokens';
import { addDays, formatDateKey, type DateKey } from '@/utils/dates';

const tone: Record<OccurrenceOutcome, StatusTone> = {
  completed_as_planned: 'success',
  completed_adapted: 'info',
  partially_completed: 'warning',
  rescheduled: 'neutral',
  missed: 'danger',
  missed_unconfirmed: 'danger',
  cancelled: 'neutral',
  excused: 'neutral',
  habit_action: 'info',
  pending: 'accent',
  upcoming: 'neutral',
};

/** One dot per day: the most important thing that happened, or nothing on a rest day. */
function dayTone(d: CalendarDay): StatusTone | null {
  if (d.occurrences.some((o) => o.outcome === 'completed_as_planned')) return 'success';
  if (d.extraSessions > 0) return 'success';
  const first = d.occurrences[0];
  if (first) return tone[first.outcome];
  return d.habitAction ? 'info' : null;
}

const LEGEND: { tone: StatusTone; label: string }[] = [
  { tone: 'success', label: 'Trained' },
  { tone: 'info', label: 'Adapted / habit' },
  { tone: 'warning', label: 'Partial' },
  { tone: 'danger', label: 'Missed' },
  { tone: 'neutral', label: 'Planned' },
];

export default function CalendarScreen() {
  const todayKey = today();
  const [month, setMonth] = useState<DateKey>(monthStart(todayKey));
  const [selected, setSelected] = useState<DateKey>(todayKey);
  const from = month;
  const to = addDays(addMonths(month, 1), -1);
  const q = useQuery((db) => getCalendar(db, from, to), [from]);

  if (q.error) return <ErrorState message={q.error} />;
  if (!q.data) return <LoadingState />;

  const days = q.data;
  const marks = new Map<DateKey, StatusTone>();
  for (const d of days) {
    const t = dayTone(d);
    if (t) marks.set(d.date, t);
  }
  const past = days.filter((d) => d.date <= todayKey);
  const adh = weekAdherence(past);
  const trainedDays = past.filter(
    (d) =>
      d.extraSessions > 0 ||
      d.occurrences.some((o) =>
        ['completed_as_planned', 'completed_adapted', 'partially_completed'].includes(o.outcome),
      ),
  ).length;
  const day = days.find((d) => d.date === selected);

  return (
    <Screen edges={['bottom']}>
      <RouterStack.Screen options={{ title: 'Calendar' }} />
      <Card>
        <MonthCalendar
          month={month}
          onMonthChange={(m) => {
            setMonth(m);
            setSelected(m === monthStart(todayKey) ? todayKey : m);
          }}
          today={todayKey}
          selected={selected}
          onSelect={setSelected}
          marks={marks}
        />
        <View style={styles.legend}>
          {LEGEND.map((l) => (
            <View key={l.label} style={styles.legendItem}>
              <View style={[styles.dot, { backgroundColor: toneColor[l.tone] }]} />
              <Text variant="caption" muted>
                {l.label}
              </Text>
            </View>
          ))}
        </View>
      </Card>

      <MetricRow>
        <Metric label="Trained" value={String(trainedDays)} hint="days this month" />
        <Metric
          label="Sessions"
          value={String(adh.sessions)}
          hint={adh.extra ? `${adh.extra} freeform` : 'logged'}
        />
        <Metric label="Missed" value={String(adh.missed)} hint={`of ${adh.planned} planned`} />
      </MetricRow>

      <Section title={formatDateKey(selected, { weekday: 'long', day: 'numeric', month: 'long' })}>
        {!day || (day.rest && !day.extraSessions && !day.habitAction) ? (
          <Text muted>
            {selected > todayKey
              ? 'Nothing planned — rest day.'
              : 'Rest day. Recovery is part of the plan.'}
          </Text>
        ) : (
          <List>
            {day.occurrences.map((o) => (
              <ListRow
                key={o.dayId}
                title={o.title}
                subtitle={
                  o.rescheduledFrom
                    ? `Moved from ${formatDateKey(o.rescheduledFrom)}`
                    : 'Planned session'
                }
                right={<StatusPill label={OUTCOME_LABEL[o.outcome]} tone={tone[o.outcome]} />}
                onPress={
                  o.sessionId
                    ? () => router.push({ pathname: '/workout/[id]', params: { id: o.sessionId! } })
                    : undefined
                }
                chevron={!!o.sessionId}
              />
            ))}
            {day.extraSessions ? (
              <ListRow
                title={`${day.extraSessions} freeform session${day.extraSessions > 1 ? 's' : ''}`}
                subtitle="Counts toward your streak"
                right={<StatusPill label="Trained" tone="success" />}
                onPress={() => router.push('/workout/history')}
              />
            ) : null}
            {day.habitAction && day.occurrences.every((o) => o.outcome !== 'habit_action') ? (
              <ListRow title="Habit action" right={<StatusPill label="Recorded" tone="info" />} />
            ) : null}
          </List>
        )}
      </Section>

      <Text variant="caption" faint>
        Any session — planned or freeform — counts as a training day. Rest days never break a
        streak.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: spacing.lg,
    rowGap: spacing.xs,
    paddingTop: spacing.sm,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.textFaint },
});
