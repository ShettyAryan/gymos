import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';

import { useReducedMotion } from '@/state/motion';
import { colors, radius, spacing } from '@/theme/tokens';
import { haptics } from '@/utils/haptics';

import { Text } from '../Text';

export type Bar = { label: string; value: number };

type Props = {
  data: Bar[];
  height?: number;
  formatValue?: (v: number) => string;
  /** Spoken summary for screen readers. */
  accessibilityLabel: string;
  /** Unit word for the tapped-value readout (e.g. "sets"). */
  unit?: string;
};

/**
 * Single-series column chart. Thin bars anchored to a baseline, the most recent bar in the
 * accent, a recessive max guide; tap a bar to read its exact value (mobile "tooltip").
 */
export function BarChart({
  data,
  height = 140,
  formatValue = (v) => String(v),
  accessibilityLabel,
  unit,
}: Props) {
  const reduced = useReducedMotion();
  const grow = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const key = data.map((d) => d.value).join(',');

  useEffect(() => {
    if (reduced) {
      grow.setValue(1);
      return;
    }
    grow.setValue(0);
    Animated.timing(grow, {
      toValue: 1,
      duration: 600,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [key, reduced, grow]);

  const shown = active ?? data.length - 1;
  const focus = data[shown];

  return (
    <View accessible accessibilityLabel={accessibilityLabel} style={styles.wrap}>
      <View style={styles.readout}>
        <Text variant="metric" style={styles.tabular}>
          {focus ? formatValue(focus.value) : '—'}
          {unit ? (
            <Text variant="caption" muted>
              {' '}
              {unit}
            </Text>
          ) : null}
        </Text>
        <Text variant="caption" muted>
          {focus ? (active === null ? `This week · ${focus.label}` : focus.label) : ''}
        </Text>
      </View>
      <View style={[styles.plot, { height }]}>
        <View style={[styles.guide, { top: 0 }]} />
        <Text variant="label" faint style={styles.maxLabel}>
          {formatValue(max)}
        </Text>
        <View style={styles.bars}>
          {data.map((d, i) => {
            const isLast = i === data.length - 1;
            const isActive = i === shown;
            return (
              <Pressable
                key={`${d.label}-${i}`}
                style={styles.col}
                onPress={() => {
                  haptics.select();
                  setActive(i === active ? null : i);
                }}
                accessibilityLabel={`${d.label}: ${formatValue(d.value)}${unit ? ` ${unit}` : ''}`}
              >
                <Animated.View
                  style={[
                    styles.bar,
                    {
                      height: Math.max(d.value > 0 ? 3 : 1, (d.value / max) * height),
                      backgroundColor:
                        d.value === 0
                          ? colors.border
                          : isLast
                            ? colors.accent
                            : isActive
                              ? colors.text
                              : colors.borderStrong,
                      transform: [{ scaleY: grow }],
                    },
                  ]}
                />
              </Pressable>
            );
          })}
        </View>
      </View>
      <View style={styles.axis}>
        <Text variant="label" faint>
          {data[0]?.label ?? ''}
        </Text>
        <Text variant="label" faint>
          {data[data.length - 1]?.label ?? ''}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  tabular: { fontVariant: ['tabular-nums'] },
  readout: { gap: 2 },
  plot: {
    justifyContent: 'flex-end',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderStrong,
  },
  guide: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    borderStyle: 'dashed',
  },
  maxLabel: { position: 'absolute', right: 0, top: -16 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', height: '100%', gap: 2 },
  col: { flex: 1, height: '100%', justifyContent: 'flex-end', alignItems: 'center' },
  bar: {
    width: '62%',
    maxWidth: 18,
    borderTopLeftRadius: radius.xs,
    borderTopRightRadius: radius.xs,
    transformOrigin: 'bottom',
  },
  axis: { flexDirection: 'row', justifyContent: 'space-between' },
});
