import { z } from 'zod';

import type { LoggingType } from '../models/constants';

/** Plausibility limits for a logged set (canonical units). */
export const setValuesSchema = z.object({
  load_kg: z.number().min(0).max(1000).nullable(),
  reps: z.number().int().min(0).max(1000).nullable(),
  duration_seconds: z.number().int().min(0).max(86_400).nullable(),
  distance_m: z.number().min(0).max(1_000_000).nullable(),
  rpe: z.number().min(1).max(10).multipleOf(0.5).nullable(),
  rir: z.number().int().min(0).max(10).nullable(),
  is_warmup: z.boolean(),
  /** Omitted = a normal set. */
  set_kind: z.enum(['normal', 'drop']).optional(),
  notes: z.string().max(500).nullable(),
});

export type SetValues = z.infer<typeof setValuesSchema>;

/** Returns a user-facing error, or null when the set has the fields its logging type requires. */
export function validateSetValues(t: LoggingType, v: SetValues): string | null {
  const parsed = setValuesSchema.safeParse(v);
  if (!parsed.success) return parsed.error.issues[0]?.message ?? 'Invalid set values.';
  if (v.is_warmup && v.set_kind === 'drop')
    return 'A set can be a warm-up or a drop set, not both.';
  switch (t) {
    case 'weight_reps':
      if (v.load_kg === null) return 'Enter the load.';
      if (v.reps === null) return 'Enter the reps.';
      return null;
    case 'bodyweight_reps':
      return v.reps === null ? 'Enter the reps.' : null;
    case 'assisted_bodyweight':
      if (v.reps === null) return 'Enter the reps.';
      if (v.load_kg === null) return 'Enter the assistance (0 if none).';
      return null;
    case 'duration':
    case 'hold':
      return v.duration_seconds === null || v.duration_seconds === 0 ? 'Enter the duration.' : null;
    case 'distance':
      return v.distance_m === null || v.distance_m === 0 ? 'Enter the distance.' : null;
  }
}
