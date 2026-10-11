import type { Disposition, SessionStatus, SessionType } from '../models/types';

/** Valid workout-session transitions (TRD §6). Terminal states have no outgoing transitions. */
export const SESSION_TRANSITIONS: Record<SessionStatus, readonly SessionStatus[]> = {
  planned: ['in_progress', 'rescheduled', 'missed', 'cancelled'],
  in_progress: ['completed_as_planned', 'completed_adapted', 'partially_completed', 'cancelled'],
  completed_as_planned: [],
  completed_adapted: [],
  partially_completed: [],
  rescheduled: [],
  missed: [],
  cancelled: [],
};

export function canTransition(from: SessionStatus, to: SessionStatus): boolean {
  return SESSION_TRANSITIONS[from].includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(from: SessionStatus, to: SessionStatus) {
    super(`A session cannot move from "${from}" to "${to}".`);
    this.name = 'InvalidTransitionError';
  }
}

export function assertTransition(from: SessionStatus, to: SessionStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

export const COMPLETED_STATUSES: readonly SessionStatus[] = [
  'completed_as_planned',
  'completed_adapted',
  'partially_completed',
];

export const isCompleted = (s: SessionStatus) => COMPLETED_STATUSES.includes(s);

export type CompletionItem = {
  disposition: Disposition;
  /** Planned working sets for this item (null = added during the session, no target). */
  targetSets: number | null;
  loggedWorkingSets: number;
};

/**
 * Derives the completion status from what was actually logged — never from the prescription.
 * - No working sets at all → null (the session cannot be "completed"; cancel it instead).
 * - Freeform sessions have no plan to deviate from → completed_as_planned.
 * - Any target not met → partially_completed.
 * - All targets met but the session was adapted (Adaptive Day, substitution, deferral) → completed_adapted.
 * - Otherwise → completed_as_planned.
 */
export function classifyCompletion(
  sessionType: SessionType,
  items: CompletionItem[],
): SessionStatus | null {
  const totalLogged = items.reduce((n, i) => n + i.loggedWorkingSets, 0);
  if (totalLogged === 0) return null;
  if (sessionType === 'freeform') return 'completed_as_planned';
  const targets = items.filter(
    (i) =>
      (i.disposition === 'included' || i.disposition === 'substituted') && i.targetSets !== null,
  );
  const allMet = targets.every((i) => i.loggedWorkingSets >= (i.targetSets ?? 0));
  if (!allMet) return 'partially_completed';
  const adapted = sessionType === 'adapted' || items.some((i) => i.disposition !== 'included');
  return adapted ? 'completed_adapted' : 'completed_as_planned';
}

export const STATUS_LABEL: Record<SessionStatus, string> = {
  planned: 'Planned',
  in_progress: 'In progress',
  completed_as_planned: 'Completed as planned',
  completed_adapted: 'Completed (adapted)',
  partially_completed: 'Partially completed',
  rescheduled: 'Rescheduled',
  missed: 'Missed',
  cancelled: 'Cancelled',
};
