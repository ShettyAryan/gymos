import { useState } from 'react';
import { ScrollView, StyleSheet, Pressable, View } from 'react-native';

import { Card, Section, Segmented, Text } from '@/components';
import { BarChart } from '@/components/charts/BarChart';
import { LineChart } from '@/components/charts/LineChart';
import { useQuery } from '@/data/DatabaseProvider';
import {
  getChartableLifts,
  getE1rmSeries,
  getWeeklySeries,
} from '@/data/local/repositories/insights';
import { listProgressEntries } from '@/data/local/repositories/progress';
import { colors, radius, spacing } from '@/theme/tokens';
import { formatDateKey } from '@/utils/dates';
import { haptics } from '@/utils/haptics';
import { displayLoad, loadUnit, type UnitSystem } from '@/utils/units';

type Metric = 'sessions' | 'sets' | 'volume';

const short = (key: string) => formatDateKey(key, { day: 'numeric', month: 'short' });

/** Graph-based progress: weekly training load, lift strength over time, body weight. */
export function ProgressCharts({ units }: { units: UnitSystem }) {
  const [metric, setMetric] = useState<Metric>('sessions');
  const [lift, setLift] = useState<string | null>(null);
  const q = useQuery(async (db) => {
    const [weeks, lifts, entries] = await Promise.all([
      getWeeklySeries(db, 12),
      getChartableLifts(db),
      listProgressEntries(db),
    ]);
    return { weeks, lifts, weights: entries.filter((e) => e.body_weight_kg !== null) };
  });
  const selectedLift = lift ?? q.data?.lifts[0]?.id ?? null;
  const e1rm = useQuery(
    async (db) => (selectedLift ? getE1rmSeries(db, selectedLift) : []),
    [selectedLift],
  );

  if (!q.data) return null;
  const { weeks, lifts, weights } = q.data;
  const unit = loadUnit(units);

  const bars = weeks.map((w) => ({
    label: short(w.weekStart),
    value:
      metric === 'sessions'
        ? w.sessions
        : metric === 'sets'
          ? w.sets
          : Math.round(displayLoad(w.volumeKg, units) ?? 0),
  }));
  const total = bars.reduce((n, b) => n + b.value, 0);
  const avg = Math.round((total / bars.length) * 10) / 10;
  const liftName = lifts.find((l) => l.id === selectedLift)?.name ?? '';
  const series = e1rm.data ?? [];
  const change =
    series.length >= 2
      ? (displayLoad(series.at(-1)!.value, units) ?? 0) -
        (displayLoad(series[0]!.value, units) ?? 0)
      : null;

  return (
    <>
      <Section title="Training per week">
        <Card>
          <Segmented
            options={[
              { value: 'sessions', label: 'Sessions' },
              { value: 'sets', label: 'Sets' },
              { value: 'volume', label: `Volume (${unit})` },
            ]}
            value={metric}
            onChange={setMetric}
          />
          <BarChart
            data={bars}
            unit={metric === 'sessions' ? 'sessions' : metric === 'sets' ? 'sets' : unit}
            formatValue={(v) =>
              metric === 'volume' && v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(v)
            }
            accessibilityLabel={`${metric} per week over 12 weeks, average ${avg}, this week ${bars.at(-1)?.value ?? 0}`}
          />
          <Text variant="caption" muted>
            12-week average:{' '}
            {metric === 'volume' && avg >= 1000 ? `${Math.round(avg / 100) / 10}k` : avg} per week ·
            tap a bar for that week
          </Text>
        </Card>
      </Section>

      <Section title="Strength">
        {lifts.length === 0 ? (
          <Text muted>Log a weighted exercise in two sessions to start its strength graph.</Text>
        ) : (
          <Card>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chips}
              style={styles.chipRow}
            >
              {lifts.map((l) => {
                const on = l.id === selectedLift;
                return (
                  <Pressable
                    key={l.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    onPress={() => {
                      haptics.select();
                      setLift(l.id);
                    }}
                    style={[styles.chip, on ? styles.chipOn : null]}
                  >
                    <Text
                      variant="caption"
                      color={on ? colors.onInk : colors.text}
                      numberOfLines={1}
                    >
                      {l.name}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <View style={styles.head}>
              <Text variant="metric">
                {series.length ? displayLoad(series.at(-1)!.value, units) : '—'}
                <Text variant="caption" muted>
                  {' '}
                  {unit} est. 1RM
                </Text>
              </Text>
              {change !== null ? (
                <Text variant="caption" color={change >= 0 ? colors.success : colors.warning}>
                  {change >= 0 ? '+' : ''}
                  {Math.round(change * 10) / 10} {unit} since {short(series[0]!.date)}
                </Text>
              ) : null}
            </View>
            <LineChart
              points={series.map((p, i) => ({
                x: i,
                y: displayLoad(p.value, units) ?? 0,
                label: short(p.date),
              }))}
              accessibilityLabel={`${liftName} estimated one-rep max over ${series.length} sessions`}
            />
            <Text variant="caption" faint>
              Best estimated 1RM per session (calculated from your sets, not a tested max).
            </Text>
          </Card>
        )}
      </Section>

      {weights.length >= 2 ? (
        <Section title="Body weight">
          <Card>
            <LineChart
              points={weights.map((e, i) => ({
                x: i,
                y: displayLoad(e.body_weight_kg, units) ?? 0,
                label: short(e.date),
              }))}
              accessibilityLabel={`Body weight over ${weights.length} entries`}
            />
          </Card>
        </Section>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  chipRow: { flexGrow: 0, marginHorizontal: -16 },
  chips: { gap: spacing.sm, paddingHorizontal: 16 },
  chip: {
    minHeight: 34,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
    maxWidth: 200,
  },
  chipOn: { backgroundColor: colors.ink },
  head: { gap: 2 },
});
