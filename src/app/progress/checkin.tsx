import { Stack as RouterStack, router } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import {
  Button,
  ErrorState,
  LoadingState,
  Notice,
  Screen,
  Segmented,
  TextField,
} from '@/components';
import { useMutation, useQuery } from '@/data/DatabaseProvider';
import { today } from '@/data/local/repositories/attendance';
import { getCheckin, saveCheckin, type DailyCheckin } from '@/data/local/repositories/progress';
import { formatDateKey } from '@/utils/dates';
import { parseDecimal } from '@/utils/units';

export default function CheckinScreen() {
  const q = useQuery((db) => getCheckin(db, today()));
  if (q.error) return <ErrorState message={q.error} />;
  if (q.data === undefined) return <LoadingState />;
  return <CheckinForm existing={q.data} />;
}

const scale = (label: string) => [
  { value: 'skip', label: '—' },
  ...[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: n === 1 ? `1 ${label}` : String(n) })),
];
const num = (v: number | null) => (v === null ? '' : String(v));

function CheckinForm({ existing }: { existing: DailyCheckin | null }) {
  const [protein, setProtein] = useState(num(existing?.protein_g ?? null));
  const [water, setWater] = useState(existing?.water_ml ? String(existing.water_ml / 1000) : '');
  const [sleep, setSleep] = useState(num(existing?.sleep_hours ?? null));
  const [quality, setQuality] = useState(
    existing?.sleep_quality ? String(existing.sleep_quality) : 'skip',
  );
  const [energy, setEnergy] = useState(existing?.energy ? String(existing.energy) : 'skip');
  const [soreness, setSoreness] = useState(existing?.soreness ? String(existing.soreness) : 'skip');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const scaleVal = (v: string) => (v === 'skip' ? null : Number(v));

  const save = useMutation((db) =>
    saveCheckin(db, today(), {
      protein_g: parseDecimal(protein),
      water_ml: parseDecimal(water) === null ? null : Math.round(parseDecimal(water)! * 1000),
      sleep_hours: parseDecimal(sleep),
      sleep_quality: scaleVal(quality),
      energy: scaleVal(energy),
      soreness: scaleVal(soreness),
      notes: notes.trim() || null,
    }),
  );

  const onSave = async () => {
    try {
      await save.run();
      router.back();
    } catch (e) {
      Alert.alert('Not saved', e instanceof Error ? e.message : '');
    }
  };

  return (
    <Screen
      edges={['bottom']}
      footer={<Button label="Save check-in" onPress={onSave} loading={save.pending} />}
    >
      <RouterStack.Screen options={{ title: `Check-in · ${formatDateKey(today())}` }} />
      <Notice
        tone="info"
        message="Everything here is optional — fill in what's useful or skip it entirely. Check-ins give context to your reviews; they do not diagnose anything."
      />
      <TextField
        label="Protein (g)"
        optional
        keyboardType="decimal-pad"
        value={protein}
        onChangeText={setProtein}
        hint="A rough estimate is fine."
      />
      <TextField
        label="Water (litres)"
        optional
        keyboardType="decimal-pad"
        value={water}
        onChangeText={setWater}
      />
      <TextField
        label="Sleep (hours)"
        optional
        keyboardType="decimal-pad"
        value={sleep}
        onChangeText={setSleep}
      />
      <Segmented
        label="Sleep quality (1 poor – 5 great)"
        options={scale('poor')}
        value={quality}
        onChange={setQuality}
      />
      <Segmented
        label="Energy (1 low – 5 high)"
        options={scale('low')}
        value={energy}
        onChange={setEnergy}
      />
      <Segmented
        label="Soreness (1 none – 5 very)"
        options={scale('none')}
        value={soreness}
        onChange={setSoreness}
      />
      <TextField
        label="Notes"
        optional
        multiline
        value={notes}
        onChangeText={setNotes}
        maxLength={500}
      />
    </Screen>
  );
}
