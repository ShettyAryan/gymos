import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import type { MuscleRow, VolumeStatus } from '@/domain/rules/insights';
import { muscleLabel } from '@/domain/rules/insights';
import { useReducedMotion } from '@/state/motion';
import { colors, radius, spacing, toneColor, type StatusTone } from '@/theme/tokens';

import { Text } from '../Text';

export const STATUS_TONE: Record<VolumeStatus, StatusTone> = {
  none: 'danger',
  under: 'warning',
  low: 'warning',
  good: 'success',
  high: 'info',
  very_high: 'danger',
};

export const STATUS_WORD: Record<VolumeStatus, string> = {
  none: 'Not trained',
  under: 'Under',
  low: 'Low',
  good: 'On target',
  high: 'High',
  very_high: 'Too high',
};

/**
 * Weekly sets per muscle against the goal range (shaded band). Each row: name, bar coloured by
 * status, exact value and a status word — so meaning never depends on colour alone.
 */
export function VolumeBars({ rows }: { rows: MuscleRow[] }) {
  const reduced = useReducedMotion();
  const grow = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  const scaleMax = Math.max(...rows.map((r) => Math.max(r.weeklySets, r.range[1] * 1.3)), 1);
  useEffect(() => {
    if (reduced) {
      grow.setValue(1);
      return;
    }
    Animated.timing(grow, {
      toValue: 1,
      duration: 700,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [reduced, grow]);

  return (
    <View style={styles.wrap}>
      {rows.map((r) => {
        const tone = STATUS_TONE[r.status];
        const [lo, hi] = r.range;
        return (
          <View
            key={r.muscle}
            style={styles.row}
            accessible
            accessibilityLabel={`${muscleLabel(r.muscle)}: ${r.weeklySets} sets per week, ${STATUS_WORD[r.status]}. Target ${lo} to ${hi}.`}
          >
            <Text variant="caption" style={styles.name} numberOfLines={1}>
              {muscleLabel(r.muscle)}
            </Text>
            <View style={styles.track}>
              <View
                style={[
                  styles.band,
                  { left: `${(lo / scaleMax) * 100}%`, width: `${((hi - lo) / scaleMax) * 100}%` },
                ]}
              />
              <Animated.View
                style={[
                  styles.bar,
                  {
                    width: `${Math.min(100, (r.weeklySets / scaleMax) * 100)}%`,
                    backgroundColor: toneColor[tone],
                    transform: [{ scaleX: grow }],
                  },
                ]}
              />
            </View>
            <Text variant="caption" style={styles.value}>
              {r.weeklySets}
            </Text>
            <Text
              variant="caption"
              color={r.status === 'good' ? colors.textMuted : colors.text}
              style={styles.status}
              numberOfLines={1}
            >
              {STATUS_WORD[r.status]}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 28 },
  name: { width: 82 },
  track: {
    flex: 1,
    height: 10,
    borderRadius: radius.xs,
    backgroundColor: colors.surfaceAlt,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  band: { position: 'absolute', top: 0, bottom: 0, backgroundColor: colors.borderStrong },
  bar: { height: 6, borderRadius: radius.xs, transformOrigin: 'left', marginLeft: 0 },
  value: { width: 34, textAlign: 'right', fontVariant: ['tabular-nums'] },
  status: { width: 74 },
});
