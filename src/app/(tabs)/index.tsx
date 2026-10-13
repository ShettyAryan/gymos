import { router } from 'expo-router';
import { Alert, View } from 'react-native';

import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Header,
  List,
  ListRow,
  LoadingState,
  Metric,
  MetricRow,
  OfflineBanner,
  ProgressBar,
  Row,
  Screen,
  Section,
  SectionAction,
  Split,
  StatusPill,
  Text,
} from '@/components';
import { PulseDot } from '@/components/motion';
import { useMutation, useQuery } from '@/data/DatabaseProvider';
import { confirmMissed } from '@/data/local/repositories/attendance';
import { getDashboard, type PlannedOccurrence } from '@/data/local/repositories/dashboard';
import { getProfile } from '@/data/local/repositories/profile';
import { elapsedSeconds } from '@/data/local/repositories/workouts';
import { OUTCOME_LABEL } from '@/domain/rules/schedule';
import { estimateSessionMinutes } from '@/domain/rules/timeEstimate';
import { formatPrescription } from '@/features/programme/format';
import { runStart, startFreeform, startPlanned } from '@/features/workout/start';
import { useNow } from '@/state/useNow';
import { colors, spacing, type StatusTone } from '@/theme/tokens';
import { formatClock, formatDateKey } from '@/utils/dates';

const outcomeTone: Record<string, StatusTone> = {
  completed_as_planned: 'success',
  completed_adapted: 'info',
  partially_completed: 'warning',
  habit_action: 'info',
  rescheduled: 'neutral',
  excused: 'neutral',
  cancelled: 'neutral',
  missed: 'danger',
};

const MAX_PREVIEW = 5;

