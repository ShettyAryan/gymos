import type { LoggingType } from '../models/constants';

/**
 * Deterministic progression engine (FR-05 / TRD §8). Versioned; every recommendation stores
 * the rule version that produced it. Conservative by default and never auto-applied.
 * Not medical advice; it does not infer technique quality.
 */
export const PROGRESSION_V1 = {
  version: 'progression-v1',
  /** Sets logged with fewer reps-in-reserve than this count as "too hard" (RIR 0 = failure). */
  minAcceptableRir: 1,
  /** RPE above this counts as "too hard". */
  maxAcceptableRpe: 9,
  /** Suggested load reduction when most sets fall below the rep range. */
  reduceFraction: 0.1,
  defaultIncrementKg: { weight_reps: 2.5, assisted_bodyweight: 5 } as Record<string, number>,
  /** Added time for timed holds when progressing within range. */
  durationStepSeconds: 5,
} as const;

export type ProgressionDecision =
  'increase_load' | 'increase_reps' | 'repeat_target' | 'reduce_or_review' | 'insufficient_data';

export type ProgressionSet = {
  id?: string;
  load_kg: number | null;
  reps: number | null;
  duration_seconds: number | null;
  distance_m: number | null;
  rpe: number | null;
  rir: number | null;
};

export type ProgressionInput = {
  loggingType: LoggingType;
  target: { sets: number; repMin: number; repMax: number };
  /** Working sets (no warm-ups) from the most recent comparable session, in order. */
  sets: ProgressionSet[];
  /** User reported something felt off (pain/discomfort/other) for this exercise. */
  issueFlagged: boolean;
  /** Smallest practical load step for this exercise, if known. */
  incrementKg: number | null;
};

export type ProgressionSuggestion = {
  loadKg: number | null;
  reps: number | null;
  durationSeconds: number | null;
};

export type ProgressionResult = {
  decision: ProgressionDecision;
  suggestion: ProgressionSuggestion;
  rationale: string;
  ruleVersion: string;
  basedOnSetIds: string[];
};

const roundTo = (v: number, step: number) => Math.round(v / step) * step;
const fmt = (kg: number) => `${+kg.toFixed(2)} kg`;

