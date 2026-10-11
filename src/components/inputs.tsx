import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Switch,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useReducedMotion } from '@/state/motion';
import { fonts } from '@/theme/fonts';
import { colors, radius, spacing, touchTarget } from '@/theme/tokens';

import { haptics } from '@/utils/haptics';

import { usePressScale } from './motion';
import { Text } from './Text';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Chip with press-scale; selection is announced via accessibilityState. */
function Chip({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) {
  const press = usePressScale(0.94);
  return (
    <AnimatedPressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      accessibilityLabel={label}
      onPress={() => {
        haptics.select();
        onPress();
      }}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={[styles.chip, on ? styles.chipOn : null, press.style]}
    >
      <Text
        variant="caption"
        color={on ? colors.onInk : colors.text}
        style={on ? styles.bold : null}
      >
        {label}
      </Text>
    </AnimatedPressable>
  );
}

type TextFieldProps = {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  hint?: string;
  error?: string | null;
  optional?: boolean;
  multiline?: boolean;
  keyboardType?: KeyboardTypeOptions;
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  autoComplete?: 'email' | 'password' | 'off';
  maxLength?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

function FieldLabel({ label, optional }: { label: string; optional?: boolean }) {
  return (
    <View style={styles.labelRow}>
      <Text variant="label" muted style={styles.flex} numberOfLines={1}>
        {label}
      </Text>
      {optional ? (
        <Text variant="caption" faint>
          Optional
        </Text>
      ) : null}
    </View>
  );
}

export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  hint,
  error,
  optional,
  multiline,
  keyboardType,
  secureTextEntry,
  autoCapitalize,
  autoComplete,
  maxLength,
  style,
  testID,
}: TextFieldProps) {
  return (
    <View style={[styles.field, style]}>
      <FieldLabel label={label} optional={optional} />
      <TextInput
        testID={testID}
        accessibilityLabel={label}
        accessibilityHint={hint}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
        selectionColor={colors.accent}
        multiline={multiline}
        keyboardType={keyboardType}
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize}
        autoComplete={autoComplete}
        maxLength={maxLength}
        style={[
          styles.input,
          multiline ? styles.multiline : null,
          error ? styles.inputError : null,
        ]}
      />
      {error ? (
        <Text variant="caption" color={colors.danger} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" faint>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

/** Label-less search input with an inline icon; 48dp tall so it aligns with adjacent controls. */
export function SearchField({
  value,
  onChangeText,
  placeholder = 'Search',
  label = 'Search',
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  label?: string;
}) {
  return (
    <View style={styles.search}>
      <Ionicons name="search" size={16} color={colors.textFaint} />
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
        selectionColor={colors.accent}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        style={styles.searchInput}
      />
      {value ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          onPress={() => onChangeText('')}
          hitSlop={10}
        >
          <Ionicons name="close" size={16} color={colors.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

type NumberFieldProps = {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  unit?: string;
  placeholder?: string;
  decimal?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
};

/** Large numeric input tuned for gym use: big tabular digits, numeric keypad, unit suffix. */
export function NumberField({
  label,
  value,
  onChangeText,
  unit,
  placeholder,
  decimal = true,
  testID,
  style,
}: NumberFieldProps) {
  return (
    <View style={[styles.numberWrap, style]}>
      <Text variant="label" muted numberOfLines={1}>
        {label}
      </Text>
      <View style={styles.numberRow}>
        <TextInput
          testID={testID}
          accessibilityLabel={unit ? `${label} in ${unit}` : label}
          value={value}
          onChangeText={(t) =>
            onChangeText(t.replace(',', '.').replace(decimal ? /[^0-9.]/g : /[^0-9]/g, ''))
          }
          placeholder={placeholder ?? '–'}
          placeholderTextColor={colors.textFaint}
          selectionColor={colors.accent}
          keyboardType={decimal ? 'decimal-pad' : 'number-pad'}
          selectTextOnFocus
          style={styles.numberInput}
        />
        {unit ? (
          <Text variant="caption" faint>
            {unit}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

type StepperProps = {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  format?: (v: number) => string;
};

export function Stepper({
  label,
  value,
  onChange,
  min = 0,
  max = 999,
  step = 1,
  format,
}: StepperProps) {
  const dec = () => {
    haptics.select();
    onChange(Math.max(min, +(value - step).toFixed(2)));
  };
  const inc = () => {
    haptics.select();
    onChange(Math.min(max, +(value + step).toFixed(2)));
  };
  return (
    <View
      style={styles.stepper}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: format ? format(value) : String(value) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => (e.nativeEvent.actionName === 'increment' ? inc() : dec())}
    >
      <Text style={styles.flex} numberOfLines={2}>
        {label}
      </Text>
      <Pressable
        accessibilityLabel={`Decrease ${label}`}
        onPress={dec}
        disabled={value <= min}
        style={({ pressed }) => [styles.stepBtn, pressed ? styles.stepBtnPressed : null]}
      >
        <Ionicons name="remove" size={18} color={value <= min ? colors.textFaint : colors.text} />
      </Pressable>
      <Text variant="bodyStrong" style={styles.stepValue}>
        {format ? format(value) : value}
      </Text>
      <Pressable
        accessibilityLabel={`Increase ${label}`}
        onPress={inc}
        disabled={value >= max}
        style={({ pressed }) => [styles.stepBtn, pressed ? styles.stepBtnPressed : null]}
      >
        <Ionicons name="add" size={18} color={value >= max ? colors.textFaint : colors.text} />
      </Pressable>
    </View>
  );
}

type ChipOption<T extends string> = { value: T; label: string };

type ChipGroupProps<T extends string> = {
  options: ChipOption<T>[];
  selected: T[];
  onToggle: (value: T) => void;
  label?: string;
};

/** Selectable chips. Selected = ink fill + bold label (a luminance change, not just a hue). */
export function ChipGroup<T extends string>({
  options,
  selected,
  onToggle,
  label,
}: ChipGroupProps<T>) {
  return (
    <View style={styles.field}>
      {label ? <FieldLabel label={label} /> : null}
      <View style={styles.chips}>
        {options.map((o) => (
          <Chip
            key={o.value}
            on={selected.includes(o.value)}
            label={o.label}
            onPress={() => onToggle(o.value)}
          />
        ))}
      </View>
    </View>
  );
}

type SegmentedProps<T extends string> = {
  options: ChipOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  label?: string;
};

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: SegmentedProps<T>) {
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  const index = options.findIndex((o) => o.value === value);
  const itemWidth = width ? (width - SEGMENT_PAD * 2) / options.length : 0;
  const x = useRef(new Animated.Value(0)).current;
  const placed = useRef(false);
  useEffect(() => {
    if (index < 0 || !itemWidth) return;
    const to = index * itemWidth;
    // First placement jumps; later changes slide.
    if (!placed.current || reduced) {
      x.setValue(to);
      placed.current = true;
      return;
    }
    Animated.spring(x, { toValue: to, useNativeDriver: true, speed: 22, bounciness: 3 }).start();
  }, [index, itemWidth, reduced, x]);

  return (
    <View style={styles.field}>
      {label ? <FieldLabel label={label} /> : null}
      <View
        style={styles.segment}
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      >
        {index >= 0 && itemWidth ? (
          <Animated.View
            pointerEvents="none"
            style={[styles.segmentIndicator, { width: itemWidth, transform: [{ translateX: x }] }]}
          />
        ) : null}
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={o.label}
              onPress={() => {
                if (!on) haptics.select();
                onChange(o.value);
              }}
              style={styles.segmentItem}
            >
              <Text
                variant="caption"
                color={on ? colors.onInk : colors.textMuted}
                style={on ? styles.bold : null}
                adjustsFontSizeToFit
                minimumFontScale={0.75}
                numberOfLines={1}
              >
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function ToggleRow({
  label,
  description,
  value,
  onChange,
  disabled,
  divided,
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  /** Draw a bottom hairline so the toggle sits inside a hairline List. */
  divided?: boolean;
}) {
  return (
    <View style={[styles.toggleRow, divided ? styles.divided : null]}>
      <View style={styles.flex}>
        <Text>{label}</Text>
        {description ? (
          <Text variant="caption" muted>
            {description}
          </Text>
        ) : null}
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={(v) => {
          haptics.select();
          onChange(v);
        }}
        disabled={disabled}
        trackColor={{ true: colors.ink, false: colors.borderStrong }}
        thumbColor={value ? colors.bg : colors.textMuted}
        ios_backgroundColor={colors.borderStrong}
      />
    </View>
  );
}

const SEGMENT_PAD = 3;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  bold: { fontWeight: '600' },
  field: { gap: spacing.sm },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  input: {
    minHeight: 52,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    color: colors.text,
    paddingHorizontal: spacing.lg,
    fontFamily: fonts.regular,
    fontSize: 15,
  },
  inputError: { borderWidth: 1, borderColor: colors.danger },
  search: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: touchTarget,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 15,
    paddingVertical: 0,
  },
  multiline: { minHeight: 104, paddingTop: spacing.md, textAlignVertical: 'top' },
  numberWrap: {
    flex: 1,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
    gap: spacing.xxs,
  },
  numberRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs },
  numberInput: {
    flex: 1,
    color: colors.text,
    fontFamily: fonts.monoMedium,
    fontSize: 28,
    letterSpacing: -1,
    paddingVertical: spacing.xs,
    minHeight: 44,
  },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: touchTarget },
  stepBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnPressed: { backgroundColor: colors.surfacePressed },
  stepValue: { minWidth: 64, textAlign: 'center', fontVariant: ['tabular-nums'] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
  },
  chipOn: { backgroundColor: colors.ink },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: SEGMENT_PAD,
  },
  segmentItem: {
    flex: 1,
    minHeight: 38,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  segmentIndicator: {
    position: 'absolute',
    top: SEGMENT_PAD,
    bottom: SEGMENT_PAD,
    left: SEGMENT_PAD,
    borderRadius: radius.sm,
    backgroundColor: colors.ink,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 56,
    paddingVertical: spacing.sm,
  },
  divided: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
});
