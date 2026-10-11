import type { Profile } from '@/domain/models/types';
import { nowIso } from '@/utils/clock';

import type { SqlDb } from '../db';
import { getEntity, saveEntity, type SaveInput } from '../store';

/** The app holds exactly one profile row. */
export const PROFILE_ID = 'profile';

export type ProfileInput = Omit<SaveInput<Profile>, 'id'>;

export const EMPTY_PROFILE: ProfileInput = {
  display_name: null,
  goals: [],
  custom_goal: null,
  experience: null,
  training_history: null,
  height_cm: null,
  body_weight_kg: null,
  age: null,
  unit_system: 'metric',
  weekly_target: null,
  preferred_days: [],
  session_minutes: null,
  location: null,
  equipment: [],
  avoid_patterns: [],
  excluded_exercise_ids: [],
  limitations_note: null,
  onboarded_at: null,
};

export function getProfile(db: SqlDb): Promise<Profile | null> {
  return getEntity<Profile>(db, 'profile', PROFILE_ID);
}

export function saveProfile(db: SqlDb, input: ProfileInput): Promise<Profile> {
  return saveEntity<Profile>(db, 'profile', { ...input, id: PROFILE_ID });
}

export async function completeOnboarding(db: SqlDb, input: ProfileInput): Promise<Profile> {
  return saveProfile(db, { ...input, onboarded_at: input.onboarded_at ?? nowIso() });
}
