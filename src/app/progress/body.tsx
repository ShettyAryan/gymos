import { Stack as RouterStack } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import {
  Button,
  Card,
  ErrorState,
  Header,
  List,
  ListRow,
  LoadingState,
  NumberField,
  Screen,
  Section,
  Split,
  Text,
} from '@/components';
import { LineChart } from '@/components/charts/LineChart';
import { useMutation, useQuery } from '@/data/DatabaseProvider';
import { today } from '@/data/local/repositories/attendance';
import {
  deleteProgressEntry,
  listProgressEntries,
  MEASUREMENT_KEYS,
  saveProgressEntry,
  type MeasurementKey,
} from '@/data/local/repositories/progress';
import { useUnits } from '@/features/workout/useUnits';
import { formatDateKey } from '@/utils/dates';
import {
  displayLength,
  displayLoad,
  lengthUnit,
  loadUnit,
  parseLength,
  parseLoad,
} from '@/utils/units';

const LABEL: Record<MeasurementKey, string> = {
  waist: 'Waist',
  chest: 'Chest',
  hips: 'Hips',
  arm: 'Arm',
  thigh: 'Thigh',
  neck: 'Neck',
};

export default function BodyScreen() {
  const units = useUnits();
  const q = useQuery((db) => listProgressEntries(db));
  const [weight, setWeight] = useState('');
  const [m, setM] = useState<Partial<Record<MeasurementKey, string>>>({});
  const save = useMutation((db) => {
    const measurements: Partial<Record<MeasurementKey, number>> = {};
    for (const k of MEASUREMENT_KEYS) {
      const v = m[k] ? parseLength(m[k]!, units) : null;
      if (v !== null) measurements[k] = Math.round(v * 10) / 10;
    }
    return saveProgressEntry(db, {
      date: today(),
      body_weight_kg: parseLoad(weight, units),
      measurements,
      notes: null,
    });
  });
  const remove = useMutation((db, id: string) => deleteProgressEntry(db, id));

  if (q.error) return <ErrorState message={q.error} />;
  if (!q.data) return <LoadingState />;
  const entries = q.data;
  const weights = entries.filter((e) => e.body_weight_kg !== null);

  const onSave = async () => {
    try {
      await save.run();
      setWeight('');
      setM({});
    } catch (e) {
      Alert.alert('Not saved', e instanceof Error ? e.message : '');
    }
  };

  return (
    <Screen edges={['bottom']}>
      <RouterStack.Screen options={{ title: '' }} />
      <Header eyebrow="Log today · all optional" title="Body" />
      <Card>
        <NumberField
          label="Body weight"
          unit={loadUnit(units)}
          value={weight}
          onChangeText={setWeight}
        />
        <Text variant="label" muted>
          Measurements (${lengthUnit(units)})
        </Text>
        {[0, 2, 4].map((i) => (
          <Split key={i}>
            {MEASUREMENT_KEYS.slice(i, i + 2).map((k) => (
              <NumberField
                key={k}
                label={LABEL[k]}
                value={m[k] ?? ''}
                onChangeText={(t) => setM({ ...m, [k]: t })}
              />
            ))}
          </Split>
        ))}
        <Button
          label="Save entry"
          onPress={onSave}
          loading={save.pending}
          disabled={!weight && Object.values(m).every((v) => !v)}
        />
        <Text variant="caption" faint>
          Weigh at a consistent time (e.g. morning). Daily weight naturally fluctuates; look at the
          trend.
        </Text>
      </Card>

      <Section title="Body weight trend">
        <Card>
          <LineChart
            points={weights.map((e, i) => ({
              x: i,
              y: displayLoad(e.body_weight_kg, units) ?? 0,
              label: formatDateKey(e.date, { day: 'numeric', month: 'short' }),
            }))}
            formatY={(v) => `${+v.toFixed(1)}`}
            accessibilityLabel={`Body weight over ${weights.length} entries`}
          />
        </Card>
      </Section>

      <Section title="History">
        {entries.length === 0 ? <Text muted>No entries yet.</Text> : null}
        <List>
          {[...entries].reverse().map((e) => (
            <ListRow
              key={e.id}
              title={formatDateKey(e.date)}
              value={
                e.body_weight_kg !== null
                  ? `${displayLoad(e.body_weight_kg, units)} ${loadUnit(units)}`
                  : undefined
              }
              subtitle={
                Object.entries(e.measurements)
                  .map(([k, v]) => `${LABEL[k as MeasurementKey]} ${displayLength(v, units)}`)
                  .join(' · ') || undefined
              }
              onPress={() =>
                Alert.alert('Delete entry?', undefined, [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: () => remove.run(e.id) },
                ])
              }
              chevron={false}
            />
          ))}
        </List>
      </Section>
    </Screen>
  );
}
