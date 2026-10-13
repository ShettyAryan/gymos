/**
 * Drop sets, supersets and per-exercise finishing. Additive only: existing rows get safe defaults.
 * - workout_set.set_kind: 'normal' | 'drop' (a drop set continues the previous set at a lower load;
 *   it adds volume but does not count toward target sets, PRs or progression).
 * - superset_group: exercises sharing a group id are performed back to back (rest after the last).
 * - workout_exercise.finished_at: the user marked this exercise done for the session.
 */
export const migration002 = `
ALTER TABLE workout_set ADD COLUMN set_kind TEXT NOT NULL DEFAULT 'normal' CHECK (set_kind IN ('normal','drop'));
ALTER TABLE workout_exercise ADD COLUMN superset_group TEXT;
ALTER TABLE workout_exercise ADD COLUMN finished_at TEXT;
ALTER TABLE programme_exercise ADD COLUMN superset_group TEXT;
`;
