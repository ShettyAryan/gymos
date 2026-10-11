import Ionicons from '@expo/vector-icons/Ionicons';
import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { colors, layout, radius, spacing } from '@/theme/tokens';

import { AnimatedFill, PulseDot, Reveal, usePressScale } from './motion';
import { Text } from './Text';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Wraps each top-level child so screen sections settle in with a short stagger. */
function Staggered({ children }: { children: ReactNode }) {
  return (
    <>
      {Children.toArray(children).map((child, i) =>
        isValidElement(child) ? (
          <Reveal key={child.key ?? i} index={i}>
            {child}
          </Reveal>
        ) : (
          child
        ),
      )}
    </>
  );
}

type ScreenProps = {
  children: ReactNode;
  scroll?: boolean;
  edges?: Edge[];
  footer?: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  contentStyle?: StyleProp<ViewStyle>;
};

/**
 * Standard screen: safe area, one shared horizontal gutter, generous vertical rhythm between
 * sections, optional sticky footer aligned to the same gutter.
 */
export function Screen({
  children,
  scroll = true,
  edges = ['top'],
  footer,
  refreshing,
  onRefresh,
  contentStyle,
}: ScreenProps) {
  return (
    <SafeAreaView edges={edges} style={styles.screen}>
      {/* iOS: lift the footer above the keyboard. Android resizes the window (app.json). */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {scroll ? (
          <ScrollView
            contentContainerStyle={[styles.content, contentStyle]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            refreshControl={
              onRefresh ? (
                <RefreshControl
                  refreshing={!!refreshing}
                  onRefresh={onRefresh}
                  tintColor={colors.textMuted}
                />
              ) : undefined
            }
          >
            <Staggered>{children}</Staggered>
          </ScrollView>
        ) : (
          // Fixed screens usually host a FlatList that must keep flex sizing: no stagger wrapper.
          <View style={[styles.content, styles.flex, contentStyle]}>{children}</View>
        )}
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** Page header: optional uppercase eyebrow, large title, optional supporting line. */
export function Header({
  eyebrow,
  live,
  title,
  subtitle,
  right,
}: {
  eyebrow?: string;
  /** Marks the page as live (breathing accent dot before the eyebrow). */
  live?: boolean;
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.flex}>
        {eyebrow ? (
          <View style={styles.eyebrowRow}>
            {live ? <PulseDot color={colors.accent} /> : null}
            <Text variant="label" color={live ? colors.accent : colors.textMuted}>
              {eyebrow}
            </Text>
          </View>
        ) : null}
        <Text variant="title" accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? (
          <Text muted style={styles.subtitle}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

/** Flat surface. No border, no shadow: hierarchy comes from spacing and type. */
export function Card({
  children,
  style,
  onPress,
  accessibilityLabel,
  tone,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  accessibilityLabel?: string;
  /** Marks a live/highlighted card with a thin accent rule on the left. */
  tone?: 'live';
}) {
  const live = tone === 'live' ? styles.cardLive : null;
  const press = usePressScale(0.985);
  if (onPress) {
    return (
      <AnimatedPressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={[styles.card, live, press.style, style]}
      >
        {children}
      </AnimatedPressable>
    );
  }
  return <View style={[styles.card, live, style]}>{children}</View>;
}

/** Section: micro-label (with optional right-aligned action) above its content. */
export function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text variant="label" muted accessibilityRole="header">
          {title}
        </Text>
        {action}
      </View>
      {children}
    </View>
  );
}

/** Small text action for section headers ("All", "Edit"). */
export function SectionAction({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={12}
      style={styles.sectionAction}
    >
      <Text variant="caption" muted>
        {label}
      </Text>
    </Pressable>
  );
}

export function Row({
  children,
  gap = spacing.sm,
  style,
  wrap,
  align = 'center',
}: {
  children: ReactNode;
  gap?: number;
  style?: StyleProp<ViewStyle>;
  wrap?: boolean;
  align?: 'center' | 'flex-start' | 'flex-end' | 'baseline';
}) {
  return (
    <View
      style={[
        { flexDirection: 'row', alignItems: align, gap },
        wrap ? { flexWrap: 'wrap' } : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** Equal-width children: use for button pairs so they align to both edges. */
export function Split({ children, gap = spacing.sm }: { children: ReactNode; gap?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap }}>
      {Children.toArray(children)
        .filter(Boolean)
        .map((c, i) => (
          <View key={i} style={styles.flex}>
            {c}
          </View>
        ))}
    </View>
  );
}

export function Stack({
  children,
  gap = spacing.md,
  style,
}: {
  children: ReactNode;
  gap?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[{ gap }, style]}>{children}</View>;
}

export function Divider({ inset = 0 }: { inset?: number }) {
  return <View style={[styles.divider, inset ? { marginHorizontal: -inset } : null]} />;
}

type ListRowProps = {
  title: string;
  subtitle?: string;
  /** Short right-aligned value (e.g. "3 sessions"). */
  value?: string;
  right?: ReactNode;
  onPress?: () => void;
  chevron?: boolean;
  destructive?: boolean;
  /** Hide the bottom hairline (e.g. last row inside a card). */
  last?: boolean;
};

/**
 * Hairline-separated row aligned flush to the content edge. Title left, optional value and
 * chevron right — no decorative icons.
 */
export function ListRow({
  title,
  subtitle,
  value,
  right,
  onPress,
  chevron = !!onPress,
  destructive,
  last,
}: ListRowProps) {
  const content = (
    <>
      <View style={styles.flex}>
        <Text color={destructive ? colors.danger : undefined} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" muted numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text variant="caption" muted style={styles.rowValue} numberOfLines={2}>
          {value}
        </Text>
      ) : null}
      {right}
      {chevron ? <Ionicons name="chevron-forward" size={16} color={colors.textFaint} /> : null}
    </>
  );
  const style = [styles.listRow, last ? null : styles.listRowRule];
  if (!onPress) return <View style={style}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
      onPress={onPress}
      style={({ pressed }) => [...style, pressed ? styles.rowPressed : null]}
    >
      {content}
    </Pressable>
  );
}

/** Groups ListRows; the final row automatically drops its hairline. */
export function List({ children }: { children: ReactNode }) {
  const items = Children.toArray(children).filter(isValidElement);
  return (
    <View style={styles.list}>
      {items.map((child, i) => (
        <Fragment key={child.key ?? i}>
          {i === items.length - 1 && child.type === ListRow ? (
            <ListRow {...(child.props as ListRowProps)} last />
          ) : (
            child
          )}
        </Fragment>
      ))}
    </View>
  );
}

export function ProgressBar({
  value,
  color = colors.accent,
  label,
}: {
  value: number;
  color?: string;
  label: string;
}) {
  const pct = Math.max(0, Math.min(1, value));
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}
      style={styles.track}
    >
      <AnimatedFill value={pct} color={color} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  content: {
    paddingHorizontal: layout.gutter,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxxl,
    gap: layout.sectionGap,
  },
  footer: {
    paddingHorizontal: layout.gutter,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  header: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md, paddingTop: spacing.xs },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  subtitle: { marginTop: spacing.xs },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: layout.cardPadding,
    gap: spacing.md,
  },
  cardLive: { borderLeftWidth: 2, borderLeftColor: colors.accent },
  section: { gap: spacing.md },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 20,
  },
  sectionAction: { minHeight: 20, justifyContent: 'center' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  list: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: layout.rowMinHeight,
    paddingVertical: spacing.md,
  },
  listRowRule: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowPressed: { opacity: 0.55 },
  rowValue: { textAlign: 'right', fontVariant: ['tabular-nums'], maxWidth: '58%' },
  track: {
    height: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: radius.pill },
});
