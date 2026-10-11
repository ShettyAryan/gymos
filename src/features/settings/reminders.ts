import type { SqlDb } from '@/data/local/db';
import { getActiveProgramme } from '@/data/local/repositories/programmes';
import {
  getPreferences,
  getSetting,
  setSetting,
  updatePreferences,
} from '@/data/local/repositories/settings';

/**
 * Opt-in local reminders (FR-08): one gentle notification on each planned training weekday at the
 * chosen hour. Local only — no push provider, no server. Copy is supportive, never guilt-based.
 * The module is loaded lazily so Expo Go (which lacks remote push) never loads it unless the user
 * turns reminders on.
 */
const loadNotifications = () => import('expo-notifications');

export async function applyReminders(db: SqlDb): Promise<{ scheduled: number }> {
  const prefsFirst = await getPreferences(db);
  if (!prefsFirst.remindersEnabled && !(await hadReminders(db))) return { scheduled: 0 };
  const Notifications = await loadNotifications();
  await Notifications.cancelAllScheduledNotificationsAsync();
  const prefs = prefsFirst;
  if (!prefs.remindersEnabled) {
    await setSetting(db, 'reminders_scheduled', false);
    return { scheduled: 0 };
  }
  const active = await getActiveProgramme(db);
  const weekdays = [
    ...new Set(
      (active?.version.snapshot.days ?? [])
        .map((d) => d.weekday)
        .filter((w): w is number => w !== null),
    ),
  ];
  for (const wd of weekdays) {
    const title = active!.version.snapshot.days.find((d) => d.weekday === wd)?.title ?? 'Training';
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `${title} today`,
        body: 'Short on time? Adapt it — a shorter session still counts.',
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
        weekday: wd + 1,
        hour: prefs.reminderHour,
        minute: 0,
      },
    });
  }
  await setSetting(db, 'reminders_scheduled', weekdays.length > 0);
  return { scheduled: weekdays.length };
}

export async function setRemindersEnabled(
  db: SqlDb,
  enabled: boolean,
  hour?: number,
): Promise<{ ok: boolean; scheduled: number }> {
  if (enabled) {
    const Notifications = await loadNotifications();
    const perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) {
      await updatePreferences(db, { remindersEnabled: false });
      return { ok: false, scheduled: 0 };
    }
  }
  await updatePreferences(db, {
    remindersEnabled: enabled,
    ...(hour !== undefined ? { reminderHour: hour } : {}),
  });
  return { ok: true, scheduled: (await applyReminders(db)).scheduled };
}

/** Whether reminders were ever scheduled (so turning them off still cancels them). */
async function hadReminders(db: SqlDb): Promise<boolean> {
  return (await getSetting<boolean>(db, 'reminders_scheduled')) === true;
}
