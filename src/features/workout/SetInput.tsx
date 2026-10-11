import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Button, NumberField, Row, Segmented, Text, ToggleRow } from '@/components';
import type { LoggingType } from '@/domain/models/constants';
import type { WorkoutSet } from '@/domain/models/types';
import type { SetValues } from '@/domain/validation/set';
import { colors, spacing } from '@/theme/tokens';
import {
  displayDistance,
  displayLoad,
  distanceUnit,
  loadUnit,
  parseDecimal,
  parseDistance,
  parseIntSafe,
  parseLoad,
  type UnitSystem,
} from '@/utils/units';

export type SetDraft = {
  load: string;
  reps: string;
  duration: string;
  distance: string;
  effort: string; // 'none' | 'rir:N' | 'rpe:N'
  warmup: boolean;
};

export function draftFromSet(
  s: Partial<Pick<WorkoutSet, 'load_kg' | 'reps' | 'duration_seconds' | 'distance_m'>> | null,
  t: LoggingType,
  u: UnitSystem,
): SetDraft {
  const durationValue =
    s?.duration_seconds == null
      ? ''
      : t === 'duration'
        ? String(+(s.duration_seconds / 60).toFixed(2))
        : String(s.duration_seconds);
  return {
    load: s?.load_kg == null ? '' : String(displayLoad(s.load_kg, u)),
    reps: s?.reps == null ? '' : String(s.reps),
    duration: durationValue,
    distance: s?.distance_m == null ? '' : String(displayDistance(s.distance_m, u)),
    effort: 'none',
    warmup: false,
  };
}

export function valuesFromDraft(d: SetDraft, t: LoggingType, u: UnitSystem): SetValues {
  const [kind, raw] = d.effort.split(':');
  const minutesToSeconds = (s: string) => {
    const v = parseDecimal(s);
    return v === null ? null : Math.round(v * 60);
  };
  return {
    load_kg: t === 'duration' || t === 'hold' || t === 'distance' ? null : parseLoad(d.load, u),
    reps: t === 'duration' || t === 'hold' || t === 'distance' ? null : parseIntSafe(d.reps),
    duration_seconds:
      t === 'duration' || t === 'distance'
        ? minutesToSeconds(d.duration)
        : t === 'hold'
          ? parseIntSafe(d.duration)
          : null,
    distance_m: t === 'distance' ? parseDistance(d.distance, u) : null,
    rpe: kind === 'rpe' ? Number(raw) : null,
    rir: kind === 'rir' ? Number(raw) : null,
    is_warmup: d.warmup,
    notes: null,
  };
}

type Props = {
  loggingType: LoggingType;
  units: UnitSystem;
  draft: SetDraft;
  onChange: (d: SetDraft) => void;
  onSubmit: () => void;
  submitting: boolean;
  submitLabel?: string;
};

/** Fields shown depend on the exercise's logging type. */
export function SetInput({
  loggingType: t,
  units: u,
  draft,
  onChange,
  onSubmit,
  submitting,
  submitLabel = 'Log set',
}: Props) {
  const [showMore, setShowMore] = useState(false);
  const set = (patch: Partial<SetDraft>) => onChange({ ...draft, ...patch });
  return (
    <View style={{ gap: spacing.sm }}>
      <Row>
        {t === 'weight_reps' || t === 'bodyweight_reps' || t === 'assisted_bodyweight' ? (
          <>
            <NumberField
              label={
                t === 'assisted_bodyweight'
                  ? 'Assistance'
                  : t === 'bodyweight_reps'
                    ? 'Added load'
                    : 'Load'
              }
              unit={loadUnit(u)}
              value={draft.load}
              onChangeText={(v) => set({ load: v })}
              placeholder={t === 'bodyweight_reps' ? '0' : undefined}
            />
            <NumberField
              label="Reps"
              value={draft.reps}
              onChangeText={(v) => set({ reps: v })}
              decimal={false}
            />
          </>
        ) : null}
        {t === 'hold' ? (
          <NumberField
            label="Hold"
            unit="sec"
            value={draft.duration}
            onChangeText={(v) => set({ duration: v })}
            decimal={false}
          />
        ) : null}
        {t === 'duration' ? (
          <NumberField
            label="Duration"
            unit="min"
            value={draft.duration}
            onChangeText={(v) => set({ duration: v })}
          />
        ) : null}
        {t === 'distance' ? (
          <>
            <NumberField
              label="Distance"
              unit={distanceUnit(u)}
              value={draft.distance}
              onChangeText={(v) => set({ distance: v })}
            />
            <NumberField
              label="Time"
              unit="min"
              value={draft.duration}
              onChangeText={(v) => set({ duration: v })}
              placeholder="opt."
            />
          </>
        ) : null}
      </Row>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          showMore ? 'Hide effort and warm-up options' : 'Show effort and warm-up options'
        }
        onPress={() => setShowMore((s) => !s)}
        style={{ minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}
      >
        <Text variant="label" muted style={{ flex: 1 }}>
          Effort & warm-up
        </Text>
        <Text
          variant="caption"
          color={draft.effort !== 'none' || draft.warmup ? colors.text : colors.textFaint}
        >
          {[
            draft.effort !== 'none' ? draft.effort.replace(':', ' ').toUpperCase() : null,
            draft.warmup ? 'Warm-up' : null,
          ]
            .filter(Boolean)
            .join(' · ') || 'Optional'}
        </Text>
        <Ionicons
          name={showMore ? 'chevron-up' : 'chevron-down'}
          size={14}
          color={colors.textFaint}
        />
      </Pressable>
      {showMore ? (
        <View style={{ gap: spacing.sm }}>
          <Segmented
            label="Reps in reserve"
            options={[
              { value: 'none', label: '—' },
              ...['0', '1', '2', '3', '4'].map((v) => ({
                value: `rir:${v}`,
                label: v === '4' ? '4+' : v,
              })),
            ]}
            value={draft.effort.startsWith('rpe') ? null : draft.effort}
            onChange={(v) => set({ effort: v })}
          />
          <Segmented
            label="or RPE"
            options={['6', '7', '8', '9', '10'].map((v) => ({ value: `rpe:${v}`, label: v }))}
            value={draft.effort.startsWith('rpe') ? draft.effort : null}
            onChange={(v) => set({ effort: v })}
          />
          <ToggleRow
            label="Warm-up set"
            description="Not counted toward targets, PRs or progression."
            value={draft.warmup}
            onChange={(v) => set({ warmup: v })}
          />
        </View>
      ) : null}
      <Button label={submitLabel} onPress={onSubmit} loading={submitting} testID="log-set" />
    </View>
  );
}
