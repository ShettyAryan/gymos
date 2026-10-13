import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useReducedMotion } from '@/state/motion';
import { colors, layout, radius, spacing } from '@/theme/tokens';
import { haptics } from '@/utils/haptics';

import { Text } from './Text';

/**
 * Bottom sheet: dimmed backdrop (tap to dismiss), content slides up, respects the bottom safe
 * area. Used for action menus and the in-app date picker so they look the same on every device.
 */
export function Sheet({
  visible,
  onClose,
  title,
  message,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  message?: string;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const y = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!visible) return;
    if (reduced) {
      y.setValue(0);
      return;
    }
    y.setValue(1);
    Animated.timing(y, {
      toValue: 0,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible, reduced, y]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View style={styles.root}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
        />
        <Animated.View
          style={[
            styles.sheet,
            { paddingBottom: Math.max(insets.bottom, spacing.lg) },
            {
              transform: [
                { translateY: y.interpolate({ inputRange: [0, 1], outputRange: [0, 400] }) },
              ],
            },
          ]}
          accessibilityViewIsModal
        >
          <View style={styles.grabber} />
          {title ? (
            <Text variant="heading" accessibilityRole="header">
              {title}
            </Text>
          ) : null}
          {message ? (
            <Text variant="caption" muted>
              {message}
            </Text>
          ) : null}
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

export type SheetAction = {
  label: string;
  description?: string;
  onPress: () => void;
  destructive?: boolean;
  disabled?: boolean;
};

/** Action menu with any number of options and an always-present Cancel. */
export function ActionSheet({
  visible,
  onClose,
  title,
  message,
  actions,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  message?: string;
  actions: SheetAction[];
}) {
  return (
    <Sheet visible={visible} onClose={onClose} title={title} message={message}>
      <View style={styles.actions}>
        {actions.map((a, i) => (
          <Pressable
            key={a.label}
            accessibilityRole="button"
            accessibilityLabel={a.description ? `${a.label}. ${a.description}` : a.label}
            accessibilityState={{ disabled: !!a.disabled }}
            disabled={a.disabled}
            onPress={() => {
              haptics.select();
              onClose();
              a.onPress();
            }}
            style={({ pressed }) => [
              styles.action,
              i > 0 ? styles.actionRule : null,
              pressed ? styles.pressed : null,
              a.disabled ? styles.disabled : null,
            ]}
          >
            <Text color={a.destructive ? colors.danger : colors.text}>{a.label}</Text>
            {a.description ? (
              <Text variant="caption" muted>
                {a.description}
              </Text>
            ) : null}
          </Pressable>
        ))}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Cancel"
        onPress={onClose}
        style={({ pressed }) => [styles.cancel, pressed ? styles.pressed : null]}
      >
        <Text variant="bodyStrong">Cancel</Text>
      </Pressable>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg + 6,
    borderTopRightRadius: radius.lg + 6,
    paddingHorizontal: layout.gutter,
    paddingTop: spacing.sm,
    gap: spacing.md,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    marginBottom: spacing.sm,
  },
  actions: { borderRadius: radius.md, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
  action: {
    minHeight: 52,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: 2,
  },
  actionRule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderStrong },
  cancel: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
  },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.4 },
});
