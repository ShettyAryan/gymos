import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';

import { useReducedMotion } from '@/state/motion';
import { fonts } from '@/theme/fonts';
import { colors } from '@/theme/tokens';

import { Text } from '../Text';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export type ChartPoint = { x: number; y: number; label?: string };

type Props = {
  points: ChartPoint[];
  height?: number;
  formatY?: (v: number) => string;
  /** Spoken summary for screen readers (charts are not otherwise accessible). */
  accessibilityLabel: string;
  color?: string;
};

/**
 * Minimal dependency-light line chart (react-native-svg). All chart usage goes through this
 * component so the rendering library can be swapped without touching screens.
 */
export function LineChart({
  points,
  height = 160,
  formatY = (v) => String(+v.toFixed(1)),
  accessibilityLabel,
  color = colors.text,
}: Props) {
  const [width, setWidth] = useState(0);
  const reduced = useReducedMotion();
  // 0 → 1 draw progress; restarts when the data or size changes.
  const draw = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  const dataKey = `${width}|${points.map((p) => p.y).join(',')}`;
  useEffect(() => {
    if (!width) return;
    if (reduced) {
      draw.setValue(1);
      return;
    }
    draw.setValue(0);
    Animated.timing(draw, {
      toValue: 1,
      duration: 900,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [dataKey, width, reduced, draw]);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  if (points.length === 0) {
    return (
      <Text muted variant="caption">
        No data yet.
      </Text>
    );
  }
  const padL = 44;
  const padR = 10;
  const padT = 10;
  const padB = 20;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  let minY = Math.min(...ys);
  let maxY = Math.max(...ys);
  if (minY === maxY) {
    minY -= 1;
    maxY += 1;
  }
  const w = Math.max(1, width - padL - padR);
  const h = height - padT - padB;
  const sx = (x: number) => padL + (maxX === minX ? w / 2 : ((x - minX) / (maxX - minX)) * w);
  const sy = (y: number) => padT + h - ((y - minY) / (maxY - minY)) * h;
  const d = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`)
    .join(' ');
  const ticks = [minY, (minY + maxY) / 2, maxY];
  let length = 1;
  for (let i = 1; i < points.length; i++) {
    length += Math.hypot(
      sx(points[i]!.x) - sx(points[i - 1]!.x),
      sy(points[i]!.y) - sy(points[i - 1]!.y),
    );
  }

  return (
    <View
      onLayout={onLayout}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      style={{ height }}
    >
      {width > 0 ? (
        <Svg width={width} height={height}>
          {ticks.map((t) => (
            <Line
              key={t}
              x1={padL}
              x2={width - padR}
              y1={sy(t)}
              y2={sy(t)}
              stroke={colors.borderStrong}
              strokeWidth={StyleSheet.hairlineWidth}
              strokeDasharray="2 4"
            />
          ))}
          {ticks.map((t) => (
            <SvgText
              key={`l${t}`}
              x={padL - 6}
              y={sy(t) + 4}
              fill={colors.textFaint}
              fontSize={10}
              fontFamily={fonts.mono}
              textAnchor="end"
            >
              {formatY(t)}
            </SvgText>
          ))}
          <AnimatedPath
            d={d}
            stroke={color}
            strokeWidth={1.5}
            fill="none"
            strokeLinejoin="round"
            strokeDasharray={`${length} ${length}`}
            strokeDashoffset={draw.interpolate({ inputRange: [0, 1], outputRange: [length, 0] })}
          />
          {points.map((p, i) =>
            i === points.length - 1 ? (
              <AnimatedCircle
                key={i}
                cx={sx(p.x)}
                cy={sy(p.y)}
                r={4}
                fill={colors.accent}
                opacity={draw.interpolate({ inputRange: [0, 0.85, 1], outputRange: [0, 0, 1] })}
              />
            ) : (
              <Circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={1.5} fill={color} />
            ),
          )}
          {points[0]?.label ? (
            <SvgText
              x={padL}
              y={height - 4}
              fill={colors.textFaint}
              fontSize={10}
              fontFamily={fonts.mono}
            >
              {points[0].label}
            </SvgText>
          ) : null}
          {points.length > 1 && points[points.length - 1]?.label ? (
            <SvgText
              x={width - padR}
              y={height - 4}
              fill={colors.textFaint}
              fontSize={10}
              fontFamily={fonts.mono}
              textAnchor="end"
            >
              {points[points.length - 1]!.label}
            </SvgText>
          ) : null}
        </Svg>
      ) : null}
    </View>
  );
}
