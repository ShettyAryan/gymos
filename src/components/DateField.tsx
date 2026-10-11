import Ionicons from '@expo/vector-icons/Ionicons';
import DateTimePicker, {
  DateTimePickerAndroid,
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { colors, radius, spacing } from '@/theme/tokens';
import { now } from '@/utils/clock';
import { addDays, formatDateKey, isDateKey, toDateKey, type DateKey } from '@/utils/dates';
import { haptics } from '@/utils/haptics';

import { Reveal } from './motion';
import { Text } from './Text';

type Props = {
  label: string;
  value: string;
  onChange: (v: string) => void;
  optional?: boolean;
  /** Quick-pick offsets in days from today. */
  quick?: { label: string; days: number }[];
  error?: string | null;
  /** Earliest selectable date (defaults to today). */
  minimumDate?: DateKey;
};

const keyToDate = (k: DateKey) => {
  const [y, m, d] = k.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
};

/**
 * Tap-to-pick date field. Android opens the system date dialog; iOS shows an inline calendar.
 * Value stays a local date key (YYYY-MM-DD) so storage is unchanged.
 */
export function DateField({ label, value, onChange, optional, quick, error, minimumDate }: Props) {
  const today: DateKey = toDateKey(now());
  const [iosOpen, setIosOpen] = useState(false);
  const selected = isDateKey(value) ? value : null;
  const min = keyToDate(minimumDate ?? today);

  const apply = (e: DateTimePickerEvent, d?: Date) => {
    if (e.type === 'set' && d) {
      haptics.select();
      onChange(toDateKey(d));
    }
  };

  const open = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: selected ? keyToDate(selected) : min,
        mode: 'date',
        minimumDate: min,
        onChange: apply,
      });
    } else {
      setIosOpen((o) => !o);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.labelRow}>
        <Text variant="label" muted style={styles.flex}>
          {label}
        </Text>
        {optional ? (
          <Text variant="caption" faint>
            Optional
          </Text>
        ) : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selected ? formatDateKey(selected, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : 'not set'}. Tap to choose a date.`}
        onPress={open}
        style={({ pressed }) => [
          styles.field,
          pressed ? styles.pressed : null,
          error ? styles.error : null,
        ]}
      >
        <Ionicons
          name="calendar-outline"
          size={18}
          color={selected ? colors.text : colors.textFaint}
        />
        <Text
          style={styles.flex}
          color={selected ? colors.text : colors.textFaint}
          numberOfLines={1}
        >
          {selected
            ? formatDateKey(selected, {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })
            : 'Choose a date'}
        </Text>
        {selected ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Clear ${label}`}
            hitSlop={12}
            onPress={() => onChange('')}
          >
            <Ionicons name="close" size={18} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </Pressable>
      {error ? (
        <Text variant="caption" color={colors.danger}>
          {error}
        </Text>
      ) : null}

      {Platform.OS === 'ios' && iosOpen ? (
        <Reveal>
          <DateTimePicker
            value={selected ? keyToDate(selected) : min}
            mode="date"
            display="inline"
            minimumDate={min}
            themeVariant="dark"
            accentColor={colors.accent}
            onChange={(e, d) => {
              apply(e, d);
              setIosOpen(false);
            }}
          />
        </Reveal>
      ) : null}

      {quick?.length ? (
        <View style={styles.quick}>
          {quick.map((q) => {
            const k = addDays(today, q.days);
            const on = k === selected;
            return (
              <Pressable
                key={q.label}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${q.label} from today`}
                onPress={() => {
                  haptics.select();
                  onChange(k);
                }}
                style={[styles.chip, on ? styles.chipOn : null]}
              >
                <Text variant="caption" color={on ? colors.onInk : colors.text}>
                  {q.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  flex: { flex: 1 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 52,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
  },
  pressed: { backgroundColor: colors.surfacePressed },
  error: { borderWidth: 1, borderColor: colors.danger },
  quick: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
  },
  chipOn: { backgroundColor: colors.ink },
});
