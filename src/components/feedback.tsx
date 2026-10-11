import { Children, useEffect, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { useNetworkStatus } from '@/state/network';
import { colors, layout, radius, spacing, toneColor, type StatusTone } from '@/theme/tokens';

import { Button } from './Button';
import { CountUp, PulseDot, Reveal } from './motion';
import { Text } from './Text';

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <View style={styles.center} accessibilityLiveRegion="polite" accessibilityLabel={label}>
      <ActivityIndicator color={colors.textMuted} />
      <Text variant="caption" muted>
        {label}
      </Text>
    </View>
  );
}

/** Quiet, left-aligned empty state: a statement, one line of guidance, one action. */
export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyRule} />
      <Text variant="heading">{title}</Text>
      {message ? <Text muted>{message}</Text> : null}
      {action ? <View style={styles.emptyAction}>{action}</View> : null}
    </View>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <View style={styles.empty} accessibilityRole="alert">
      <View style={[styles.emptyRule, { backgroundColor: colors.danger }]} />
      <Text variant="heading">{title}</Text>
      {message ? <Text muted>{message}</Text> : null}
      {onRetry ? (
        <View style={styles.emptyAction}>
          <Button label="Try again" variant="secondary" compact onPress={onRetry} />
        </View>
      ) : null}
    </View>
  );
}

/** Status tag: a coloured dot plus a word. The word carries the meaning; colour reinforces it. */
export function StatusPill({ label, tone = 'neutral' }: { label: string; tone?: StatusTone }) {
  return (
    <View style={styles.tag} accessible accessibilityLabel={label}>
      {tone === 'accent' ? (
        <PulseDot color={toneColor[tone]} />
      ) : (
        <View style={[styles.dot, { backgroundColor: toneColor[tone] }]} />
      )}
      <Text
        variant="caption"
        color={tone === 'neutral' ? colors.textMuted : colors.text}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}

/** Inline note with a thin tone rule on the left. No icons, no boxes within boxes. */
export function Notice({
  tone = 'info',
  title,
  message,
  children,
}: {
  tone?: StatusTone;
  title?: string;
  message?: string;
  children?: ReactNode;
}) {
  return (
    <View
      style={[styles.notice, { borderLeftColor: toneColor[tone] }]}
      accessibilityRole={tone === 'danger' ? 'alert' : undefined}
    >
      {title ? <Text variant="bodyStrong">{title}</Text> : null}
      {message ? (
        <Text variant="caption" muted>
          {message}
        </Text>
      ) : null}
      {children ? <View style={styles.noticeChildren}>{children}</View> : null}
    </View>
  );
}

/** Shown whenever the device is offline. Core features keep working; this is informational. */
export function OfflineBanner() {
  const online = useNetworkStatus((s) => s.online);
  if (online !== false) return null;
  return (
    <View
      style={styles.offline}
      accessibilityLiveRegion="polite"
      accessibilityLabel="Offline. Changes are saved on this device."
    >
      <View style={[styles.dot, { backgroundColor: colors.warning }]} />
      <Text variant="label" color={colors.warning}>
        Offline · saved on device
      </Text>
    </View>
  );
}

/** Lightweight undo bar for reversible actions (e.g. deleting a set). */
export function UndoBar({
  message,
  onUndo,
  onDismiss,
  timeoutMs = 6000,
}: {
  message: string;
  onUndo: () => void;
  onDismiss: () => void;
  timeoutMs?: number;
}) {
  useEffect(() => {
    const t = setTimeout(onDismiss, timeoutMs);
    return () => clearTimeout(t);
  }, [onDismiss, timeoutMs, message]);
  return (
    <Reveal>
      <View style={styles.undo} accessibilityLiveRegion="polite">
        <Text style={styles.flex}>{message}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Undo"
          onPress={onUndo}
          style={styles.undoBtn}
        >
          <Text variant="bodyStrong">Undo</Text>
        </Pressable>
      </View>
    </Reveal>
  );
}

/** Integers (and the first number of "x/y") count up to their value; anything else renders as-is. */
function MetricValue({ value, color }: { value: string; color?: string }) {
  const m = /^(\d+)(\/\d+)?$/.exec(value);
  if (!m) {
    return (
      <Text variant="metric" color={color} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    );
  }
  return (
    <Text variant="metric" color={color} numberOfLines={1}>
      <CountUp value={Number(m[1])} color={color} />
      {m[2] ? (
        <Text variant="metric" color={colors.textFaint}>
          {m[2]}
        </Text>
      ) : null}
    </Text>
  );
}

export function Metric({
  label,
  value,
  hint,
  live,
}: {
  label: string;
  value: string;
  hint?: string;
  live?: boolean;
}) {
  return (
    <View
      style={styles.metric}
      accessible
      accessibilityLabel={`${label}: ${value}${hint ? `, ${hint}` : ''}`}
    >
      <Text variant="label" muted numberOfLines={1}>
        {label}
      </Text>
      <MetricValue value={value} color={live ? colors.accent : undefined} />
      {hint ? (
        <Text variant="caption" faint numberOfLines={1}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

/** Evenly divided metrics with hairline separators so values align on a grid. */
export function MetricRow({ children }: { children: ReactNode }) {
  const items = Children.toArray(children).filter(Boolean);
  return (
    <View style={styles.metricRow}>
      {items.map((c, i) => (
        <View key={i} style={[styles.metricCell, i > 0 ? styles.metricCellRule : null]}>
          {c}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, gap: spacing.sm },
  empty: { paddingVertical: spacing.xl, gap: spacing.sm },
  emptyRule: {
    width: 24,
    height: 2,
    backgroundColor: colors.borderStrong,
    marginBottom: spacing.sm,
  },
  emptyAction: { marginTop: spacing.sm, alignSelf: 'flex-start' },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm - 2,
    alignSelf: 'flex-start',
    flexShrink: 1,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  notice: {
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingLeft: spacing.md,
    borderLeftWidth: 2,
  },
  noticeChildren: { marginTop: spacing.sm, alignItems: 'flex-start' },
  offline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  undo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs,
    minHeight: 52,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
  },
  undoBtn: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.lg },
  metric: { gap: spacing.xs },
  metricRow: { flexDirection: 'row' },
  metricCell: { flex: 1, paddingRight: spacing.sm },
  metricCellRule: {
    paddingLeft: layout.cardPadding - 4,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.border,
  },
});
