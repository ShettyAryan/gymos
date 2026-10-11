import type { LoggingType } from '@/domain/models/constants';
import { estimateOneRepMax } from '@/domain/rules/prs';
import type { PerformanceEntry } from '@/data/local/repositories/workouts';

export type TrendPoint = { date: string; value: number };

/**
 * Per-session trend metric for an exercise, oldest first. Weighted lifts use the best e1RM
 * (labelled as an estimate); others use best reps / duration / distance. Volume is intentionally
 * not the headline metric (it is easy to inflate and is not rewarded).
 */
export function sessionTrend(
  history: PerformanceEntry[],
  t: LoggingType,
): { metric: string; points: TrendPoint[] } {
  const metric =
    t === 'weight_reps'
      ? 'Best estimated 1RM (estimate)'
      : t === 'duration' || t === 'hold'
        ? 'Longest set'
        : t === 'distance'
          ? 'Longest distance'
          : 'Best reps';
  const points: TrendPoint[] = [];
  for (const h of [...history].reverse()) {
    let best: number | null = null;
    for (const s of h.sets) {
      const v =
        t === 'weight_reps'
          ? s.load_kg !== null && s.reps !== null
            ? estimateOneRepMax(s.load_kg, s.reps)
            : null
          : t === 'duration' || t === 'hold'
            ? s.duration_seconds
            : t === 'distance'
              ? s.distance_m
              : s.reps;
      if (v !== null && (best === null || v > best)) best = v;
    }
    if (best !== null) points.push({ date: h.date, value: best });
  }
  return { metric, points };
}
