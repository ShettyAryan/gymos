import type { AttendanceEvent, AttendanceStatus } from '@/domain/models/types';
import {
  buildCalendar,
  computeStreak,
  rescheduleSlots,
  type AttendanceLite,
  type CalendarDay,
  type VersionWindow,
} from '@/domain/rules/schedule';
import { habitActionAward } from '@/domain/rules/xp';
import { now } from '@/utils/clock';
import { addDays, toDateKey, type DateKey } from '@/utils/dates';

import type { SqlDb } from '../db';
import { patchEntity, queryEntities, saveEntity } from '../store';

import { applyAwards } from './awards';
import { listAllApprovedVersions } from './programmes';

export const today = (): DateKey => toDateKey(now());

/** Every approved programme version as a schedule window effective from its local approval date. */
export async function getVersionWindows(db: SqlDb): Promise<VersionWindow[]> {
  const versions = await listAllApprovedVersions(db);
  return versions.map((v) => ({
    versionId: v.id,
    effectiveFrom: toDateKey(new Date(v.approved_at)),
    days: v.snapshot.days.map((d) => ({ id: d.id, title: d.title, weekday: d.weekday })),
  }));
}

export async function listAttendance(
  db: SqlDb,
  from?: DateKey,
  to?: DateKey,
): Promise<AttendanceEvent[]> {
  if (from && to) {
    return queryEntities<AttendanceEvent>(
      db,
      'attendance_event',
      'deleted_at IS NULL AND date BETWEEN ? AND ?',
      [from, to],
      'date',
    );
  }
  return queryEntities<AttendanceEvent>(db, 'attendance_event', 'deleted_at IS NULL', [], 'date');
}

const lite = (a: AttendanceEvent): AttendanceLite => ({
  date: a.date,
  planned_day_id: a.planned_day_id,
  status: a.status,
  reason: a.reason,
  rescheduled_to: a.rescheduled_to,
  related_session_id: a.related_session_id,
});

export async function getCalendar(
  db: SqlDb,
  from: DateKey,
  to: DateKey,
  todayKey = today(),
): Promise<CalendarDay[]> {
  const [windows, attendance] = await Promise.all([getVersionWindows(db), listAttendance(db)]);
  return buildCalendar({ from, to, today: todayKey, windows, attendance: attendance.map(lite) });
}

/** Streak across all history (from the first approved version). */
export async function getStreak(db: SqlDb, todayKey = today()) {
  const windows = await getVersionWindows(db);
  const attendance = (await listAttendance(db)).map(lite);
  // Start from the earliest plan or the earliest logged day (freeform-only users have no plan).
  const starts = [...windows.map((w) => w.effectiveFrom), ...attendance.map((a) => a.date)];
  if (starts.length === 0) return { current: 0, best: 0, currentStartedOn: null };
  const from = starts.reduce((m, d) => (d < m ? d : m));
  return computeStreak(
    buildCalendar({ from, to: addDays(todayKey, 0), today: todayKey, windows, attendance }),
  );
}

export async function findAttendance(
  db: SqlDb,
  date: DateKey,
  plannedDayId: string,
): Promise<AttendanceEvent | null> {
  const rows = await queryEntities<AttendanceEvent>(
    db,
    'attendance_event',
    'deleted_at IS NULL AND date = ? AND planned_day_id = ?',
    [date, plannedDayId],
  );
  return rows[0] ?? null;
}

/** Records the outcome of a planned occurrence (one row per date + planned day). */
export async function recordPlannedOutcome(
  db: SqlDb,
  input: {
    date: DateKey;
    plannedDayId: string;
    versionId: string | null;
    status: AttendanceStatus;
    reason?: string | null;
    note?: string | null;
    sessionId?: string | null;
    rescheduledTo?: DateKey | null;
  },
): Promise<AttendanceEvent> {
  return db.transaction(async (tx) => {
    const existing = await findAttendance(tx, input.date, input.plannedDayId);
    const fields = {
      status: input.status,
      reason: input.reason ?? null,
      note: input.note ?? null,
      related_session_id: input.sessionId ?? null,
      rescheduled_to: input.rescheduledTo ?? null,
      programme_version_id: input.versionId,
    };
    if (existing) return patchEntity<AttendanceEvent>(tx, 'attendance_event', existing.id, fields);
    return saveEntity<AttendanceEvent>(tx, 'attendance_event', {
      date: input.date,
      planned_day_id: input.plannedDayId,
      ...fields,
    });
  });
}

/**
 * User-approved reschedule: the original occurrence is marked rescheduled (neutral) and the
 * planned day appears on the new date. The programme itself is never modified.
 */
export async function reschedulePlannedDay(
  db: SqlDb,
  input: {
    date: DateKey;
    plannedDayId: string;
    versionId: string | null;
    to: DateKey;
    reason?: string | null;
  },
): Promise<AttendanceEvent> {
  if (input.to <= input.date) throw new Error('Pick a later date to reschedule to.');
  return recordPlannedOutcome(db, { ...input, status: 'rescheduled', rescheduledTo: input.to });
}

/** Skip a planned session. Excused reasons (illness, travel…) do not break the streak. */
export function skipPlannedDay(
  db: SqlDb,
  input: {
    date: DateKey;
    plannedDayId: string;
    versionId: string | null;
    reason: string | null;
    note?: string | null;
  },
) {
  return recordPlannedOutcome(db, { ...input, status: 'cancelled' });
}

export function confirmMissed(
  db: SqlDb,
  input: { date: DateKey; plannedDayId: string; versionId: string | null },
) {
  return recordPlannedOutcome(db, { ...input, status: 'missed' });
}

/**
 * Non-workout habit action (plan next session, prep gear, check-in). Clearly not a workout:
 * small fixed XP, neutral for streaks, never a completion.
 */
export async function recordHabitAction(
  db: SqlDb,
  input: { date: DateKey; plannedDayId: string | null; versionId: string | null; action: string },
): Promise<AttendanceEvent> {
  return db.transaction(async (tx) => {
    const ev = input.plannedDayId
      ? await recordPlannedOutcome(tx, {
          date: input.date,
          plannedDayId: input.plannedDayId,
          versionId: input.versionId,
          status: 'habit_action',
          note: input.action,
        })
      : await saveEntity<AttendanceEvent>(tx, 'attendance_event', {
          date: input.date,
          planned_day_id: null,
          programme_version_id: null,
          status: 'habit_action',
          reason: null,
          related_session_id: null,
          rescheduled_to: null,
          note: input.action,
        });
    await applyAwards(tx, [habitActionAward(ev.id, input.date)], []);
    return ev;
  });
}

export async function getRescheduleSlots(db: SqlDb, from: DateKey = today()): Promise<DateKey[]> {
  const [windows, attendance] = await Promise.all([getVersionWindows(db), listAttendance(db)]);
  return rescheduleSlots(from, windows, attendance.map(lite));
}
