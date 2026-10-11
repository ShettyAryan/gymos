import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import { Button, List, ListRow, Segmented, Text } from '@/components';
import { useMutation, useQuery } from '@/data/DatabaseProvider';
import {
  getRescheduleSlots,
  recordHabitAction,
  reschedulePlannedDay,
  skipPlannedDay,
} from '@/data/local/repositories/attendance';
import { spacing } from '@/theme/tokens';
import { formatDateKey } from '@/utils/dates';

const HABITS = ['Planned my next session', 'Prepared my gym gear', 'Did a recovery check-in'];
const SKIP_REASONS = [
  { value: 'illness', label: 'Unwell' },
  { value: 'travel', label: 'Travel' },
  { value: 'life', label: 'Life' },
  { value: 'schedule', label: 'Just skip' },
] as const;

/**
 * Non-shaming alternatives to training today (FR-07): reschedule, a habit action, or skip.
 * Every option is explicit and user-approved; nothing changes the programme.
 */
export function PlanAlternatives({
  date,
  dayId,
  dayTitle,
  versionId,
}: {
  date: string;
  dayId: string;
  dayTitle: string;
  versionId: string;
}) {
  const [mode, setMode] = useState<'reschedule' | 'habit' | 'skip' | null>(null);
  const [skipReason, setSkipReason] = useState<(typeof SKIP_REASONS)[number]['value']>('schedule');
  const slots = useQuery((db) => getRescheduleSlots(db, date), [date]);
  const reschedule = useMutation((db, to: string) =>
    reschedulePlannedDay(db, { date, plannedDayId: dayId, versionId, to }),
  );
  const habit = useMutation((db, action: string) =>
    recordHabitAction(db, { date, plannedDayId: dayId, versionId, action }),
  );
  const skip = useMutation((db) =>
    skipPlannedDay(db, { date, plannedDayId: dayId, versionId, reason: skipReason }),
  );

  const done = (title: string, msg: string) => {
    Alert.alert(title, msg);
    router.back();
  };

  return (
    <View style={{ gap: spacing.sm }}>
      <Segmented
        options={[
          { value: 'reschedule', label: 'Reschedule' },
          { value: 'habit', label: 'Habit action' },
          { value: 'skip', label: 'Skip' },
        ]}
        value={mode}
        onChange={setMode}
      />
      {mode === 'reschedule' ? (
        <View style={{ gap: spacing.sm }}>
          <Text variant="caption" muted>
            Move {dayTitle} to an upcoming rest day. Your streak is unaffected.
          </Text>
          <List>
            {(slots.data ?? []).map((d) => (
              <ListRow
                key={d}
                title={formatDateKey(d, { weekday: 'long', day: 'numeric', month: 'short' })}
                value="Move here"
                onPress={async () => {
                  await reschedule.run(d);
                  done('Rescheduled', `${dayTitle} moved to ${formatDateKey(d)}.`);
                }}
              />
            ))}
          </List>
          {slots.data?.length === 0 ? (
            <Text variant="caption" faint>
              No free days in the next week.
            </Text>
          ) : null}
        </View>
      ) : null}
      {mode === 'habit' ? (
        <View style={{ gap: spacing.sm }}>
          <Text variant="caption" muted>
            Keeps the routine alive. Recorded as a habit action — not a workout — with a small XP
            bonus.
          </Text>
          <List>
            {HABITS.map((h) => (
              <ListRow
                key={h}
                title={h}
                value="Record"
                onPress={async () => {
                  await habit.run(h);
                  done(
                    'Habit action recorded',
                    'Nice — consistency is built from small actions too.',
                  );
                }}
              />
            ))}
          </List>
        </View>
      ) : null}
      {mode === 'skip' ? (
        <View style={{ gap: spacing.sm }}>
          <Segmented
            options={SKIP_REASONS.map((r) => ({ ...r }))}
            value={skipReason}
            onChange={setSkipReason}
          />
          <Text variant="caption" faint>
            Being unwell, travelling or life events never break your streak.
          </Text>
          <Button
            label="Skip today"
            variant="secondary"
            onPress={async () => {
              await skip.run();
              done('Skipped', 'Rest well. Your plan continues as normal.');
            }}
          />
        </View>
      ) : null}
    </View>
  );
}
