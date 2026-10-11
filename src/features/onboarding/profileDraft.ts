import type { ProfileInput } from '@/data/local/repositories/profile';
import { EMPTY_PROFILE } from '@/data/local/repositories/profile';
import {
  LOCATION_EQUIPMENT,
  type Equipment,
  type Experience,
  type Goal,
  type Location,
  type MovementPattern,
} from '@/domain/models/constants';
import type { Profile } from '@/domain/models/types';
import {
  displayLength,
  displayLoad,
  parseIntSafe,
  parseLength,
  parseLoad,
  type UnitSystem,
} from '@/utils/units';

/** Form-friendly profile draft: numbers kept as strings in the user's display units. */
export type ProfileDraft = {
  display_name: string;
  goals: Goal[];
  custom_goal: string;
  experience: Experience | null;
  training_history: string;
  unit_system: UnitSystem;
  height: string;
  body_weight: string;
  age: string;
  weekly_target: number;
  preferred_days: number[];
  session_minutes: number;
  location: Location | null;
  equipment: Equipment[];
  avoid_patterns: MovementPattern[];
  limitations_note: string;
};

export function draftFromProfile(p: Profile | null): ProfileDraft {
  const u = p?.unit_system ?? 'metric';
  return {
    display_name: p?.display_name ?? '',
    goals: p?.goals ?? [],
    custom_goal: p?.custom_goal ?? '',
    experience: p?.experience ?? null,
    training_history: p?.training_history ?? '',
    unit_system: u,
    height: p?.height_cm ? String(displayLength(p.height_cm, u)) : '',
    body_weight: p?.body_weight_kg ? String(displayLoad(p.body_weight_kg, u)) : '',
    age: p?.age ? String(p.age) : '',
    weekly_target: p?.weekly_target ?? 3,
    preferred_days: p?.preferred_days ?? [],
    session_minutes: p?.session_minutes ?? 60,
    location: p?.location ?? null,
    equipment: p?.equipment ?? [],
    avoid_patterns: p?.avoid_patterns ?? [],
    limitations_note: p?.limitations_note ?? '',
  };
}

const blankToNull = (s: string) => (s.trim() === '' ? null : s.trim());

export function profileInputFromDraft(d: ProfileDraft, existing: Profile | null): ProfileInput {
  const equipment =
    d.location && d.location !== 'custom' ? LOCATION_EQUIPMENT[d.location] : d.equipment;
  return {
    ...EMPTY_PROFILE,
    excluded_exercise_ids: existing?.excluded_exercise_ids ?? [],
    onboarded_at: existing?.onboarded_at ?? null,
    display_name: blankToNull(d.display_name),
    goals: d.goals,
    custom_goal: d.goals.includes('custom') ? blankToNull(d.custom_goal) : null,
    experience: d.experience,
    training_history: blankToNull(d.training_history),
    unit_system: d.unit_system,
    height_cm: parseLength(d.height, d.unit_system),
    body_weight_kg: parseLoad(d.body_weight, d.unit_system),
    age: parseIntSafe(d.age),
    weekly_target: d.weekly_target,
    preferred_days: [...d.preferred_days].sort((a, b) => a - b),
    session_minutes: d.session_minutes,
    location: d.location,
    equipment,
    avoid_patterns: d.avoid_patterns,
    limitations_note: blankToNull(d.limitations_note),
  };
}

export type DraftErrors = Partial<
  Record<'goals' | 'experience' | 'location' | 'age' | 'height' | 'body_weight', string>
>;

/** Only the essentials are required; everything else is optional by design (FR-01). */
export function validateDraft(d: ProfileDraft, step?: 'goals' | 'body' | 'equipment'): DraftErrors {
  const e: DraftErrors = {};
  if ((!step || step === 'goals') && d.goals.length === 0) e.goals = 'Pick at least one goal.';
  if ((!step || step === 'goals') && !d.experience) e.experience = 'Pick your experience level.';
  if (!step || step === 'body') {
    const age = d.age.trim() === '' ? null : Number(d.age);
    if (age !== null && (!Number.isInteger(age) || age < 13 || age > 100))
      e.age = 'Enter a whole number between 13 and 100, or leave blank.';
    const h = d.height.trim() === '' ? null : parseLength(d.height, d.unit_system);
    if (d.height.trim() !== '' && (h === null || h < 100 || h > 250))
      e.height = 'That height looks out of range.';
    const w = d.body_weight.trim() === '' ? null : parseLoad(d.body_weight, d.unit_system);
    if (d.body_weight.trim() !== '' && (w === null || w < 30 || w > 300))
      e.body_weight = 'That weight looks out of range.';
  }
  if ((!step || step === 'equipment') && !d.location) e.location = 'Pick where you usually train.';
  return e;
}

/** Re-express numeric strings when the unit system changes so values are not silently reinterpreted. */
export function switchUnits(d: ProfileDraft, to: UnitSystem): ProfileDraft {
  if (d.unit_system === to) return d;
  const h = parseLength(d.height, d.unit_system);
  const w = parseLoad(d.body_weight, d.unit_system);
  return {
    ...d,
    unit_system: to,
    height: h === null ? '' : String(displayLength(h, to)),
    body_weight: w === null ? '' : String(displayLoad(w, to)),
  };
}
