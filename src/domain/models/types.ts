import type { DateKey } from '@/utils/dates';
import type { UnitSystem } from '@/utils/units';

import type {
  Equipment,
  Experience,
  Goal,
  Location,
  LoggingType,
  MovementPattern,
  Muscle,
  Priority,
} from './constants';

export type SyncMeta = {
  created_at: string;
  updated_at: string;
  version: number;
  deleted_at: string | null;
};

export type Profile = SyncMeta & {
  id: string;
  display_name: string | null;
  goals: Goal[];
  custom_goal: string | null;
  experience: Experience | null;
  training_history: string | null;
  height_cm: number | null;
  body_weight_kg: number | null;
  age: number | null;
  unit_system: UnitSystem;
  weekly_target: number | null;
  preferred_days: number[];
  session_minutes: number | null;
  location: Location | null;
  equipment: Equipment[];
  avoid_patterns: MovementPattern[];
  excluded_exercise_ids: string[];
  limitations_note: string | null;
  onboarded_at: string | null;
};

export type Exercise = SyncMeta & {
  id: string;
  name: string;
  movement_pattern: MovementPattern;
  primary_muscles: Muscle[];
  secondary_muscles: Muscle[];
  /** Every listed item is required. Empty = no equipment. */
  equipment: Equipment[];
  logging_type: LoggingType;
  instructions: string;
  default_rest_seconds: number;
  alternatives: string[];
  caution: string | null;
  load_increment_kg: number | null;
  is_custom: boolean;
};

export type ProgrammeStatus = 'draft' | 'active' | 'archived';

export type Programme = SyncMeta & {
  id: string;
  name: string;
  status: ProgrammeStatus;
  source: 'manual' | 'ai';
  goal: string | null;
  rationale: string | null;
  ai_model: string | null;
  ai_prompt_version: string | null;
  active_version_id: string | null;
  has_unapproved_changes: boolean;
};

export type ProgrammeDay = SyncMeta & {
  id: string;
  programme_id: string;
  day_order: number;
  title: string;
  weekday: number | null;
  intended_minutes: number;
  focus: string | null;
  notes: string | null;
};

export type ProgrammeExercise = SyncMeta & {
  id: string;
  programme_day_id: string;
  exercise_id: string;
  ex_order: number;
  sets: number;
  rep_min: number;
  rep_max: number;
  rest_seconds: number;
  target_rir: number | null;
  priority: Priority;
  alternative_ids: string[];
  superset_group: string | null;
  notes: string | null;
};

/** Immutable, self-contained copy of an approved programme (stored as JSON). */
export type ProgrammeSnapshot = {
  programmeId: string;
  name: string;
  versionNumber: number;
  days: DaySnapshot[];
};

export type DaySnapshot = {
  id: string;
  title: string;
  dayOrder: number;
  weekday: number | null;
  intendedMinutes: number;
  focus: string | null;
  exercises: PlannedExercise[];
};

export type PlannedExercise = {
  programmeExerciseId: string;
  exerciseId: string;
  exerciseName: string;
  order: number;
  sets: number;
  repMin: number;
  repMax: number;
  restSeconds: number;
  targetRir: number | null;
  priority: Priority;
  alternativeIds: string[];
  notes: string | null;
  /** Absent in snapshots approved before supersets existed. */
  supersetGroup?: string | null;
};

export type ProgrammeVersion = SyncMeta & {
  id: string;
  programme_id: string;
  version_number: number;
  snapshot: ProgrammeSnapshot;
  change_summary: string | null;
  approved_at: string;
};

export type SessionType = 'planned' | 'adapted' | 'freeform';
export type SessionStatus =
  | 'planned'
  | 'in_progress'
  | 'completed_as_planned'
  | 'completed_adapted'
  | 'partially_completed'
  | 'rescheduled'
  | 'missed'
  | 'cancelled';

export type Disposition = 'included' | 'substituted' | 'deferred' | 'removed';

export type ExerciseTarget = {
  sets: number;
  repMin: number;
  repMax: number;
  restSeconds: number;
  targetRir: number | null;
  priority: Priority;
};

export type WorkoutSession = SyncMeta & {
  id: string;
  programme_id: string | null;
  programme_version_id: string | null;
  planned_day_id: string | null;
  planned_date: DateKey | null;
  session_date: DateKey;
  session_type: SessionType;
  status: SessionStatus;
  title: string;
  started_at: string | null;
  completed_at: string | null;
  paused_at: string | null;
  paused_seconds: number;
  actual_duration_seconds: number | null;
  adaptation_reason: string | null;
  adaptation: unknown | null;
  original_plan_snapshot: DaySnapshot | null;
  notes: string | null;
};

export type WorkoutExercise = SyncMeta & {
  id: string;
  session_id: string;
  exercise_id: string;
  source_programme_exercise_id: string | null;
  ex_order: number;
  disposition: Disposition;
  substitution_reason: string | null;
  replaced_exercise_id: string | null;
  target: ExerciseTarget | null;
  issue_flag: boolean;
  notes: string | null;
  superset_group: string | null;
  finished_at: string | null;
};

export type SetKind = 'normal' | 'drop';

/** Sets that count toward targets, PRs and progression (not warm-ups, not drop sets). */
export const isTargetSet = (s: { is_warmup: boolean; set_kind?: SetKind | null }) =>
  !s.is_warmup && s.set_kind !== 'drop';

export type WorkoutSet = SyncMeta & {
  id: string;
  workout_exercise_id: string;
  session_id: string;
  exercise_id: string;
  set_order: number;
  load_kg: number | null;
  reps: number | null;
  duration_seconds: number | null;
  distance_m: number | null;
  rpe: number | null;
  rir: number | null;
  is_warmup: boolean;
  /** 'drop' continues the previous set at a lower load: volume only, not a target set. */
  set_kind: SetKind;
  completed_at: string;
  notes: string | null;
};

export type AttendanceStatus =
  | 'completed_as_planned'
  | 'completed_adapted'
  | 'partially_completed'
  | 'rescheduled'
  | 'missed'
  | 'cancelled'
  | 'habit_action'
  | 'extra';

export type AttendanceEvent = SyncMeta & {
  id: string;
  date: DateKey;
  planned_day_id: string | null;
  programme_version_id: string | null;
  status: AttendanceStatus;
  reason: string | null;
  related_session_id: string | null;
  rescheduled_to: DateKey | null;
  note: string | null;
};
