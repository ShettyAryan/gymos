import { router } from 'expo-router';

import {
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
  Screen,
  Section,
  Text,
} from '@/components';
import { useQuery } from '@/data/DatabaseProvider';
import { today } from '@/data/local/repositories/attendance';
import { listBadges, totalXp } from '@/data/local/repositories/awards';
import { getExerciseMap } from '@/data/local/repositories/exercises';
import { listPhotos } from '@/data/local/repositories/photos';
import { getCheckin, listProgressEntries } from '@/data/local/repositories/progress';
import { listPersonalRecords } from '@/data/local/repositories/workouts';
import { RECORD_LABEL, type RecordType } from '@/domain/rules/prs';
import { BADGES, levelFor } from '@/domain/rules/xp';
import { ProgressCharts } from '@/features/progress/ProgressCharts';
import { useUnits } from '@/features/workout/useUnits';
import { colors } from '@/theme/tokens';
import { formatDateKey, toDateKey } from '@/utils/dates';
import { displayLoad, loadUnit } from '@/utils/units';

export default function ProgressScreen() {
  const units = useUnits();
  const q = useQuery(async (db) => {
    const [prs, exercises, entries, photos, checkin, xp, badges, trained] = await Promise.all([
      listPersonalRecords(db, undefined, 6),
      getExerciseMap(db),
      listProgressEntries(db),
      listPhotos(db),
      getCheckin(db, today()),
      totalXp(db),
      listBadges(db),
      db.all<{ exercise_id: string; n: number; last: string }>(
        `SELECT ws.exercise_id, COUNT(DISTINCT ws.session_id) AS n, MAX(ws.completed_at) AS last FROM workout_set ws
         JOIN workout_session s ON s.id = ws.session_id
         WHERE ws.deleted_at IS NULL AND ws.is_warmup = 0 AND s.status IN ('completed_as_planned','completed_adapted','partially_completed')
         GROUP BY ws.exercise_id ORDER BY last DESC LIMIT 12`,
      ),
    ]);
    return { prs, exercises, entries, photos, checkin, xp, badges, trained };
  });

  if (q.error) return <ErrorState message={q.error} onRetry={q.reload} />;
  if (!q.data) return <LoadingState />;
  const { prs, exercises, entries, photos, checkin, xp, badges, trained } = q.data;
  const level = levelFor(xp);
  const latestWeight = [...entries].reverse().find((e) => e.body_weight_kg !== null);

  return (
    <Screen onRefresh={q.reload} refreshing={q.loading}>
      <OfflineBanner />
      <Header eyebrow={`Level ${level.level} · ${level.total} XP`} title="Progress" />

      <Card>
        <MetricRow>
          <Metric
            label="Weight"
            value={latestWeight ? `${displayLoad(latestWeight.body_weight_kg, units)}` : '—'}
            hint={
              latestWeight
                ? `${loadUnit(units)} · ${formatDateKey(latestWeight.date, { day: 'numeric', month: 'short' })}`
                : 'not logged'
            }
          />
          <Metric
            label="Level"
            value={String(level.level)}
            hint={`${level.xpForNext - level.xpIntoLevel} XP to next`}
          />
          <Metric
            label="Badges"
            value={String(badges.length)}
            hint={badges.length ? 'earned' : 'none yet'}
          />
        </MetricRow>
        <ProgressBar
          value={level.xpIntoLevel / level.xpForNext}
          label={`${level.xpIntoLevel} of ${level.xpForNext} XP to level ${level.level + 1}`}
        />
      </Card>

      <Card onPress={() => router.push('/insights')} accessibilityLabel="Open training insights">
        <Text variant="label" color={colors.accent}>
          Insights
        </Text>
        <Text variant="heading">
          What to train more, what to ease off, what&apos;s ready to progress
        </Text>
        <Text variant="caption" muted>
          Sets per muscle vs target · push/pull balance · plateaus · next loads
        </Text>
      </Card>

      <ProgressCharts units={units} />

      <Section title="Exercises">
        {trained.length === 0 ? (
          <EmptyState
            title="No lifts yet"
            message="Finish a session to see strength trends here."
          />
        ) : (
          <List>
            {trained.map((t) => (
              <ListRow
                key={t.exercise_id}
                title={exercises.get(t.exercise_id)?.name ?? t.exercise_id}
                value={`${t.n} ${t.n === 1 ? 'session' : 'sessions'}`}
                onPress={() =>
                  router.push({ pathname: '/exercises/[id]', params: { id: t.exercise_id } })
                }
              />
            ))}
          </List>
        )}
      </Section>

      {prs.length > 0 ? (
        <Section title="Records">
          <List>
            {prs.map((p) => (
              <ListRow
                key={p.id}
                title={exercises.get(p.exercise_id)?.name ?? 'Exercise'}
                subtitle={RECORD_LABEL[p.record_type as RecordType]}
                value={formatDateKey(toDateKey(new Date(p.achieved_at)), {
                  day: 'numeric',
                  month: 'short',
                })}
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

      <Section title="Body & recovery">
        <List>
          <ListRow
            title="Weight & measurements"
            value={`${entries.length}`}
            onPress={() => router.push('/progress/body')}
          />
          <ListRow
            title="Photos"
            subtitle="Private · never sent to AI"
            value={`${photos.length}`}
            onPress={() => router.push('/progress/photos')}
          />
          <ListRow
            title="Daily check-in"
            subtitle="Protein, water, sleep, energy, soreness"
            value={checkin ? 'Logged' : 'Optional'}
            onPress={() => router.push('/progress/checkin')}
          />
          <ListRow
            title="Attendance"
            subtitle="Calendar of planned vs completed"
            onPress={() => router.push('/calendar')}
          />
        </List>
      </Section>

      {badges.length > 0 ? (
        <Section title="Badges">
          <List>
            {badges.map((b) => (
              <ListRow
                key={b.id}
                title={BADGES[b.badge_key]?.title ?? b.badge_key}
                subtitle={BADGES[b.badge_key]?.description}
              />
            ))}
          </List>
        </Section>
      ) : null}
    </Screen>
  );
}
