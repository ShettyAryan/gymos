import { Pressable, StyleSheet, View } from 'react-native';

import { fonts } from '@/theme/fonts';
import { colors, radius, spacing, toneColor, type StatusTone } from '@/theme/tokens';
import { addDays, formatDateKey, weekdayOf, type DateKey } from '@/utils/dates';
import { haptics } from '@/utils/haptics';

import { IconButton } from './Button';
import { Text } from './Text';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export const monthStart = (key: DateKey): DateKey => `${key.slice(0, 7)}-01`;

export function addMonths(key: DateKey, n: number): DateKey {
  const [y, m] = key.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/** Monday-first 6×7 grid of date keys for the month containing `month`; null = outside the month. */
export function monthGrid(month: DateKey): (DateKey | null)[][] {
  const first = monthStart(month);
  const lead = (weekdayOf(first) + 6) % 7; // Monday = 0
  const weeks: (DateKey | null)[][] = [];
  let cursor = addDays(first, -lead);
  for (let w = 0; w < 6; w++) {
    const row: (DateKey | null)[] = [];
    for (let d = 0; d < 7; d++) {
      row.push(cursor.slice(0, 7) === first.slice(0, 7) ? cursor : null);
      cursor = addDays(cursor, 1);
    }
    if (w < 4 || row.some(Boolean)) weeks.push(row);
  }
  return weeks.filter((r) => r.some(Boolean));
}

type Props = {
  month: DateKey;
  onMonthChange: (month: DateKey) => void;
  today: DateKey;
  selected?: DateKey | null;
  onSelect?: (day: DateKey) => void;
  /** Status dot under a day. */
  marks?: Map<DateKey, StatusTone>;
  minDate?: DateKey;
};

/**
 * The app's single calendar: used for the attendance calendar and for every date picker,
 * so dates look and behave the same everywhere (and identically on iOS and Android).
 */
export function MonthCalendar({
  month,
  onMonthChange,
  today,
  selected,
  onSelect,
  marks,
  minDate,
}: Props) {
  const grid = monthGrid(month);
  const title = formatDateKey(monthStart(month), { month: 'long', year: 'numeric' });
  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <IconButton
          icon="chevron-back"
          label="Previous month"
          onPress={() => onMonthChange(addMonths(month, -1))}
          color={colors.text}
        />
        <Text variant="bodyStrong" style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        <IconButton
          icon="chevron-forward"
          label="Next month"
          onPress={() => onMonthChange(addMonths(month, 1))}
          color={colors.text}
        />
      </View>
      <View style={styles.row}>
        {WEEKDAYS.map((d, i) => (
          <Text key={i} variant="label" faint style={styles.weekday}>
            {d}
          </Text>
        ))}
      </View>
      {grid.map((week, wi) => (
        <View key={wi} style={styles.row}>
          {week.map((day, di) => {
            if (!day) return <View key={di} style={styles.cell} />;
            const isToday = day === today;
            const isSelected = day === selected;
            const disabled = !!minDate && day < minDate;
            const mark = marks?.get(day);
            return (
              <Pressable
                key={day}
                disabled={disabled || !onSelect}
                onPress={() => {
                  haptics.select();
                  onSelect?.(day);
                }}
                accessibilityRole={onSelect ? 'button' : undefined}
                accessibilityState={{ selected: isSelected, disabled }}
                accessibilityLabel={`${formatDateKey(day, { weekday: 'long', day: 'numeric', month: 'long' })}${isToday ? ', today' : ''}`}
                style={styles.cell}
              >
                <View
                  style={[
                    styles.day,
                    isToday ? styles.today : null,
                    isSelected ? styles.selected : null,
                  ]}
                >
                  <Text
                    variant="caption"
                    color={
                      isSelected
                        ? colors.onInk
                        : disabled
                          ? colors.textFaint
                          : isToday
                            ? colors.accent
                            : colors.text
                    }
                    style={styles.num}
                  >
                    {Number(day.slice(8))}
                  </Text>
                </View>
                <View
                  style={[styles.dot, { backgroundColor: mark ? toneColor[mark] : 'transparent' }]}
                />
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  head: { flexDirection: 'row', alignItems: 'center', marginHorizontal: -12 },
  title: { flex: 1, textAlign: 'center' },
  row: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', paddingVertical: spacing.xs },
  cell: { flex: 1, alignItems: 'center', paddingVertical: 3, gap: 3 },
  day: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  today: { borderWidth: 1, borderColor: colors.accent },
  selected: { backgroundColor: colors.ink, borderColor: colors.ink },
  num: { fontFamily: fonts.monoMedium },
  dot: { width: 5, height: 5, borderRadius: 3 },
});
