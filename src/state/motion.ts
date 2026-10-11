import { AccessibilityInfo } from 'react-native';
import { create } from 'zustand';

/** Mirrors the OS "Reduce motion" setting; every animation checks it. */
export const useMotion = create<{ reduced: boolean }>(() => ({ reduced: false }));

export const useReducedMotion = () => useMotion((s) => s.reduced);
export const isReducedMotion = () => useMotion.getState().reduced;

export function startMotionMonitor(): () => void {
  AccessibilityInfo.isReduceMotionEnabled()
    .then((reduced) => useMotion.setState({ reduced }))
    .catch(() => undefined);
  const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (reduced) =>
    useMotion.setState({ reduced }),
  );
  return () => sub.remove();
}
