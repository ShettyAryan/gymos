/**
 * Registry of locally persisted entity types: table name, column encodings and sync behaviour.
 * Adding a syncable table = add a migration + an entry here.
 */
export type EntityConfig = {
  table: string;
  json: string[];
  bool: string[];
  /** Whether mutations are queued in the sync outbox for cloud backup. */
  syncable: boolean;
  /** Columns never sent to the cloud (device-specific or private). */
  omitFromSync?: string[];
  /** Restore order when pulling from the cloud (lower first). */
  restoreOrder: number;
};

export const ENTITIES = {
  profile: {
    table: 'profile',
    json: ['goals', 'preferred_days', 'equipment', 'avoid_patterns', 'excluded_exercise_ids'],
    bool: [],
    syncable: true,
    restoreOrder: 0,
  },
  exercise: {
    table: 'exercise',
    json: ['primary_muscles', 'secondary_muscles', 'equipment', 'alternatives'],
    bool: ['is_custom'],
    syncable: true,
    restoreOrder: 0,
  },
  programme: {
    table: 'programme',
    json: [],
    bool: ['has_unapproved_changes'],
    syncable: true,
    restoreOrder: 1,
  },
  programme_day: { table: 'programme_day', json: [], bool: [], syncable: true, restoreOrder: 2 },
  programme_exercise: {
    table: 'programme_exercise',
    json: ['alternative_ids'],
    bool: [],
    syncable: true,
    restoreOrder: 3,
  },
  programme_version: {
    table: 'programme_version',
    json: ['snapshot'],
    bool: [],
    syncable: true,
    restoreOrder: 2,
  },
  workout_session: {
    table: 'workout_session',
    json: ['adaptation', 'original_plan_snapshot'],
    bool: [],
    syncable: true,
    restoreOrder: 4,
  },
  workout_exercise: {
    table: 'workout_exercise',
    json: ['target'],
    bool: ['issue_flag'],
    syncable: true,
    restoreOrder: 5,
  },
  workout_set: {
    table: 'workout_set',
    json: [],
    bool: ['is_warmup'],
    syncable: true,
    restoreOrder: 6,
  },
  personal_record: {
    table: 'personal_record',
    json: [],
    bool: [],
    syncable: true,
    restoreOrder: 7,
  },
  progression_recommendation: {
    table: 'progression_recommendation',
    json: ['suggestion'],
    bool: [],
    syncable: true,
    restoreOrder: 7,
  },
  attendance_event: {
    table: 'attendance_event',
    json: [],
    bool: [],
    syncable: true,
    restoreOrder: 7,
  },
  xp_event: { table: 'xp_event', json: [], bool: [], syncable: true, restoreOrder: 8 },
  badge_award: { table: 'badge_award', json: [], bool: [], syncable: true, restoreOrder: 8 },
  campaign: { table: 'campaign', json: [], bool: [], syncable: true, restoreOrder: 1 },
  campaign_milestone: {
    table: 'campaign_milestone',
    json: [],
    bool: [],
    syncable: true,
    restoreOrder: 2,
  },
  progress_entry: {
    table: 'progress_entry',
    json: ['measurements'],
    bool: [],
    syncable: true,
    restoreOrder: 1,
  },
  daily_checkin: { table: 'daily_checkin', json: [], bool: [], syncable: true, restoreOrder: 1 },
  progress_photo: {
    table: 'progress_photo',
    json: [],
    bool: [],
    syncable: true,
    // local_uri is device-specific; upload state is per-device. The binary lives in private storage.
    omitFromSync: ['local_uri', 'upload_status', 'upload_error'],
    restoreOrder: 2,
  },
  weekly_review: {
    table: 'weekly_review',
    json: ['facts', 'ai_narrative'],
    bool: [],
    syncable: true,
    restoreOrder: 1,
  },
  ai_consent: { table: 'ai_consent', json: [], bool: ['granted'], syncable: true, restoreOrder: 0 },
} satisfies Record<string, EntityConfig>;

export type EntityType = keyof typeof ENTITIES;

export const ENTITY_TYPES = Object.keys(ENTITIES) as EntityType[];

export function isEntityType(s: string): s is EntityType {
  return Object.prototype.hasOwnProperty.call(ENTITIES, s);
}