export default function TodayScreen() {
  const q = useQuery(async (db) => ({
    dash: await getDashboard(db),
    profile: await getProfile(db),
  }));
  const now = useNow(1000, !!q.data?.dash.activeSession);
  const start = useMutation((db, o: PlannedOccurrence) =>
    startPlanned(db, o.versionId, o.dayId, o.date),
  );
  const freeform = useMutation((db) => startFreeform(db));
  const missed = useMutation((db, o: PlannedOccurrence) =>
    confirmMissed(db, { date: o.date, plannedDayId: o.dayId, versionId: o.versionId }),
  );

  if (q.error) return <ErrorState message={q.error} onRetry={q.reload} />;
  if (!q.data) return <LoadingState />;
  const { dash, profile } = q.data;
  const weekTarget = profile?.weekly_target ?? dash.week.planned;

  const openAdapt = (o: PlannedOccurrence) =>
    router.push({
      pathname: '/workout/adapt',
      params: { versionId: o.versionId, dayId: o.dayId, date: o.date },
    });

  const checkIn = (o: PlannedOccurrence) =>
    Alert.alert(
      `${o.title} · ${formatDateKey(o.date)}`,
      'No session was logged. No judgement — what would help?',
      [
        { text: 'Reschedule or skip', onPress: () => openAdapt(o) },
        { text: 'Mark as missed', onPress: () => missed.run(o) },
        { text: 'Later', style: 'cancel' },
      ],
    );

  return (
    <Screen onRefresh={q.reload} refreshing={q.loading}>
      <OfflineBanner />
      <Header
        eyebrow={formatDateKey(dash.today, { weekday: 'long', day: 'numeric', month: 'long' })}
        title={profile?.display_name ? `Hi, ${profile.display_name}` : 'Today'}
      />

      {dash.activeSession ? (
        <Card
          tone="live"
          onPress={() => router.push('/workout/active')}
          accessibilityLabel="Resume workout in progress"
        >
          <Row align="flex-end">
            <View style={{ flex: 1, gap: spacing.xs }}>
              <Row gap={spacing.sm}>
                <PulseDot color={colors.accent} />
                <Text variant="label" color={colors.accent}>
                  In progress
                </Text>
              </Row>
              <Text variant="heading" numberOfLines={1}>
                {dash.activeSession.title}
              </Text>
            </View>
            <Text variant="metric" color={colors.accent}>
              {formatClock(elapsedSeconds(dash.activeSession, now))}
            </Text>
          </Row>
          <Button
            label="Resume workout"
            variant="live"
            onPress={() => router.push('/workout/active')}
          />
        </Card>
      ) : null}

      <Section
        title="Today"
        action={
          !dash.activeSession ? (
            <SectionAction
              label="Freeform session"
              onPress={() => runStart(() => freeform.run())}
            />
          ) : undefined
        }
      >
        {!dash.active ? (
          <Card>
            <EmptyState
              title="No active programme"
              message="Build one manually or start from an AI draft. You can always log a freeform session."
              action={
                <Button
                  label="Set up a programme"
                  compact
                  onPress={() => router.push('/programmes')}
                />
              }
            />
          </Card>
        ) : dash.todayPlan.length === 0 ? (
          <Card>
            <Text variant="title">Rest day</Text>
            <Text muted>Planned rest never breaks your streak. Recovery is part of the plan.</Text>
          </Card>
        ) : (
          dash.todayPlan.map((o) => {
            const done = o.outcome !== 'pending';
            const exercises = o.day?.exercises ?? [];
            const est = exercises.length
              ? estimateSessionMinutes(
                  exercises.map((e) => ({
                    sets: e.sets,
                    repMax: e.repMax,
                    restSeconds: e.restSeconds,
                    loggingType: 'weight_reps',
                  })),
                )
              : null;
            return (
              <Card key={o.dayId}>
                <View style={{ gap: spacing.xs }}>
                  <Row>
                    <Text variant="label" muted style={{ flex: 1 }}>
                      {exercises.length} exercises{est ? ` · ~${est} min` : ''}
                    </Text>
                    {done ? (
                      <StatusPill
                        label={OUTCOME_LABEL[o.outcome]}
                        tone={outcomeTone[o.outcome] ?? 'neutral'}
                      />
                    ) : null}
                  </Row>
                  <Text variant="title">{o.title}</Text>
                  {o.rescheduledFrom ? (
                    <Text variant="caption" muted>
                      Moved from {formatDateKey(o.rescheduledFrom)}
                    </Text>
                  ) : null}
                </View>

                {!done ? (
                  <View>
                    {exercises.slice(0, MAX_PREVIEW).map((e, i) => (
                      <Row key={e.programmeExerciseId} style={{ paddingVertical: spacing.xs }}>
                        <Text variant="caption" faint style={{ width: 20 }}>
                          {i + 1}
                        </Text>
                        <Text variant="caption" style={{ flex: 1 }} numberOfLines={1}>
                          {e.exerciseName}
                        </Text>
                        <Text variant="caption" muted>
                          {formatPrescription({ ...e, restSeconds: 0, targetRir: null })}
                        </Text>
                      </Row>
                    ))}
                    {exercises.length > MAX_PREVIEW ? (
                      <Text
                        variant="caption"
                        faint
                        style={{ paddingLeft: 20, paddingTop: spacing.xs }}
                      >
                        +{exercises.length - MAX_PREVIEW} more
                      </Text>
                    ) : null}
                  </View>
                ) : null}

                {!done && !dash.activeSession ? (
                  <Split>
                    <Button
                      label="Start"
                      variant="live"
                      onPress={() => runStart(() => start.run(o))}
                      loading={start.pending}
                      testID="start-planned"
                    />
                    <Button label="Adapt" variant="secondary" onPress={() => openAdapt(o)} />
                  </Split>
                ) : null}
              </Card>
            );
          })
        )}
      </Section>

      {dash.needsCheckIn.length > 0 ? (
        <Section title="Check-in">
          <List>
            {dash.needsCheckIn.map((o) => (
              <ListRow
                key={`${o.date}-${o.dayId}`}
                title={o.title}
                subtitle={`${formatDateKey(o.date)} · nothing logged`}
                value="Update"
                onPress={() => checkIn(o)}
              />
            ))}
          </List>
        </Section>
      ) : null}

      <Section title="This week">
        <Card>
          <MetricRow>
            <Metric
              label="Sessions"
              value={`${dash.week.sessions}/${weekTarget}`}
              hint={
                dash.week.adapted ? `${dash.week.adapted} adapted` : `${dash.week.planned} planned`
              }
            />
            <Metric
              label="Streak"
              value={String(dash.streak.current)}
              hint={`best ${dash.streak.best}`}
            />
            <Metric
              label="Level"
              value={String(dash.level.level)}
              hint={`${dash.level.total} XP`}
            />
          </MetricRow>
          <ProgressBar
            value={weekTarget ? dash.week.sessions / weekTarget : 0}
            label={`Weekly commitment: ${dash.week.sessions} of ${weekTarget} sessions`}
          />
          <Text variant="caption" faint>
            Freeform sessions count too. Streaks are training days in a row — rest days never break
            them.
          </Text>
        </Card>
      </Section>

      {dash.campaign || dash.next ? (
        <Section title="Ahead">
          <List>
            {dash.next ? (
              <ListRow
                title={dash.next.title}
                subtitle="Next session"
                value={formatDateKey(dash.next.date)}
              />
            ) : null}
            {dash.campaign ? (
              <ListRow
                title={dash.campaign.campaign.name}
                subtitle={
                  dash.campaign.nextMilestone
                    ? `Next: ${dash.campaign.nextMilestone.title}`
                    : 'Campaign · no open milestones'
                }
                value={
                  dash.campaign.daysLeft !== null ? `${dash.campaign.daysLeft} days` : undefined
                }
                onPress={() => router.push('/campaign')}
              />
            ) : null}
          </List>
        </Section>
      ) : null}
    </Screen>
  );
}
