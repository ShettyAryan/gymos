import type {
  Equipment,
  LoggingType,
  MovementPattern,
  Muscle,
  Priority,
} from '../models/constants';
import type { DaySnapshot, Disposition, ExerciseTarget, PlannedExercise } from '../models/types';

import { estimateSessionMinutes } from './timeEstimate';

/**
 * Adaptive Day (FR-06 / TRD §7): deterministic proposal for adapting an approved programme day
 * to today's time, equipment and energy. Pure — never mutates the input snapshot.
 *
 * Disposition semantics:
 * - included    — done as planned (sets may be reduced for time/energy; rest is never reduced)
 * - substituted — done with an alternative exercise (equipment or exclusion)
 * - deferred    — not done today but still part of the plan (time or equipment); not forced into tomorrow
 * - removed     — dropped from today because it conflicts with an exclusion and has no suitable alternative
 */
export const ADAPTIVE_CONFIG = {
  version: 'adaptive-v1',
  minSessionMinutes: 10,
  /** When shortening for time, never go below this many working sets on a kept exercise. */
  minSetsWhenShortened: 2,
  /** Low energy: remove this many sets per exercise (not below minSetsWhenShortened). */
  lowEnergySetReduction: 1,
  priorityRank: { primary: 0, secondary: 1, accessory: 2 } as Record<Priority, number>,
} as const;

export type Energy = 'low' | 'normal' | 'high';
export type AdaptationReason = 'schedule' | 'equipment' | 'fatigue' | 'travel' | 'custom';

export type ExerciseMeta = {
  id: string;
  name: string;
  movement_pattern: MovementPattern;
  primary_muscles: Muscle[];
  equipment: Equipment[];
  logging_type: LoggingType;
  alternatives: string[];
  deleted_at?: string | null;
};

export type AdaptiveInput = {
  day: DaySnapshot;
  availableMinutes: number;
  equipment: Equipment[];
  energy: Energy | null;
  avoidPatterns: MovementPattern[];
  excludedExerciseIds: string[];
  exercises: Map<string, ExerciseMeta>;
};

export type ProposalItem = {
  order: number;
  programmeExerciseId: string;
  plannedExerciseId: string;
  plannedName: string;
  /** Exercise to perform today; null when deferred/removed. */
  exerciseId: string | null;
  exerciseName: string | null;
  disposition: Disposition;
  plannedSets: number;
  proposedSets: number;
  target: ExerciseTarget;
  reasons: string[];
};

export type AlternativeOption = {
  kind: 'full_session_later' | 'shorter' | 'minimal_equipment' | 'reschedule' | 'habit_action';
  label: string;
  description: string;
};

export type AdaptiveProposal = {
  ruleVersion: string;
  feasible: boolean;
  label: 'as_planned' | 'shortened' | 'adapted';
  title: string;
  items: ProposalItem[];
  estimatedMinutes: number;
  originalEstimatedMinutes: number;
  availableMinutes: number;
  confidence: 'approximate';
  rationale: string[];
  warnings: string[];
  infeasibleReason: string | null;
  alternatives: AlternativeOption[];
};

const isActive = (i: ProposalItem) =>
  i.disposition === 'included' || i.disposition === 'substituted';

function usable(meta: ExerciseMeta | undefined, input: AdaptiveInput): boolean {
  if (!meta || meta.deleted_at) return false;
  if (input.excludedExerciseIds.includes(meta.id)) return false;
  if (input.avoidPatterns.includes(meta.movement_pattern)) return false;
  return meta.equipment.every((e) => input.equipment.includes(e));
}

/** Deterministic substitute search: planned alternatives → library alternatives → same pattern & muscle. */
export function findSubstitute(
  planned: PlannedExercise,
  input: AdaptiveInput,
): ExerciseMeta | null {
  const original = input.exercises.get(planned.exerciseId);
  const candidates: string[] = [...planned.alternativeIds, ...(original?.alternatives ?? [])];
  for (const id of candidates) {
    if (id === planned.exerciseId) continue;
    const m = input.exercises.get(id);
    if (m && usable(m, input)) return m;
  }
  if (!original) return null;
  const pool = [...input.exercises.values()]
    .filter(
      (m) =>
        m.id !== original.id &&
        m.movement_pattern === original.movement_pattern &&
        m.primary_muscles.some((mu) => original.primary_muscles.includes(mu)) &&
        usable(m, input),
    )
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return pool[0] ?? null;
}

function targetOf(p: PlannedExercise, sets: number): ExerciseTarget {
  return {
    sets,
    repMin: p.repMin,
    repMax: p.repMax,
    restSeconds: p.restSeconds,
    targetRir: p.targetRir,
    priority: p.priority,
  };
}

