import { Stack as RouterStack, router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  ErrorState,
  LoadingState,
  Metric,
  MetricRow,
  PeriodNav,
  Screen,
  StatusPill,
  Text,
} from '@/components';
import { useQuery } from '@/data/DatabaseProvider';
import { getCalendar, today } from '@/data/local/repositories/attendance';
import {
  OUTCOME_LABEL,
  weekAdherence,
  type CalendarDay,
  type OccurrenceOutcome,
} from '@/domain/rules/schedule';
import { colors, spacing, toneColor, type StatusTone } from '@/theme/tokens';
import { addDays, formatDateKey, startOfWeek, WEEKDAY_SHORT, weekdayOf } from '@/utils/dates';

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

/** One dot per day for the week strip: the most important outcome that day, or nothing for rest. */
function dayTone(d: CalendarDay): StatusTone | null {
  if (d.occurrences.length === 0) return d.extraSessions ? 'accent' : null;
  return tone[d.occurrences[0]!.outcome];
}

export default function CalendarScreen() {
  const [offset, setOffset] = useState(0);
  const todayKey = today();
  const start = addDays(startOfWeek(todayKey), offset * 7);
  const end = addDays(start, 6);
  const q = useQuery((db) => getCalendar(db, start, end), [start]);
  if (q.error) return <ErrorState message={q.error} />;
  if (!q.data) return <LoadingState />;
  const adh = weekAdherence(q.data);

  return (
    <Screen edges={['bottom']}>
      <RouterStack.Screen options={{ title: 'Calendar' }} />
      <PeriodNav
        label={`${formatDateKey(start, { day: 'numeric', month: 'short' })} – ${formatDateKey(end, { day: 'numeric', month: 'short' })}`}
        onPrev={() => setOffset((o) => o - 1)}
        onNext={() => setOffset((o) => o + 1)}
      />

      <View style={styles.strip}>
        {q.data.map((d) => {
          const isToday = d.date === todayKey;
          const t = dayTone(d);
          return (
            <View
              key={d.date}
              style={styles.stripCell}
              accessible
              accessibilityLabel={`${formatDateKey(d.date, { weekday: 'long', day: 'numeric' })}: ${d.rest ? 'rest' : d.occurrences.map((o) => OUTCOME_LABEL[o.outcome]).join(', ')}`}
            >
              <Text variant="label" faint>
                {WEEKDAY_SHORT[weekdayOf(d.date)]!.slice(0, 1)}
              </Text>
              <Text
                variant="heading"
                color={isToday ? colors.accent : d.rest ? colors.textFaint : colors.text}
                style={styles.tabular}
              >
                {Number(d.date.slice(8))}
              </Text>
              <View style={[styles.dot, { backgroundColor: t ? toneColor[t] : 'transparent' }]} />
            </View>
          );
        })}
      </View>

      <MetricRow>
        <Metric label="Attended" value={`${adh.attended}/${adh.planned}`} />
        <Metric
          label="Adapted"
          value={String(adh.adapted)}
          hint={adh.partial ? `${adh.partial} partial` : undefined}
        />
        <Metric label="Missed" value={String(adh.missed)} hint={`${adh.rest} rest days`} />
      </MetricRow>

      <View style={styles.agenda}>
        {q.data.map((d) => {
          const isToday = d.date === todayKey;
          return (
            <View key={d.date} style={styles.agendaRow}>
              <View style={styles.dateCol}>
                <Text variant="label" color={isToday ? colors.accent : colors.textMuted}>
                  {isToday ? 'Today' : WEEKDAY_SHORT[weekdayOf(d.date)]}
                </Text>
                <Text variant="caption" faint>
                  {formatDateKey(d.date, { day: 'numeric', month: 'short' })}
                </Text>
              </View>
              <View style={styles.entries}>
                {d.rest && !d.extraSessions && !d.habitAction ? (
                  <Text variant="caption" faint>
                    Rest
                  </Text>
                ) : null}
                {d.occurrences.map((o) => (
                  <Pressable
                    key={o.dayId}
                    disabled={!o.sessionId}
                    onPress={() =>
                      o.sessionId &&
                      router.push({ pathname: '/workout/[id]', params: { id: o.sessionId } })
                    }
                    accessibilityRole={o.sessionId ? 'button' : undefined}
                    style={({ pressed }) => [styles.entry, pressed ? styles.pressed : null]}
                  >
                    <Text numberOfLines={1}>{o.title}</Text>
                    <StatusPill label={OUTCOME_LABEL[o.outcome]} tone={tone[o.outcome]} />
                    {o.rescheduledFrom ? (
                      <Text variant="caption" faint>
                        Moved from {formatDateKey(o.rescheduledFrom)}
                      </Text>
                    ) : null}
                  </Pressable>
                ))}
                {d.extraSessions ? (
                  <StatusPill
                    label={`${d.extraSessions} extra session${d.extraSessions > 1 ? 's' : ''}`}
                    tone="accent"
                  />
                ) : null}
                {d.habitAction && d.occurrences.every((o) => o.outcome !== 'habit_action') ? (
                  <StatusPill label="Habit action" tone="info" />
                ) : null}
              </View>
            </View>
          );
        })}
      </View>

      <Text variant="caption" faint>
        “Not logged” means a past planned session has no record. Update it from Today — nothing else
        is assumed.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  tabular: { fontVariant: ['tabular-nums'] },
  strip: { flexDirection: 'row' },
  stripCell: { flex: 1, alignItems: 'center', gap: spacing.xs },
  dot: { width: 6, height: 6, borderRadius: 3 },
  agenda: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  agendaRow: {
    flexDirection: 'row',
    paddingVertical: spacing.md,
    gap: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  dateCol: { width: 64, gap: 2 },
  entries: { flex: 1, gap: spacing.md },
  entry: { gap: spacing.xs },
  pressed: { opacity: 0.55 },
});
