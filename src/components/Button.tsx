import Ionicons from '@expo/vector-icons/Ionicons';
import { useState, type ComponentProps } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, type ViewStyle } from 'react-native';

import { colors, radius, spacing, touchTarget } from '@/theme/tokens';
import { haptics } from '@/utils/haptics';

import { usePressScale } from './motion';

import { Text } from './Text';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type IconName = ComponentProps<typeof Ionicons>['name'];
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'live';

type Props = {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  compact?: boolean;
  /** Stretch to fill the row (flex: 1). */
  grow?: boolean;
  /** Hug its label and align to the leading edge (for a lone button in a column). */
  inline?: boolean;
  accessibilityHint?: string;
  style?: ViewStyle;
  testID?: string;
};

const palette: Record<Variant, { bg: string; pressed: string; fg: string }> = {
  // Ink on dark: calm, high-contrast primary action.
  primary: { bg: colors.ink, pressed: '#D9D8D2', fg: colors.onInk },
  secondary: { bg: colors.surfacePressed, pressed: '#2E2E2E', fg: colors.text },
  ghost: { bg: 'transparent', pressed: colors.surfaceAlt, fg: colors.textMuted },
  danger: { bg: colors.surfacePressed, pressed: '#2E2E2E', fg: colors.danger },
  // Signal accent: reserved for live actions (start / resume a workout).
  live: { bg: colors.accent, pressed: colors.accentPressed, fg: colors.onAccent },
};

/** Disabled buttons stay visible (muted surface + faint label) so the action is discoverable. */
const DISABLED = { bg: colors.surfaceAlt, pressed: colors.surfaceAlt, fg: colors.textFaint };

/** Text-only button. Labels carry the meaning; icons are reserved for IconButton. */
export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  compact,
  grow,
  inline,
  accessibilityHint,
  style,
  testID,
}: Props) {
  const inactive = disabled || loading;
  const p = disabled && !loading && variant !== 'ghost' ? DISABLED : palette[variant];
  const press = usePressScale(compact ? 0.95 : 0.97);
  const [pressed, setPressed] = useState(false);
  return (
    <AnimatedPressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPressIn={() => {
        setPressed(true);
        press.onPressIn();
      }}
      onPressOut={() => {
        setPressed(false);
        press.onPressOut();
      }}
      onPress={() => {
        if (variant !== 'ghost') haptics.tap();
        onPress?.();
      }}
      style={[
        styles.base,
        compact ? styles.compact : null,
        variant === 'ghost' ? styles.ghost : null,
        grow ? styles.grow : null,
        inline ? styles.inline : null,
        { backgroundColor: pressed ? p.pressed : p.bg },
        disabled && variant === 'ghost' ? styles.disabled : null,
        press.style,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={p.fg} />
      ) : (
        <Text
          variant={compact ? 'caption' : 'bodyStrong'}
          color={p.fg}
          numberOfLines={1}
          style={compact ? styles.compactLabel : null}
        >
          {label}
        </Text>
      )}
    </AnimatedPressable>
  );
}

type IconButtonProps = {
  icon: IconName;
  label: string;
  onPress?: () => void;
  color?: string;
  disabled?: boolean;
  size?: number;
};

/** Icon-only button; always has an accessibility label and a 48dp target. */
export function IconButton({
  icon,
  label,
  onPress,
  color = colors.textMuted,
  disabled,
  size = 20,
}: IconButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.icon,
        pressed ? { backgroundColor: colors.surfaceAlt } : null,
        disabled ? styles.disabledIcon : null,
      ]}
    >
      <Ionicons name={icon} size={size} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 52,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compact: { minHeight: 36, paddingHorizontal: spacing.md, borderRadius: radius.sm },
  compactLabel: { fontWeight: '600' },
  ghost: { paddingHorizontal: spacing.sm },
  grow: { flex: 1 },
  inline: { alignSelf: 'flex-start' },
  disabled: { opacity: 0.35 },
  disabledIcon: { opacity: 0.25 },
  icon: {
    width: touchTarget,
    height: touchTarget,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
