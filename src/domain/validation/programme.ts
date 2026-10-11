import { z } from 'zod';

import type { MovementPattern } from '../models/constants';
import type { Exercise, Programme, ProgrammeDay, ProgrammeExercise } from '../models/types';
import { estimateSessionMinutes } from '../rules/timeEstimate';

/** Safety/sanity limits for any programme, whether written manually or drafted by AI. */
export const PROGRAMME_LIMITS = {
  maxDays: 7,
  maxExercisesPerDay: 12,
  sets: { min: 1, max: 8 },
  reps: { min: 1, max: 100 },
  restSeconds: { min: 0, max: 600 },
  targetRir: { min: 0, max: 5 },
  intendedMinutes: { min: 10, max: 180 },
  /** Above this many working sets in one day we warn (not block) — volume is not rewarded. */
  highVolumeSetsPerDay: 28,
} as const;

const L = PROGRAMME_LIMITS;

export const prescriptionSchema = z
  .object({
    sets: z.number().int().min(L.sets.min).max(L.sets.max),
    rep_min: z.number().int().min(L.reps.min).max(L.reps.max),
    rep_max: z.number().int().min(L.reps.min).max(L.reps.max),
    rest_seconds: z.number().int().min(L.restSeconds.min).max(L.restSeconds.max),
    target_rir: z.number().int().min(L.targetRir.min).max(L.targetRir.max).nullable(),
  })
  .refine((p) => p.rep_min <= p.rep_max, {
    message: 'Minimum reps must not exceed maximum reps.',
    path: ['rep_min'],
  });

export type Issue = {
  level: 'error' | 'warning';
  message: string;
  dayId?: string;
  itemId?: string;
};

export type ProgrammeStructure = {
  programme: Pick<Programme, 'name'>;
  days: { day: ProgrammeDay; exercises: ProgrammeExercise[] }[];
};

/**
 * Validates a programme before approval. Errors block activation; warnings are shown to the user.
 * The same function validates AI drafts after they are converted to this structure.
 */
export function validateProgramme(
  s: ProgrammeStructure,
  exercises: Map<string, Exercise>,
  opts: { avoidPatterns?: MovementPattern[] } = {},
): Issue[] {
  const issues: Issue[] = [];
  if (!s.programme.name.trim())
    issues.push({ level: 'error', message: 'Give the programme a name.' });
  if (s.days.length === 0)
    issues.push({ level: 'error', message: 'Add at least one training day.' });
  if (s.days.length > L.maxDays)
    issues.push({ level: 'error', message: `At most ${L.maxDays} training days.` });

  const weekdays = new Map<number, string>();
  for (const { day, exercises: items } of s.days) {
    const label = day.title.trim() || `Day ${day.day_order + 1}`;
    if (!day.title.trim())
      issues.push({ level: 'error', message: 'Every day needs a title.', dayId: day.id });
    if (day.weekday !== null) {
      const clash = weekdays.get(day.weekday);
      if (clash) {
        issues.push({
          level: 'error',
          message: `"${label}" and "${clash}" are scheduled on the same weekday.`,
          dayId: day.id,
        });
      }
      weekdays.set(day.weekday, label);
    }
    if (
      day.intended_minutes < L.intendedMinutes.min ||
      day.intended_minutes > L.intendedMinutes.max
    ) {
      issues.push({
        level: 'error',
        message: `${label}: planned duration must be ${L.intendedMinutes.min}–${L.intendedMinutes.max} minutes.`,
        dayId: day.id,
      });
    }
    if (items.length === 0)
      issues.push({ level: 'error', message: `${label} has no exercises.`, dayId: day.id });
    if (items.length > L.maxExercisesPerDay) {
      issues.push({
        level: 'error',
        message: `${label}: at most ${L.maxExercisesPerDay} exercises per day.`,
        dayId: day.id,
      });
    }

    let totalSets = 0;
    const timed = [];
    for (const pe of items) {
      const ex = exercises.get(pe.exercise_id);
      if (!ex || ex.deleted_at) {
        issues.push({
          level: 'error',
          message: `${label}: an exercise no longer exists in your library.`,
          dayId: day.id,
          itemId: pe.id,
        });
        continue;
      }
      const parsed = prescriptionSchema.safeParse(pe);
      if (!parsed.success) {
        for (const iss of parsed.error.issues) {
          issues.push({
            level: 'error',
            message: `${label} · ${ex.name}: ${humanise(iss.path, iss.message)}`,
            dayId: day.id,
            itemId: pe.id,
          });
        }
      }
      if (opts.avoidPatterns?.includes(ex.movement_pattern)) {
        issues.push({
          level: 'warning',
          message: `${label} · ${ex.name} uses a movement pattern you chose to avoid.`,
          dayId: day.id,
          itemId: pe.id,
        });
      }
      for (const alt of pe.alternative_ids) {
        if (!exercises.has(alt)) {
          issues.push({
            level: 'warning',
            message: `${label} · ${ex.name}: an alternative exercise is missing and will be ignored.`,
            dayId: day.id,
            itemId: pe.id,
          });
        }
      }
      totalSets += pe.sets;
      timed.push({
        sets: pe.sets,
        repMax: pe.rep_max,
        restSeconds: pe.rest_seconds,
        loggingType: ex.logging_type,
      });
    }
    if (totalSets > L.highVolumeSetsPerDay) {
      issues.push({
        level: 'warning',
        message: `${label}: ${totalSets} working sets is a lot for one session. More volume is not always better.`,
        dayId: day.id,
      });
    }
    const est = estimateSessionMinutes(timed);
    if (est > day.intended_minutes + 10) {
      issues.push({
        level: 'warning',
        message: `${label}: estimated ~${est} min, longer than the planned ${day.intended_minutes} min.`,
        dayId: day.id,
      });
    }
  }
  return issues;
}

function humanise(path: PropertyKey[], message: string): string {
  const field = String(path[0] ?? '');
  const names: Record<string, string> = {
    sets: 'sets',
    rep_min: 'reps',
    rep_max: 'reps',
    rest_seconds: 'rest',
    target_rir: 'reps in reserve',
  };
  return names[field] ? `${names[field]} — ${message}` : message;
}

export const hasErrors = (issues: Issue[]) => issues.some((i) => i.level === 'error');
