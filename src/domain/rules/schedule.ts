import { addDays, dateRange, weekdayOf, type DateKey } from '@/utils/dates';

import type { AttendanceStatus } from '../models/types';

/**
 * Schedule, calendar and streak rules (FR-08 / TRD §9). Pure and time-zone safe:
 * all inputs are local calendar date keys.
 */

export type VersionWindow = {
  versionId: string;
  /** Local date the version took effect (approval date). */
  effectiveFrom: DateKey;
  days: { id: string; title: string; weekday: number | null }[];
};

export type AttendanceLite = {
  date: DateKey;
  planned_day_id: string | null;
  status: AttendanceStatus;
  reason: string | null;
  rescheduled_to: DateKey | null;
  related_session_id: string | null;
};

export type OccurrenceOutcome =
  | 'completed_as_planned'
  | 'completed_adapted'
  | 'partially_completed'
  | 'rescheduled'
  | 'missed'
  | 'missed_unconfirmed'
  | 'cancelled'
  | 'excused'
  | 'habit_action'
  | 'pending'
  | 'upcoming';

export type Occurrence = {
  date: DateKey;
  dayId: string;
  title: string;
  versionId: string;
  /** Came from a user-approved reschedule rather than the weekly pattern. */
  rescheduledFrom: DateKey | null;
  outcome: OccurrenceOutcome;
  sessionId: string | null;
};

export type CalendarDay = {
  date: DateKey;
  occurrences: Occurrence[];
  /** No planned training: a planned rest day (never breaks a streak). */
  rest: boolean;
  /** Completed sessions not tied to a planned day. */
  extraSessions: number;
  habitAction: boolean;
};

/** Reasons that make a cancellation neutral for streaks (illness, travel… are not failures). */
export const EXCUSED_REASONS = ['illness', 'travel', 'injury_or_pain', 'life'] as const;

export function windowFor(date: DateKey, windows: VersionWindow[]): VersionWindow | null {
  let best: VersionWindow | null = null;
  for (const w of windows)
    if (w.effectiveFrom <= date && (!best || w.effectiveFrom >= best.effectiveFrom)) best = w;
  return best;
}

export function plannedDaysFor(date: DateKey, windows: VersionWindow[]) {
  const w = windowFor(date, windows);
  if (!w) return [];
  const wd = weekdayOf(date);
  return w.days.filter((d) => d.weekday === wd).map((d) => ({ ...d, versionId: w.versionId }));
}

const COMPLETION: AttendanceStatus[] = [
  'completed_as_planned',
  'completed_adapted',
  'partially_completed',
];

export function buildCalendar(params: {
  from: DateKey;
  to: DateKey;
  today: DateKey;
  windows: VersionWindow[];
  attendance: AttendanceLite[];
}): CalendarDay[] {
  const { from, to, today, windows, attendance } = params;
  const byKey = new Map<string, AttendanceLite>();
  for (const a of attendance) if (a.planned_day_id) byKey.set(`${a.date}|${a.planned_day_id}`, a);

  // Reschedules move an occurrence to a new date (possibly outside the window's weekday pattern).
  const movedIn = new Map<DateKey, { dayId: string; from: DateKey }[]>();
  for (const a of attendance) {
    if (a.status === 'rescheduled' && a.rescheduled_to && a.planned_day_id) {
      const list = movedIn.get(a.rescheduled_to) ?? [];
      list.push({ dayId: a.planned_day_id, from: a.date });
      movedIn.set(a.rescheduled_to, list);
    }
  }

  const outcomeFor = (
    date: DateKey,
    dayId: string,
  ): { outcome: OccurrenceOutcome; sessionId: string | null } => {
    const ev = byKey.get(`${date}|${dayId}`);
    if (ev) {
      if (COMPLETION.includes(ev.status))
        return { outcome: ev.status as OccurrenceOutcome, sessionId: ev.related_session_id };
      if (ev.status === 'cancelled') {
        const excused = !!ev.reason && (EXCUSED_REASONS as readonly string[]).includes(ev.reason);
        return { outcome: excused ? 'excused' : 'cancelled', sessionId: null };
      }
      if (ev.status === 'rescheduled' || ev.status === 'missed' || ev.status === 'habit_action') {
        return { outcome: ev.status, sessionId: null };
      }
    }
    if (date > today) return { outcome: 'upcoming', sessionId: null };
    if (date === today) return { outcome: 'pending', sessionId: null };
    return { outcome: 'missed_unconfirmed', sessionId: null };
  };

  return dateRange(from, to).map((date) => {
    const occurrences: Occurrence[] = plannedDaysFor(date, windows).map((d) => ({
      date,
      dayId: d.id,
      title: d.title,
      versionId: d.versionId,
      rescheduledFrom: null,
      ...outcomeFor(date, d.id),
    }));
    for (const m of movedIn.get(date) ?? []) {
      const w = windowFor(m.from, windows);
      const d = w?.days.find((x) => x.id === m.dayId);
      if (!d || !w) continue;
      if (occurrences.some((o) => o.dayId === m.dayId)) continue;
      occurrences.push({
        date,
        dayId: d.id,
        title: d.title,
        versionId: w.versionId,
        rescheduledFrom: m.from,
        ...outcomeFor(date, d.id),
      });
    }
    const dayEvents = attendance.filter((a) => a.date === date);
    return {
      date,
      occurrences,
      rest: occurrences.length === 0,
      extraSessions: dayEvents.filter((a) => a.status === 'extra').length,
      habitAction: dayEvents.some((a) => a.status === 'habit_action'),
    };
  });
}

