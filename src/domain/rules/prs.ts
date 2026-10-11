import type { LoggingType } from '../models/constants';

export type RecordType = 'max_load' | 'e1rm' | 'max_reps' | 'max_duration' | 'max_distance';

export const RECORD_LABEL: Record<RecordType, string> = {
  max_load: 'Heaviest load',
  e1rm: 'Best estimated 1RM (estimate)',
  max_reps: 'Most reps',
  max_duration: 'Longest duration',
  max_distance: 'Longest distance',
};

export type SetForRecords = {
  id: string;
  load_kg: number | null;
  reps: number | null;
  duration_seconds: number | null;
  distance_m: number | null;
  is_warmup: boolean;
};

/** Epley estimate, only used for 1–12 reps; always labelled as an estimate in the UI. */
export function estimateOneRepMax(loadKg: number, reps: number): number | null {
  if (loadKg <= 0 || reps < 1 || reps > 12) return null;
  return reps === 1 ? loadKg : loadKg * (1 + reps / 30);
}

export function recordTypesFor(t: LoggingType): RecordType[] {
  switch (t) {
    case 'weight_reps':
      return ['max_load', 'e1rm'];
    case 'bodyweight_reps':
    case 'assisted_bodyweight':
      return ['max_reps'];
    case 'duration':
    case 'hold':
      return ['max_duration'];
    case 'distance':
      return ['max_distance'];
  }
}

function valueOf(type: RecordType, s: SetForRecords): number | null {
  switch (type) {
    case 'max_load':
      return s.load_kg !== null && s.load_kg > 0 && (s.reps ?? 0) >= 1 ? s.load_kg : null;
    case 'e1rm':
      return s.load_kg !== null && s.reps !== null ? estimateOneRepMax(s.load_kg, s.reps) : null;
    case 'max_reps':
      return s.reps !== null && s.reps > 0 ? s.reps : null;
    case 'max_duration':
      return s.duration_seconds !== null && s.duration_seconds > 0 ? s.duration_seconds : null;
    case 'max_distance':
      return s.distance_m !== null && s.distance_m > 0 ? s.distance_m : null;
  }
}

/** Best value per record type across a set list (warm-ups excluded). */
export function bestValues(
  t: LoggingType,
  sets: SetForRecords[],
): Partial<Record<RecordType, { value: number; setId: string }>> {
  const out: Partial<Record<RecordType, { value: number; setId: string }>> = {};
  for (const type of recordTypesFor(t)) {
    for (const s of sets) {
      if (s.is_warmup) continue;
      const v = valueOf(type, s);
      if (v === null) continue;
      const cur = out[type];
      if (!cur || v > cur.value) out[type] = { value: v, setId: s.id };
    }
  }
  return out;
}

export type PrCandidate = {
  recordType: RecordType;
  value: number;
  previousValue: number;
  setId: string;
};

const EPSILON = 1e-6;

/**
 * Personal records for one exercise in one session vs. all prior history.
 * The first-ever performance is a baseline, not a PR. At most one PR per record type per session.
 */
export function detectPersonalRecords(
  loggingType: LoggingType,
  sessionSets: SetForRecords[],
  priorSets: SetForRecords[],
): PrCandidate[] {
  const prior = bestValues(loggingType, priorSets);
  const now = bestValues(loggingType, sessionSets);
  const out: PrCandidate[] = [];
  for (const type of recordTypesFor(loggingType)) {
    const p = prior[type];
    const n = now[type];
    if (!p || !n) continue;
    if (n.value > p.value + EPSILON)
      out.push({ recordType: type, value: n.value, previousValue: p.value, setId: n.setId });
  }
  return out;
}
