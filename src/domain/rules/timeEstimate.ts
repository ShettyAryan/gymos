import type { LoggingType } from '../models/constants';

/**
 * Conservative session-time model (TRD §7). All values in seconds and configurable.
 * Rest periods are taken from the plan as-is; this model never shortens rest to fit a time box.
 */
export const TIME_MODEL = {
  version: 'time-v1',
  warmupSeconds: 6 * 60,
  transitionSeconds: 90,
  /** Working time per rep for rep-based sets (includes setup/unrack). */
  secondsPerRep: 4,
  setSetupSeconds: 15,
  /** Default work time for duration/hold/distance sets when no target is known. */
  timedSetSeconds: 60,
} as const;

export type TimedExercise = {
  sets: number;
  repMax: number;
  restSeconds: number;
  loggingType: LoggingType;
};

export function estimateSetWorkSeconds(e: Pick<TimedExercise, 'repMax' | 'loggingType'>): number {
  switch (e.loggingType) {
    case 'duration':
    case 'hold':
      // rep range is interpreted as seconds for timed work
      return Math.max(e.repMax, 10) + TIME_MODEL.setSetupSeconds;
    case 'distance':
      return TIME_MODEL.timedSetSeconds * 3;
    default:
      return e.repMax * TIME_MODEL.secondsPerRep + TIME_MODEL.setSetupSeconds;
  }
}

/** Work for every set + full planned rest between sets + one transition to the next exercise. */
export function estimateExerciseSeconds(e: TimedExercise): number {
  if (e.sets <= 0) return 0;
  return (
    e.sets * estimateSetWorkSeconds(e) + (e.sets - 1) * e.restSeconds + TIME_MODEL.transitionSeconds
  );
}

export function estimateSessionSeconds(exercises: TimedExercise[], includeWarmup = true): number {
  if (exercises.length === 0) return 0;
  const work = exercises.reduce((sum, e) => sum + estimateExerciseSeconds(e), 0);
  return work + (includeWarmup ? TIME_MODEL.warmupSeconds : 0);
}

/** Rounded up to the next 5 minutes — estimates are deliberately conservative. */
export function estimateSessionMinutes(exercises: TimedExercise[], includeWarmup = true): number {
  const s = estimateSessionSeconds(exercises, includeWarmup);
  return s === 0 ? 0 : Math.ceil(s / 300) * 5;
}
