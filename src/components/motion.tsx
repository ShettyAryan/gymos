import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  LayoutAnimation,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { isReducedMotion, useReducedMotion } from '@/state/motion';

import { Text, type TextVariant } from './Text';

/**
 * Motion vocabulary — few, quiet, purposeful:
 * - Reveal: content settles into place (fade + 8px rise) when it first appears.
 * - Press scale: controls give a little under the finger.
 * - Pulse: a breathing dot marks anything live.
 * - Count / fill: numbers and bars move to their new value instead of jumping.
 * All of it is skipped when the OS "Reduce motion" setting is on.
 */
export const motion = {
  enter: 360,
  quick: 180,
  stagger: 45,
  maxStagger: 8,
  easeOut: Easing.out(Easing.cubic),
};

/** Fades and lifts children into place once, on mount. `index` staggers siblings. */
export function Reveal({
  children,
  index = 0,
  style,
}: {
  children: ReactNode;
  index?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) {
      progress.setValue(1);
      return;
    }
    Animated.timing(progress, {
      toValue: 1,
      duration: motion.enter,
      delay: Math.min(index, motion.maxStagger) * motion.stagger,
      easing: motion.easeOut,
      useNativeDriver: true,
    }).start();
    // mount-only animation
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/** Scale feedback for pressables: returns handlers + an animated style for the visual layer. */
export function usePressScale(amount = 0.97) {
  const scale = useRef(new Animated.Value(1)).current;
  const to = (v: number) => {
    if (isReducedMotion()) return;
    Animated.spring(scale, {
      toValue: v,
      useNativeDriver: true,
      speed: 40,
      bounciness: v === 1 ? 6 : 0,
    }).start();
  };
  return {
    onPressIn: () => to(amount),
    onPressOut: () => to(1),
    style: { transform: [{ scale }] },
  };
}

/** Breathing dot for live state (in-progress session, running timer). */
export function PulseDot({ color, size = 6 }: { color: string; size?: number }) {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, {
          toValue: 0.25,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(v, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduced, v]);
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        opacity: v,
      }}
    />
  );
}

/** Integer that counts toward its new value instead of jumping (e.g. 12 → 15). */
export function CountUp({
  value,
  variant = 'metric',
  color,
  style,
}: {
  value: number;
  variant?: TextVariant;
  color?: string;
  style?: StyleProp<TextStyle>;
}) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced ? value : 0);
  const anim = useRef(new Animated.Value(reduced ? value : 0)).current;
  useEffect(() => {
    if (reduced) {
      setShown(value);
      return;
    }
    const id = anim.addListener(({ value: v }) => setShown(Math.round(v)));
    Animated.timing(anim, {
      toValue: value,
      duration: 600,
      easing: motion.easeOut,
      useNativeDriver: false,
    }).start();
    return () => anim.removeListener(id);
  }, [value, reduced, anim]);
  return (
    <Text variant={variant} color={color} style={style} accessibilityLabel={String(value)}>
      {shown}
    </Text>
  );
}

/** Animated fill for progress bars: scales from the leading edge to the new fraction. */
export function AnimatedFill({
  value,
  color,
  duration = 500,
}: {
  value: number;
  color: string;
  duration?: number;
}) {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(reduced ? value : 0)).current;
  useEffect(() => {
    if (reduced) {
      v.setValue(value);
      return;
    }
    Animated.timing(v, {
      toValue: value,
      duration,
      easing: motion.easeOut,
      useNativeDriver: true,
    }).start();
  }, [value, reduced, duration, v]);
  return (
    <View style={{ flex: 1, overflow: 'hidden' }}>
      <Animated.View
        style={{
          height: '100%',
          width: '100%',
          backgroundColor: color,
          transformOrigin: 'left',
          transform: [{ scaleX: v }],
        }}
      />
    </View>
  );
}

/** Smooth layout change for the next render (expand/collapse, rows added or removed). */
export function animateNextLayout(): void {
  if (isReducedMotion()) return;
  LayoutAnimation.configureNext(
    LayoutAnimation.create(
      motion.quick + 40,
      LayoutAnimation.Types.easeInEaseOut,
      LayoutAnimation.Properties.opacity,
    ),
  );
}

/** Springs a small element (e.g. a saved checkmark) in from a smaller scale, once, on mount. */
export function PopIn({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(reduced ? 1 : 0.3)).current;
  useEffect(() => {
    if (!reduced)
      Animated.spring(v, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 14 }).start();
    // mount-only animation
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Animated.View style={{ opacity: v, transform: [{ scale: v }] }}>{children}</Animated.View>
  );
}