function estimate(items: ProposalItem[], input: AdaptiveInput): number {
  return estimateSessionMinutes(
    items.filter(isActive).map((i) => ({
      sets: i.proposedSets,
      repMax: i.target.repMax,
      restSeconds: i.target.restSeconds,
      loggingType: input.exercises.get(i.exerciseId!)?.logging_type ?? 'weight_reps',
    })),
  );
}

export function proposeAdaptation(
  input: AdaptiveInput,
  config = ADAPTIVE_CONFIG,
): AdaptiveProposal {
  const day = input.day;
  const rationale: string[] = [];
  const warnings: string[] = [
    'Time estimates are approximate and include warm-up and transitions.',
  ];
  const planned = [...day.exercises].sort((a, b) => a.order - b.order);

  const originalEstimatedMinutes = estimateSessionMinutes(
    planned.map((p) => ({
      sets: p.sets,
      repMax: p.repMax,
      restSeconds: p.restSeconds,
      loggingType: input.exercises.get(p.exerciseId)?.logging_type ?? 'weight_reps',
    })),
  );

  // 1. Equipment / exclusion screening and substitution.
  const items: ProposalItem[] = planned.map((p) => {
    const meta = input.exercises.get(p.exerciseId);
    const base: ProposalItem = {
      order: p.order,
      programmeExerciseId: p.programmeExerciseId,
      plannedExerciseId: p.exerciseId,
      plannedName: p.exerciseName,
      exerciseId: p.exerciseId,
      exerciseName: p.exerciseName,
      disposition: 'included',
      plannedSets: p.sets,
      proposedSets: p.sets,
      target: targetOf(p, p.sets),
      reasons: [],
    };
    if (usable(meta, input)) return base;

    const excluded =
      !!meta &&
      (input.excludedExerciseIds.includes(meta.id) ||
        input.avoidPatterns.includes(meta.movement_pattern));
    const missing = meta ? meta.equipment.filter((e) => !input.equipment.includes(e)) : [];
    const sub = findSubstitute(p, input);
    if (sub) {
      return {
        ...base,
        exerciseId: sub.id,
        exerciseName: sub.name,
        disposition: 'substituted',
        reasons: [
          excluded
            ? `${p.exerciseName} is on your avoid list; using ${sub.name}.`
            : `${p.exerciseName} needs ${missing.join(', ') || 'unavailable equipment'}; using ${sub.name}.`,
        ],
      };
    }
    if (!meta || excluded) {
      return {
        ...base,
        exerciseId: null,
        exerciseName: null,
        disposition: 'removed',
        proposedSets: 0,
        reasons: [
          meta
            ? `${p.exerciseName} is on your avoid list and has no suitable alternative.`
            : 'Exercise is missing from your library.',
        ],
      };
    }
    return {
      ...base,
      exerciseId: null,
      exerciseName: null,
      disposition: 'deferred',
      proposedSets: 0,
      reasons: [
        `${p.exerciseName} needs ${missing.join(', ')}, which is not available today, and no alternative fits.`,
      ],
    };
  });

  // 2. Energy adjustment — volume only; rest and intensity guidance are unchanged.
  if (input.energy === 'low') {
    let reduced = false;
    for (const it of items) {
      if (!isActive(it)) continue;
      const next = Math.max(
        config.minSetsWhenShortened,
        it.proposedSets - config.lowEnergySetReduction,
      );
      if (next < it.proposedSets) {
        it.proposedSets = next;
        it.reasons.push('Low energy: one fewer set.');
        reduced = true;
      }
    }
    if (reduced)
      rationale.push('Low energy reported: volume reduced slightly; rest periods unchanged.');
  } else if (input.energy === 'high') {
    rationale.push('High energy reported: no extra volume added — the plan stays the plan.');
  }

  // 3. Fit to available time. Never shortens rest; drops/reduces lowest-priority, latest work first.
  const rank = (i: ProposalItem) => config.priorityRank[i.target.priority];
  const pickLast = (pred: (i: ProposalItem) => boolean) =>
    [...items].filter(pred).sort((a, b) => rank(b) - rank(a) || b.order - a.order)[0];
  let timeChanges = false;
  let guard = 200;
  while (estimate(items, input) > input.availableMinutes && guard-- > 0) {
    const accessory = pickLast((i) => isActive(i) && i.target.priority === 'accessory');
    if (accessory) {
      defer(accessory, `Deferred to fit ${input.availableMinutes} minutes (accessory work).`);
      continue;
    }
    const reducible = pickLast((i) => isActive(i) && i.proposedSets > config.minSetsWhenShortened);
    if (reducible) {
      reducible.proposedSets -= 1;
      reducible.reasons.push(
        `Fewer sets to fit ${input.availableMinutes} minutes (rest unchanged).`,
      );
      timeChanges = true;
      continue;
    }
    const secondary = pickLast((i) => isActive(i) && i.target.priority === 'secondary');
    if (secondary) {
      defer(secondary, `Deferred to fit ${input.availableMinutes} minutes.`);
      continue;
    }
    const primaries = items.filter((i) => isActive(i));
    if (primaries.length > 1) {
      defer(
        primaries.sort((a, b) => b.order - a.order)[0]!,
        `Deferred to fit ${input.availableMinutes} minutes.`,
      );
      continue;
    }
    break;
  }
  function defer(i: ProposalItem, reason: string) {
    i.disposition = 'deferred';
    i.proposedSets = 0;
    i.reasons.push(reason);
    timeChanges = true;
  }

  for (const it of items) it.target = { ...it.target, sets: it.proposedSets || it.plannedSets };

  const estimatedMinutes = estimate(items, input);
  const active = items.filter(isActive);
  const equipmentLimited = items.some(
    (i) =>
      i.disposition === 'substituted' ||
      (i.disposition === 'deferred' && /not available/.test(i.reasons.join(' '))),
  );

  const alternatives: AlternativeOption[] = [
    {
      kind: 'reschedule',
      label: 'Reschedule',
      description: `Move ${day.title} to another day. Nothing is lost.`,
    },
    {
      kind: 'habit_action',
      label: 'Habit action',
      description:
        'Plan your next session, prep your gear, or log a check-in. Counts as a habit action, not a workout.',
    },
  ];
  if (input.availableMinutes < originalEstimatedMinutes) {
    alternatives.unshift({
      kind: 'full_session_later',
      label: 'Full session later',
      description: `Do the full ${day.title} (~${originalEstimatedMinutes} min) when you have time.`,
    });
  }
  if (!equipmentLimited) {
    alternatives.push({
      kind: 'minimal_equipment',
      label: 'Minimal equipment',
      description: 'Re-run the proposal with bodyweight/minimal equipment.',
    });
  }

  let infeasibleReason: string | null = null;
  if (input.availableMinutes < config.minSessionMinutes) {
    infeasibleReason = `${input.availableMinutes} minutes is too short for a meaningful session from this plan.`;
  } else if (active.length === 0) {
    infeasibleReason =
      'None of the planned exercises (or their alternatives) can be done with today’s equipment and preferences.';
  } else if (estimatedMinutes > input.availableMinutes) {
    infeasibleReason = `Even the most important exercise needs about ${estimatedMinutes} minutes including warm-up; GymOS will not rush sets or cut rest to fit.`;
  }
  if (infeasibleReason) {
    return {
      ruleVersion: config.version,
      feasible: false,
      label: 'shortened',
      title: day.title,
      items: items.map((i) =>
        isActive(i)
          ? {
              ...i,
              disposition: 'deferred' as const,
              proposedSets: 0,
              exerciseId: null,
              exerciseName: null,
              reasons: [...i.reasons, 'No feasible session today.'],
            }
          : i,
      ),
      estimatedMinutes: 0,
      originalEstimatedMinutes,
      availableMinutes: input.availableMinutes,
      confidence: 'approximate',
      rationale,
      warnings,
      infeasibleReason,
      alternatives,
    };
  }

  const substituted = items.some((i) => i.disposition === 'substituted');
  const shortened =
    timeChanges ||
    items.some(
      (i) =>
        i.disposition === 'deferred' ||
        i.disposition === 'removed' ||
        i.proposedSets < i.plannedSets,
    );
  const label: AdaptiveProposal['label'] = shortened
    ? 'shortened'
    : substituted
      ? 'adapted'
      : 'as_planned';
  const title =
    label === 'shortened'
      ? `Shortened ${day.title}`
      : label === 'adapted'
        ? `Adapted ${day.title}`
        : day.title;
  if (timeChanges)
    rationale.push(
      `Kept the highest-priority work first to fit ${input.availableMinutes} minutes.`,
    );
  if (substituted)
    rationale.push(
      'Swapped exercises that need unavailable equipment for planned or similar alternatives.',
    );
  if (label === 'as_planned')
    rationale.push('The full planned session fits today — no changes needed.');

  return {
    ruleVersion: config.version,
    feasible: true,
    label,
    title,
    items,
    estimatedMinutes,
    originalEstimatedMinutes,
    availableMinutes: input.availableMinutes,
    confidence: 'approximate',
    rationale,
    warnings,
    infeasibleReason: null,
    alternatives,
  };
}
