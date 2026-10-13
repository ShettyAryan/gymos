import { Stack as RouterStack, router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import {
  Card,
  ErrorState,
  Header,
  List,
  ListRow,
  LoadingState,
  Notice,
  Screen,
  Section,
  StatusPill,
  Text,
} from '@/components';
import { VolumeBars } from '@/components/charts/VolumeBars';
import { useQuery } from '@/data/DatabaseProvider';
import { getInsights } from '@/data/local/repositories/insights';
import type { Readiness, Trend } from '@/domain/rules/insights';
import { DECISION_LABEL } from '@/domain/rules/progression';
import { useUnits } from '@/features/workout/useUnits';
import { colors, spacing, type StatusTone } from '@/theme/tokens';
import { displayLoad, loadUnit, type UnitSystem } from '@/utils/units';

const TREND: Record<Trend, { label: string; tone: StatusTone }> = {
  improving: { label: 'Improving', tone: 'success' },
  flat: { label: 'Flat', tone: 'neutral' },
  declining: { label: 'Declining', tone: 'warning' },
  new: { label: 'Building data', tone: 'neutral' },
};

function readinessValue(r: Readiness, u: UnitSystem): string {
  const fmt = (kg: number) => `${displayLoad(kg, u)} ${loadUnit(u)}`;
  if (r.decision === 'increase_load' && r.nextLoadKg !== null) {
    if (r.currentLoadKg !== null && r.nextLoadKg > r.currentLoadKg) {
      return `+${displayLoad(r.nextLoadKg - r.currentLoadKg, u)} → ${fmt(r.nextLoadKg)}`;
    }
    return fmt(r.nextLoadKg);
  }
  if (r.decision === 'reduce_or_review' && r.nextLoadKg !== null) return `→ ${fmt(r.nextLoadKg)}`;
  if (r.currentLoadKg !== null) return fmt(r.currentLoadKg);
  return '';
}

const SHORT: Record<Readiness['decision'], string> = {
  increase_load: 'Ready',
  increase_reps: 'Reps',
  repeat_target: 'Hold',
  reduce_or_review: 'Review',
  insufficient_data: '—',
};

const readinessTone = (r: Readiness): StatusTone =>
  r.decision === 'increase_load'
    ? 'success'
    : r.decision === 'reduce_or_review'
      ? 'warning'
      : r.decision === 'increase_reps'
        ? 'info'
        : 'neutral';

export default function InsightsScreen() {
  const units = useUnits();
  const q = useQuery((db) => getInsights(db));
  if (q.error) return <ErrorState message={q.error} onRetry={q.reload} />;
  if (!q.data) return <LoadingState label="Analysing your training…" />;
  const ins = q.data;
  const range = ins.muscles[0]?.range ?? [10, 20];
  const ready = ins.readiness.filter((r) => r.decision !== 'insufficient_data');

  return (
    <Screen edges={['bottom']} onRefresh={q.reload} refreshing={q.loading}>
      <RouterStack.Screen options={{ title: 'Insights' }} />
      <Header
        eyebrow={`Last ${ins.weeksAnalysed} week${ins.weeksAnalysed > 1 ? 's' : ''}${ins.earlyData ? ' · early data' : ''}`}
        title="How you're training"
        subtitle="Worked out from your logged sets. Guidance, not medical advice."
      />

      {ins.cards.length ? (
        <Section title="What to focus on">
          <View style={styles.cards}>
            {ins.cards.map((c) => (
              <Notice key={c.id} tone={c.tone} title={c.title} message={c.body} />
            ))}
          </View>
        </Section>
      ) : null}

      <Section title="Weekly sets per muscle">
        <Card>
          <VolumeBars rows={ins.muscles} />
          <View style={styles.key}>
            <View style={styles.band} />
            <Text variant="caption" muted style={styles.flex}>
              Shaded band = target range ({range[0]}–{range[1]} sets/week for your goal). Main
              muscles count 1 set, helpers ½.
            </Text>
          </View>
        </Card>
      </Section>

      <Section title="Ready to progress">
        {ready.length === 0 ? (
          <Text muted>
            Finish a few sessions with targets set — each exercise then gets a clear next step.
          </Text>
        ) : (
          <List>
            {ready.map((r) => (
              <ListRow
                key={r.exerciseId}
                title={r.name}
                subtitle={`${DECISION_LABEL[r.decision]} · ${r.rationale}`}
                value={readinessValue(r, units)}
                right={<StatusPill label={SHORT[r.decision]} tone={readinessTone(r)} />}
                onPress={() =>
                  router.push({ pathname: '/exercises/[id]', params: { id: r.exerciseId } })
                }
              />
            ))}
          </List>
        )}
        <Text variant="caption" faint>
          Load goes up only after every set reaches the top of your rep range with manageable
          effort. Increments use each exercise&apos;s smallest practical jump.
        </Text>
      </Section>

      <Section title="Strength trends">
        {ins.trends.length === 0 ? (
          <Text muted>Log weighted exercises to see estimated-strength trends.</Text>
        ) : (
          <List>
            {ins.trends.slice(0, 10).map((t) => (
              <ListRow
                key={t.exerciseId}
                title={t.name}
                subtitle={`${t.sessions} sessions${t.stalledSessions >= 3 ? ` · no new best in ${t.stalledSessions}` : ''}`}
                value={
                  t.changePct === null
                    ? TREND[t.trend].label
                    : `${t.changePct > 0 ? '+' : ''}${t.changePct}%`
                }
                right={<StatusPill label={TREND[t.trend].label} tone={TREND[t.trend].tone} />}
                onPress={() =>
                  router.push({ pathname: '/exercises/[id]', params: { id: t.exerciseId } })
                }
              />
            ))}
          </List>
        )}
        <Text variant="caption" faint>
          Change compares your best estimated 1RM in the last 2 sessions with the 3 before.
          Estimates, not tested maxes.
        </Text>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  cards: { gap: spacing.md },
  key: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingTop: spacing.sm },
  band: { width: 18, height: 10, borderRadius: 2, backgroundColor: colors.borderStrong },
  flex: { flex: 1 },
});
