/**
 * Initial schema. Conventions:
 * - ids are client-generated UUIDs (TEXT); seed exercises use stable slugs.
 * - timestamps are UTC ISO-8601 strings; `*_date` columns are local calendar dates (YYYY-MM-DD).
 * - loads are canonical kilograms, distances metres, durations seconds.
 * - syncable tables carry created_at / updated_at / version / deleted_at (tombstone).
 * - JSON columns hold immutable snapshots or low-query lists.
 */
const sync = `created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT`;

export const migration001 = `
CREATE TABLE app_setting (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE analytics_counter (
  key TEXT PRIMARY KEY NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  last_at TEXT NOT NULL
);

CREATE TABLE profile (
  id TEXT PRIMARY KEY NOT NULL,
  display_name TEXT,
  goals TEXT NOT NULL DEFAULT '[]',
  custom_goal TEXT,
  experience TEXT,
  training_history TEXT,
  height_cm REAL,
  body_weight_kg REAL,
  age INTEGER,
  unit_system TEXT NOT NULL DEFAULT 'metric' CHECK (unit_system IN ('metric','imperial')),
  weekly_target INTEGER,
  preferred_days TEXT NOT NULL DEFAULT '[]',
  session_minutes INTEGER,
  location TEXT,
  equipment TEXT NOT NULL DEFAULT '[]',
  avoid_patterns TEXT NOT NULL DEFAULT '[]',
  excluded_exercise_ids TEXT NOT NULL DEFAULT '[]',
  limitations_note TEXT,
  onboarded_at TEXT,
  ${sync}
);

CREATE TABLE exercise (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  movement_pattern TEXT NOT NULL,
  primary_muscles TEXT NOT NULL DEFAULT '[]',
  secondary_muscles TEXT NOT NULL DEFAULT '[]',
  equipment TEXT NOT NULL DEFAULT '[]',
  logging_type TEXT NOT NULL CHECK (logging_type IN ('weight_reps','bodyweight_reps','assisted_bodyweight','duration','distance','hold')),
  instructions TEXT NOT NULL DEFAULT '',
  default_rest_seconds INTEGER NOT NULL DEFAULT 90,
  alternatives TEXT NOT NULL DEFAULT '[]',
  caution TEXT,
  load_increment_kg REAL,
  is_custom INTEGER NOT NULL DEFAULT 0,
  ${sync}
);
CREATE INDEX idx_exercise_name ON exercise(name COLLATE NOCASE);

CREATE TABLE programme (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','active','archived')),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','ai')),
  goal TEXT,
  rationale TEXT,
  ai_model TEXT,
  ai_prompt_version TEXT,
  active_version_id TEXT,
  has_unapproved_changes INTEGER NOT NULL DEFAULT 1,
  ${sync}
);
CREATE UNIQUE INDEX idx_programme_one_active ON programme(status) WHERE status = 'active' AND deleted_at IS NULL;

CREATE TABLE programme_day (
  id TEXT PRIMARY KEY NOT NULL,
  programme_id TEXT NOT NULL,
  day_order INTEGER NOT NULL,
  title TEXT NOT NULL,
  weekday INTEGER CHECK (weekday BETWEEN 0 AND 6),
  intended_minutes INTEGER NOT NULL DEFAULT 60,
  focus TEXT,
  notes TEXT,
  ${sync}
);
CREATE INDEX idx_programme_day_programme ON programme_day(programme_id);

CREATE TABLE programme_exercise (
  id TEXT PRIMARY KEY NOT NULL,
  programme_day_id TEXT NOT NULL,
  exercise_id TEXT NOT NULL,
  ex_order INTEGER NOT NULL,
  sets INTEGER NOT NULL,
  rep_min INTEGER NOT NULL,
  rep_max INTEGER NOT NULL,
  rest_seconds INTEGER NOT NULL,
  target_rir INTEGER,
  priority TEXT NOT NULL DEFAULT 'secondary' CHECK (priority IN ('primary','secondary','accessory')),
  alternative_ids TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  ${sync}
);
CREATE INDEX idx_programme_exercise_day ON programme_exercise(programme_day_id);

CREATE TABLE programme_version (
  id TEXT PRIMARY KEY NOT NULL,
  programme_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  snapshot TEXT NOT NULL,
  change_summary TEXT,
  approved_at TEXT NOT NULL,
  ${sync},
  UNIQUE (programme_id, version_number)
);

CREATE TABLE workout_session (
  id TEXT PRIMARY KEY NOT NULL,
  programme_id TEXT,
  programme_version_id TEXT,
  planned_day_id TEXT,
  planned_date TEXT,
  session_date TEXT NOT NULL,
  session_type TEXT NOT NULL CHECK (session_type IN ('planned','adapted','freeform')),
  status TEXT NOT NULL CHECK (status IN ('planned','in_progress','completed_as_planned','completed_adapted','partially_completed','rescheduled','missed','cancelled')),
  title TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  paused_at TEXT,
  paused_seconds INTEGER NOT NULL DEFAULT 0,
  actual_duration_seconds INTEGER,
  adaptation_reason TEXT,
  adaptation TEXT,
  original_plan_snapshot TEXT,
  notes TEXT,
  ${sync}
);
CREATE UNIQUE INDEX idx_session_one_active ON workout_session(status) WHERE status = 'in_progress' AND deleted_at IS NULL;
CREATE INDEX idx_session_date ON workout_session(session_date);

CREATE TABLE workout_exercise (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL,
  exercise_id TEXT NOT NULL,
  source_programme_exercise_id TEXT,
  ex_order INTEGER NOT NULL,
  disposition TEXT NOT NULL CHECK (disposition IN ('included','substituted','deferred','removed')),
  substitution_reason TEXT,
  replaced_exercise_id TEXT,
  target TEXT,
  issue_flag INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  ${sync}
);
CREATE INDEX idx_workout_exercise_session ON workout_exercise(session_id);
CREATE INDEX idx_workout_exercise_exercise ON workout_exercise(exercise_id);

CREATE TABLE workout_set (
  id TEXT PRIMARY KEY NOT NULL,
  workout_exercise_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  exercise_id TEXT NOT NULL,
  set_order INTEGER NOT NULL,
  load_kg REAL,
  reps INTEGER,
  duration_seconds INTEGER,
  distance_m REAL,
  rpe REAL,
  rir INTEGER,
  is_warmup INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT NOT NULL,
  notes TEXT,
  ${sync}
);
CREATE INDEX idx_workout_set_we ON workout_set(workout_exercise_id);
CREATE INDEX idx_workout_set_exercise ON workout_set(exercise_id, completed_at);

CREATE TABLE personal_record (
  id TEXT PRIMARY KEY NOT NULL,
  exercise_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  set_id TEXT NOT NULL,
  record_type TEXT NOT NULL,
  value REAL NOT NULL,
  previous_value REAL,
  achieved_at TEXT NOT NULL,
  ${sync},
  UNIQUE (set_id, record_type)
);
CREATE INDEX idx_pr_exercise ON personal_record(exercise_id);

CREATE TABLE progression_recommendation (
  id TEXT PRIMARY KEY NOT NULL,
  exercise_id TEXT NOT NULL,
  workout_exercise_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  programme_exercise_id TEXT,
  rule_version TEXT NOT NULL,
  decision TEXT NOT NULL,
  suggestion TEXT NOT NULL,
  rationale TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','dismissed')),
  ${sync},
  UNIQUE (workout_exercise_id, rule_version)
);
CREATE INDEX idx_reco_exercise ON progression_recommendation(exercise_id, created_at);

CREATE TABLE attendance_event (
  id TEXT PRIMARY KEY NOT NULL,
  date TEXT NOT NULL,
  planned_day_id TEXT,
  programme_version_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('completed_as_planned','completed_adapted','partially_completed','rescheduled','missed','cancelled','habit_action','extra')),
  reason TEXT,
  related_session_id TEXT,
  rescheduled_to TEXT,
  note TEXT,
  ${sync}
);
CREATE INDEX idx_attendance_date ON attendance_event(date);

CREATE TABLE xp_event (
  id TEXT PRIMARY KEY NOT NULL,
  event_type TEXT NOT NULL,
  source_entity_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  amount INTEGER NOT NULL,
  rule_version TEXT NOT NULL,
  ${sync}
);

CREATE TABLE badge_award (
  id TEXT PRIMARY KEY NOT NULL,
  badge_key TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  source_entity_id TEXT,
  awarded_at TEXT NOT NULL,
  ${sync}
);

CREATE TABLE campaign (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  goal TEXT,
  start_date TEXT NOT NULL,
  target_date TEXT,
  status TEXT NOT NULL CHECK (status IN ('active','completed','archived')),
  ${sync}
);
CREATE UNIQUE INDEX idx_campaign_one_active ON campaign(status) WHERE status = 'active' AND deleted_at IS NULL;

CREATE TABLE campaign_milestone (
  id TEXT PRIMARY KEY NOT NULL,
  campaign_id TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'custom' CHECK (kind IN ('custom','photoshoot','body_weight','sessions')),
  target_value REAL,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
  completed_at TEXT,
  ${sync}
);

CREATE TABLE progress_entry (
  id TEXT PRIMARY KEY NOT NULL,
  date TEXT NOT NULL,
  body_weight_kg REAL,
  measurements TEXT NOT NULL DEFAULT '{}',
  notes TEXT,
  ${sync}
);
CREATE INDEX idx_progress_entry_date ON progress_entry(date);

CREATE TABLE daily_checkin (
  id TEXT PRIMARY KEY NOT NULL,
  date TEXT NOT NULL,
  protein_g REAL,
  water_ml REAL,
  sleep_hours REAL,
  sleep_quality INTEGER,
  energy INTEGER,
  soreness INTEGER,
  notes TEXT,
  ${sync}
);
CREATE UNIQUE INDEX idx_checkin_date ON daily_checkin(date) WHERE deleted_at IS NULL;

CREATE TABLE progress_photo (
  id TEXT PRIMARY KEY NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('front','side','back','other')),
  captured_at TEXT NOT NULL,
  local_uri TEXT,
  remote_path TEXT,
  upload_status TEXT NOT NULL DEFAULT 'local_only' CHECK (upload_status IN ('local_only','pending','uploading','uploaded','failed','pending_delete')),
  upload_error TEXT,
  campaign_id TEXT,
  notes TEXT,
  ${sync}
);

CREATE TABLE weekly_review (
  id TEXT PRIMARY KEY NOT NULL,
  week_start TEXT NOT NULL UNIQUE,
  facts TEXT NOT NULL,
  reflection TEXT,
  ai_narrative TEXT,
  ai_model TEXT,
  recorded_at TEXT NOT NULL,
  ${sync}
);

CREATE TABLE ai_consent (
  id TEXT PRIMARY KEY NOT NULL,
  granted INTEGER NOT NULL,
  policy_version TEXT NOT NULL,
  decided_at TEXT NOT NULL,
  ${sync}
);

CREATE TABLE ai_message (
  id TEXT PRIMARY KEY NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  task TEXT NOT NULL,
  content TEXT NOT NULL,
  model TEXT,
  prompt_version TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE sync_outbox (
  id TEXT PRIMARY KEY NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('upsert','delete')),
  payload TEXT NOT NULL,
  entity_version INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','in_flight','failed','conflict')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_outbox_state ON sync_outbox(state, created_at);
CREATE INDEX idx_outbox_entity ON sync_outbox(entity_type, entity_id);

CREATE TABLE sync_conflict (
  id TEXT PRIMARY KEY NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  local_payload TEXT NOT NULL,
  remote_payload TEXT,
  local_version INTEGER NOT NULL,
  remote_version INTEGER,
  detected_at TEXT NOT NULL,
  resolved_at TEXT,
  resolution TEXT
);
`;
