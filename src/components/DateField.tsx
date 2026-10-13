import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { colors, radius, spacing } from '@/theme/tokens';
import { now } from '@/utils/clock';
import { addDays, formatDateKey, isDateKey, toDateKey, type DateKey } from '@/utils/dates';
import { haptics } from '@/utils/haptics';

import { Button } from './Button';
import { MonthCalendar, monthStart } from './MonthCalendar';
import { Sheet } from './Sheet';
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

/**
 * Tap-to-pick date field. Opens the app's own month calendar in a bottom sheet, so picking a date
 * looks identical on iOS and Android and matches the attendance calendar.
 * Value stays a local date key (YYYY-MM-DD).
 */
export function DateField({ label, value, onChange, optional, quick, error, minimumDate }: Props) {
  const today: DateKey = toDateKey(now());
  const selected = isDateKey(value) ? value : null;
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(monthStart(selected ?? today));
  const [draft, setDraft] = useState<DateKey | null>(selected);

  const openPicker = () => {
    setDraft(selected);
    setMonth(monthStart(selected ?? today));
    setOpen(true);
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
        onPress={openPicker}
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

      <Sheet visible={open} onClose={() => setOpen(false)} title={label}>
        <MonthCalendar
          month={month}
          onMonthChange={setMonth}
          today={today}
          selected={draft}
          onSelect={setDraft}
          minDate={minimumDate ?? today}
        />
        <View style={styles.actions}>
          <Button label="Cancel" variant="secondary" grow onPress={() => setOpen(false)} />
          <Button
            label="Done"
            grow
            disabled={!draft}
            onPress={() => {
              if (draft) onChange(draft);
              setOpen(false);
            }}
          />
        </View>
      </Sheet>
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
  actions: { flexDirection: 'row', gap: spacing.sm },
});
