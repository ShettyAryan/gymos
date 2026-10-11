import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/**
 * Small, purposeful haptics. Never throws and never awaited on the logging path —
 * feedback is fire-and-forget after the data is already persisted.
 */
const run = (fn: () => Promise<void> | void) => {
  if (Platform.OS === 'web') return;
  try {
    Promise.resolve(fn()).catch(() => undefined);
  } catch {
    // Haptics unavailable (simulator, older device): silently ignore.
  }
};

export const haptics = {
  /** Selection change: chips, segments, steppers, tabs. */
  select: () => run(() => Haptics.selectionAsync()),
  /** Button press. */
  tap: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  /** Something was saved / completed (set logged, workout finished). */
  success: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  /** Attention without alarm (rest finished). */
  alert: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
};