/** Outcomes that extend a streak. Partial sessions count: showing up is the habit being built. */
const EXTENDS: OccurrenceOutcome[] = [
  'completed_as_planned',
  'completed_adapted',
  'partially_completed',
];
/** Outcomes that neither extend nor break a streak. */
const NEUTRAL: OccurrenceOutcome[] = [
  'rescheduled',
  'excused',
  'habit_action',
  'pending',
  'upcoming',
];

export type StreakResult = { current: number; best: number; currentStartedOn: DateKey | null };

/**
 * Session streak = consecutive planned sessions attended (newest backwards). Rest days are not
 * occurrences so they never break it; reschedules, excused cancellations and habit actions are
 * neutral; missed (confirmed or not) and unexcused cancellations end it.
 */
export function computeStreak(calendar: CalendarDay[]): StreakResult {
  const occ = calendar
    .flatMap((d) => d.occurrences)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let best = 0;
  let run = 0;
  let runStart: DateKey | null = null;
  for (const o of occ) {
    if (EXTENDS.includes(o.outcome)) {
      if (run === 0) runStart = o.date;
      run += 1;
      best = Math.max(best, run);
    } else if (!NEUTRAL.includes(o.outcome)) {
      run = 0;
      runStart = null;
    }
  }
  return { current: run, best, currentStartedOn: runStart };
}

export type WeekAdherence = {
  planned: number;
  attended: number;
  adapted: number;
  partial: number;
  missed: number;
  rest: number;
  extra: number;
};

export function weekAdherence(week: CalendarDay[]): WeekAdherence {
  const occ = week.flatMap((d) => d.occurrences).filter((o) => o.outcome !== 'rescheduled');
  return {
    planned: occ.length,
    attended: occ.filter((o) => EXTENDS.includes(o.outcome)).length,
    adapted: occ.filter((o) => o.outcome === 'completed_adapted').length,
    partial: occ.filter((o) => o.outcome === 'partially_completed').length,
    missed: occ.filter(
      (o) =>
        o.outcome === 'missed' || o.outcome === 'missed_unconfirmed' || o.outcome === 'cancelled',
    ).length,
    rest: week.filter((d) => d.rest).length,
    extra: week.reduce((n, d) => n + d.extraSessions, 0),
  };
}

/** Free (rest) days in the next `horizon` days — candidate slots for a user-approved reschedule. */
export function rescheduleSlots(
  from: DateKey,
  windows: VersionWindow[],
  attendance: AttendanceLite[],
  horizon = 7,
): DateKey[] {
  const cal = buildCalendar({
    from: addDays(from, 1),
    to: addDays(from, horizon),
    today: from,
    windows,
    attendance,
  });
  return cal.filter((d) => d.occurrences.length === 0).map((d) => d.date);
}

export const OUTCOME_LABEL: Record<OccurrenceOutcome, string> = {
  completed_as_planned: 'Completed as planned',
  completed_adapted: 'Completed (adapted)',
  partially_completed: 'Partially completed',
  rescheduled: 'Rescheduled',
  missed: 'Missed',
  missed_unconfirmed: 'Not logged',
  cancelled: 'Skipped',
  excused: 'Skipped (excused)',
  habit_action: 'Habit action',
  pending: 'Today',
  upcoming: 'Planned',
};
