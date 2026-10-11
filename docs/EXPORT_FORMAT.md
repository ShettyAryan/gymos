# GymOS export format (v1)

**Profile → Export or delete data → Export my data** produces one JSON file:

```json
{
  "format": "gymos-export",
  "formatVersion": 1,
  "exportedAt": "2026-10-11T09:30:00.000Z",
  "schemaVersion": 1,
  "units": { "load": "kg", "length": "cm", "distance": "m", "duration": "s",
             "timestamps": "UTC ISO-8601", "dates": "local YYYY-MM-DD" },
  "notes": "Progress photo image files are not embedded; see progress_photo for metadata.",
  "tables": {
    "profile": [ ... ],
    "exercise": [ ...custom exercises only... ],
    "programme": [ ... ], "programme_day": [ ... ], "programme_exercise": [ ... ],
    "programme_version": [ ...immutable approved snapshots... ],
    "workout_session": [ ... ], "workout_exercise": [ ... ], "workout_set": [ ... ],
    "personal_record": [ ... ], "progression_recommendation": [ ... ],
    "attendance_event": [ ... ], "xp_event": [ ... ], "badge_award": [ ... ],
    "campaign": [ ... ], "campaign_milestone": [ ... ],
    "progress_entry": [ ... ], "daily_checkin": [ ... ], "progress_photo": [ ... ],
    "weekly_review": [ ... ], "ai_consent": [ ... ], "ai_message": [ ... ]
  }
}
```

## Conventions
- Each row matches its SQLite table, defined in `src/data/local/migrations/001_initial.ts`.
- JSON columns are exported as JSON values rather than strings.
- Booleans are exported as `true`/`false`.
- Every record carries `id`, `created_at`, `updated_at` and `version`.
- `deleted_at` marks a tombstoned (deleted) record. Tombstones are included so the history is complete.
- Weights are in kilograms, lengths in centimetres, distances in metres and durations in seconds, whatever display units the user chose.
- `workout_session.original_plan_snapshot` is the immutable planned day. `workout_exercise.disposition` records what actually happened to each exercise: `included`, `substituted`, `deferred` or `removed`.
- Built-in exercises aren't exported, because they ship with the app and have stable IDs such as `back_squat`.
- Photo image files are not embedded. Copy them from the device, or download them from your private cloud backup.
