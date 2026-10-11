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
  OfflineBanner,
  Row,
  Screen,
  Section,
  SectionAction,
  Text,
} from '@/components';
import { PulseDot } from '@/components/motion';
import { useMutation, useQuery } from '@/data/DatabaseProvider';
import { today } from '@/data/local/repositories/attendance';
import { getActiveProgramme } from '@/data/local/repositories/programmes';
import { getActiveSession } from '@/data/local/repositories/workouts';
import type { DaySnapshot } from '@/domain/models/types';
import { formatPrescription, weekdayLabel } from '@/features/programme/format';
import { runStart, startFreeform, startPlanned } from '@/features/workout/start';
import { colors, spacing } from '@/theme/tokens';
import { WEEKDAY_LONG, weekdayOf } from '@/utils/dates';

export default function TrainScreen() {
  const q = useQuery(async (db) => ({
    active: await getActiveProgramme(db),
    session: await getActiveSession(db),
  }));
  const start = useMutation((db, versionId: string, day: DaySnapshot, plannedDate: string | null) =>
    startPlanned(db, versionId, day.id, plannedDate),
  );
  const freeform = useMutation((db) => startFreeform(db));

  if (q.error) return <ErrorState message={q.error} onRetry={q.reload} />;
  if (!q.data) return <LoadingState />;
  const { active, session } = q.data;
  const todayKey = today();
  const todayWeekday = weekdayOf(todayKey);

  const onStartDay = (versionId: string, day: DaySnapshot) => {
    if (day.weekday === todayWeekday) return runStart(() => start.run(versionId, day, todayKey));
    Alert.alert(
      `Start ${day.title} now?`,
      `${day.title} isn't scheduled today, so it will be recorded as an extra session. Your scheduled sessions are unchanged.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Start', onPress: () => runStart(() => start.run(versionId, day, null)) },
      ],
    );
  };

  return (
    <Screen onRefresh={q.reload} refreshing={q.loading}>
      <OfflineBanner />
      <Header
        eyebrow={active ? `Programme · v${active.version.version_number}` : 'Programme'}
        title={active?.programme.name ?? 'Train'}
        right={
          active ? (
            <SectionAction
              label="Edit"
              onPress={() =>
                router.push({ pathname: '/programmes/[id]', params: { id: active.programme.id } })
              }
            />
          ) : undefined
        }
      />

      {session ? (
        <Card
          tone="live"
          onPress={() => router.push('/workout/active')}
          accessibilityLabel={`Resume ${session.title}`}
        >
          <Row>
            <View style={{ flex: 1, gap: spacing.xs }}>
              <Row gap={spacing.sm}>
                <PulseDot color={colors.accent} />
                <Text variant="label" color={colors.accent}>
                  In progress
                </Text>
              </Row>
              <Text variant="heading" numberOfLines={1}>
                {session.title}
              </Text>
            </View>
            <Button
              label="Resume"
              variant="live"
              compact
              onPress={() => router.push('/workout/active')}
            />
          </Row>
        </Card>
      ) : null}

      {active?.programme.has_unapproved_changes ? (
        <Text variant="caption" muted>
          Unapproved edits pending — sessions use v{active.version.version_number} until you approve
          them.
        </Text>
      ) : null}

      <Section
        title="Week"
        action={<SectionAction label="All programmes" onPress={() => router.push('/programmes')} />}
      >
        {!active ? (
          <Card>
            <EmptyState
              title="No active programme"
              message="Create one manually or from an AI draft, then approve it to activate."
              action={
                <Button label="Programmes" compact onPress={() => router.push('/programmes')} />
              }
            />
          </Card>
        ) : (
          active.version.snapshot.days.map((day) => {
            const isToday = day.weekday === todayWeekday;
            return (
              <Card key={day.id} tone={isToday ? 'live' : undefined}>
                <Row align="flex-start">
                  <View style={{ flex: 1, gap: spacing.xs }}>
                    <Text variant="label" color={isToday ? colors.accent : colors.textMuted}>
                      {day.weekday === null
                        ? weekdayLabel(null)
                        : isToday
                          ? 'Today'
                          : WEEKDAY_LONG[day.weekday]}
                    </Text>
                    <Text variant="heading">{day.title}</Text>
                  </View>
                  {!session ? (
                    <Button
                      compact
                      label="Start"
                      variant={isToday ? 'live' : 'secondary'}
                      onPress={() => onStartDay(active.version.id, day)}
                    />
                  ) : null}
                </Row>
                <View>
                  {day.exercises.map((e, i) => (
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
                </View>
              </Card>
            );
          })
        )}
      </Section>

      <Section title="Library">
        <List>
          <ListRow
            title="Freeform session"
            subtitle="Log anything, no plan"
            onPress={() => runStart(() => freeform.run())}
          />
          <ListRow
            title="Exercises"
            subtitle="Search, filter, add your own"
            onPress={() => router.push('/exercises')}
          />
          <ListRow
            title="History"
            subtitle="Every finished session"
            onPress={() => router.push('/workout/history')}
          />
          <ListRow
            title="Calendar"
            subtitle="Planned vs completed, adapted, missed"
            onPress={() => router.push('/calendar')}
          />
        </List>
      </Section>
    </Screen>
  );
}