export function recommendProgression(
  input: ProgressionInput,
  config = PROGRESSION_V1,
): ProgressionResult {
  const { loggingType, target, sets } = input;
  const base = {
    ruleVersion: config.version,
    basedOnSetIds: sets.map((s) => s.id).filter((x): x is string => !!x),
  };
  const none: ProgressionSuggestion = { loadKg: null, reps: null, durationSeconds: null };

  if (sets.length === 0) {
    return {
      ...base,
      decision: 'insufficient_data',
      suggestion: none,
      rationale: 'No working sets logged last time — log a session to get a suggestion.',
    };
  }
  if (input.issueFlagged) {
    return {
      ...base,
      decision: 'reduce_or_review',
      suggestion: none,
      rationale:
        'You flagged that something felt off. Repeat at a comfortable load or pick an alternative. If you have pain, consider checking with a qualified professional before progressing.',
    };
  }

  const tooHard = sets.some(
    (s) =>
      (s.rir !== null && s.rir < config.minAcceptableRir) ||
      (s.rpe !== null && s.rpe > config.maxAcceptableRpe),
  );
  const effortKnown = sets.some((s) => s.rir !== null || s.rpe !== null);
  const effortNote = effortKnown
    ? ''
    : ' (no effort rating was logged, so this assumes the sets felt manageable)';

  if (loggingType === 'distance') {
    return {
      ...base,
      decision: 'insufficient_data',
      suggestion: none,
      rationale:
        'Distance work is not auto-progressed in this version. Keep your planned target or adjust it yourself.',
    };
  }

  if (loggingType === 'duration' || loggingType === 'hold') {
    if (sets.some((s) => s.duration_seconds === null)) {
      return {
        ...base,
        decision: 'insufficient_data',
        suggestion: none,
        rationale: 'Some sets are missing a duration.',
      };
    }
    const durations = sets.map((s) => s.duration_seconds!);
    const shortest = Math.min(...durations);
    if (sets.length < target.sets) {
      return {
        ...base,
        decision: 'repeat_target',
        suggestion: { ...none, durationSeconds: target.repMin },
        rationale: `You logged ${sets.length} of ${target.sets} sets. Repeat the target before progressing.`,
      };
    }
    if (shortest >= target.repMax) {
      return {
        ...base,
        decision: 'repeat_target',
        suggestion: { ...none, durationSeconds: target.repMax },
        rationale: `Every set reached ${target.repMax}s, the top of your range. Consider a harder variation (edit your programme to change it).`,
      };
    }
    if (shortest < target.repMin || tooHard) {
      return {
        ...base,
        decision: 'repeat_target',
        suggestion: { ...none, durationSeconds: target.repMin },
        rationale: tooHard
          ? 'Effort was very high — repeat the target before adding time.'
          : `Some holds were under ${target.repMin}s. Repeat the target.`,
      };
    }
    const next = Math.min(target.repMax, shortest + config.durationStepSeconds);
    return {
      ...base,
      decision: 'increase_reps',
      suggestion: { ...none, durationSeconds: next },
      rationale: `All sets were within ${target.repMin}–${target.repMax}s${effortNote}. Aim for ${next}s per set.`,
    };
  }

  // Rep-based: weight_reps, bodyweight_reps, assisted_bodyweight
  if (sets.some((s) => s.reps === null)) {
    return {
      ...base,
      decision: 'insufficient_data',
      suggestion: none,
      rationale: 'Some sets are missing reps.',
    };
  }
  const needsLoad = loggingType === 'weight_reps' || loggingType === 'assisted_bodyweight';
  if (needsLoad && sets.some((s) => s.load_kg === null)) {
    return {
      ...base,
      decision: 'insufficient_data',
      suggestion: none,
      rationale: 'Some sets are missing a load, so no suggestion was made.',
    };
  }

  const loads = sets.map((s) => s.load_kg ?? 0);
  // For assisted work less assistance is harder; the "working" set is the least-assisted one.
  const workingLoad =
    loggingType === 'assisted_bodyweight' ? Math.min(...loads) : Math.max(...loads);
  const working = sets.filter((s) => (s.load_kg ?? 0) === workingLoad);
  const repsAt = working.map((s) => s.reps!);
  const minReps = Math.min(...repsAt);
  const belowMin = repsAt.filter((r) => r < target.repMin).length;
  const loadLabel =
    loggingType === 'bodyweight_reps' && workingLoad === 0 ? 'bodyweight' : fmt(workingLoad);
  const inc = input.incrementKg ?? config.defaultIncrementKg[loggingType] ?? 2.5;
  const loadOrNull = needsLoad || workingLoad > 0 ? workingLoad : null;

  if (working.length < target.sets) {
    return {
      ...base,
      decision: 'repeat_target',
      suggestion: { loadKg: loadOrNull, reps: target.repMin, durationSeconds: null },
      rationale: `${working.length} of ${target.sets} prescribed sets were at ${loadLabel}. Complete all sets at this load before progressing.`,
    };
  }

  if (belowMin >= Math.ceil(working.length / 2)) {
    if (loggingType === 'weight_reps') {
      const reduced = Math.max(0, roundTo(workingLoad * (1 - config.reduceFraction), inc));
      return {
        ...base,
        decision: 'reduce_or_review',
        suggestion: { loadKg: reduced, reps: target.repMin, durationSeconds: null },
        rationale: `Most sets were below ${target.repMin} reps at ${loadLabel}. Consider ${fmt(reduced)} to work back into the ${target.repMin}–${target.repMax} range, or review recovery.`,
      };
    }
    if (loggingType === 'assisted_bodyweight') {
      return {
        ...base,
        decision: 'reduce_or_review',
        suggestion: { loadKg: workingLoad + inc, reps: target.repMin, durationSeconds: null },
        rationale: `Most sets were below ${target.repMin} reps. Consider a little more assistance (${fmt(workingLoad + inc)}).`,
      };
    }
    return {
      ...base,
      decision: 'reduce_or_review',
      suggestion: { loadKg: loadOrNull, reps: target.repMin, durationSeconds: null },
      rationale: `Most sets were below ${target.repMin} reps. Consider an easier variation or fewer reps until you are back in range.`,
    };
  }

  if (belowMin > 0) {
    return {
      ...base,
      decision: 'repeat_target',
      suggestion: { loadKg: loadOrNull, reps: target.repMin, durationSeconds: null },
      rationale: `Some sets fell short of ${target.repMin} reps. Repeat ${loadLabel} and aim for at least ${target.repMin} on every set.`,
    };
  }

  if (minReps >= target.repMax) {
    if (tooHard) {
      return {
        ...base,
        decision: 'repeat_target',
        suggestion: { loadKg: loadOrNull, reps: target.repMax, durationSeconds: null },
        rationale: `You reached ${target.repMax} reps on every set, but effort was very high. Repeat ${loadLabel} until it feels more manageable.`,
      };
    }
    if (loggingType === 'weight_reps' || (loggingType === 'bodyweight_reps' && workingLoad > 0)) {
      const next = +(workingLoad + inc).toFixed(2);
      return {
        ...base,
        decision: 'increase_load',
        suggestion: { loadKg: next, reps: target.repMin, durationSeconds: null },
        rationale: `All ${working.length} sets reached ${target.repMax} reps at ${loadLabel}${effortNote}. Try ${fmt(next)} for ${target.repMin}–${target.repMax} reps.`,
      };
    }
    if (loggingType === 'assisted_bodyweight') {
      const next = Math.max(0, workingLoad - inc);
      return {
        ...base,
        decision: 'increase_load',
        suggestion: { loadKg: next, reps: target.repMin, durationSeconds: null },
        rationale: `All sets reached ${target.repMax} reps${effortNote}. Try less assistance: ${fmt(next)}.`,
      };
    }
    return {
      ...base,
      decision: 'repeat_target',
      suggestion: { loadKg: null, reps: target.repMax, durationSeconds: null },
      rationale: `Every set reached ${target.repMax} reps, the top of your range. Consider added load or a harder variation (edit your programme to change it).`,
    };
  }

  if (tooHard) {
    return {
      ...base,
      decision: 'repeat_target',
      suggestion: { loadKg: loadOrNull, reps: minReps, durationSeconds: null },
      rationale: `You were within ${target.repMin}–${target.repMax} reps but effort was very high. Repeat ${loadLabel} before adding reps.`,
    };
  }
  const nextReps = Math.min(target.repMax, minReps + 1);
  return {
    ...base,
    decision: 'increase_reps',
    suggestion: { loadKg: loadOrNull, reps: nextReps, durationSeconds: null },
    rationale: `All sets were within ${target.repMin}–${target.repMax} reps at ${loadLabel}${effortNote}. Aim for ${nextReps}+ reps per set at the same load.`,
  };
}

export const DECISION_LABEL: Record<ProgressionDecision, string> = {
  increase_load: 'Increase load',
  increase_reps: 'Add reps',
  repeat_target: 'Repeat target',
  reduce_or_review: 'Reduce or review',
  insufficient_data: 'Not enough data',
};
