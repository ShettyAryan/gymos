# GymOS --- Technical Requirements Document (TRD)

**Version:** 1.0\
**Status:** Proposed implementation baseline\
**Primary implementation agent:** Claude Code\
**Requirement:** Free-first development and runtime; core functionality
must not depend on paid APIs.

## 1. Architecture summary

Use a single React Native / Expo / TypeScript application with a
local-first domain layer. Remote services are optional for core use and
support cloud backup, auth, and AI.

**Proposed stack** - Mobile: React Native + Expo + TypeScript. -
Navigation: Expo Router. - UI: React Native primitives with a small
project-owned design system; avoid paid UI kits. - Local database:
SQLite through Expo SQLite, with schema migrations. - Local secure
secrets: Expo SecureStore for session/token material where appropriate;
do not store app-wide API keys in the client. - State: lightweight typed
state (e.g., Zustand) only for transient UI state; database is source of
truth for persisted records. - Forms/validation: React Hook Form + Zod,
or equivalent free/open-source packages. - Charts: a maintained
free/open-source React Native charting library; isolate it behind a
component so it can be replaced. - Backend: Supabase Free (Postgres,
Auth, Storage, Edge Functions) for initial personal use, subject to
current quotas and service terms. - Cloud API: Supabase Edge Function as
an authenticated AI proxy; secret stored in Supabase function secrets,
never in mobile bundle. - AI: Groq API Free plan via its
OpenAI-compatible endpoint, with an ordered chain of free-tier models
(primary, light, backup) configurable through Edge Function secrets.
Confirm currently available models and rate limits during
implementation (see section 12). - Tests: Jest or Vitest
where compatible, React Native Testing Library, and Playwright only if a
web surface is added. - Lint/format/typecheck: ESLint, Prettier,
TypeScript strict mode. - Version control: Git. - CI: GitHub Actions
free allowance or local scripts; no paid CI requirement. - Build: Expo
local development and local Android build where feasible; EAS free quota
is optional, not a hard dependency. - No analytics, crash reporting,
email, SMS, maps, or push provider should be required for core MVP.
Local notifications can be used if supported.

**Free-first caveats** - Free tiers have quotas and terms that can
change. Add a `docs/FREE_TIER_LIMITS.md` and verify current limits
before release. - Supabase Free is suitable for prototype/personal use,
not a guaranteed production SLA; free projects may have inactivity/usage
constraints. Keep export and local data. - Groq is a third-party
processor. Its documentation states that inference data is not retained
by default, with limited retention for some features and logs, and a
Zero Data Retention option in its Data Controls settings; terms can
change, so re-verify before release. Do not send personal fitness
context until the user explicitly opts in; never send photos or
identifiers by default. - Groq free-plan limits are per model and apply
to the whole Groq organisation, so every GymOS user shares one quota.
Per-user caps and a global circuit breaker are mandatory. - App store publishing may require paid
developer accounts/fees. The stack can be developed/tested without those
fees, but public store distribution is not guaranteed to be free. - Do
not add a credit card, paid plan, or billable API automatically. Do not
enable paid fallback models.

## 2. System boundaries

### Local-first mobile application

Owns: - User interface and local database. - Workout logging and active
session recovery. - Progression rules and Adaptive Day generation. -
XP/achievement rules. - Offline event queue and sync status. - Local
analytics and export generation. - Validation of all remote AI outputs.

### Supabase backend

Owns: - Authentication and user-scoped cloud records. - Cloud
backup/synchronisation endpoints and row-level security. - Private photo
object storage. - Edge Function that proxies AI requests and enforces
opt-in/rate limits. - Optional server-side validation and audit
metadata.

### Groq API

Owns: - Draft programme text/structured suggestions. - On-demand
coaching explanations and weekly-review narrative. - Optional candidate
alternatives for user review. It does **not** own canonical workout
records, XP, progression calculations, scheduling, or direct database
access.

## 3. Core engineering principles

1.  Local database is the immediate source of truth for user actions.
2.  Persist user mutations before showing a success state.
3.  Core workout loop must work offline and without AI.
4.  Treat all AI output and remote data as untrusted.
5.  Use stable IDs generated on client for offline-created entities.
6.  Use idempotency keys for sync and achievement awards.
7.  Store timestamps in UTC; render in device-local time.
8.  Store weights/distances as canonical numeric values with unit
    metadata; avoid locale-formatted strings as stored values.
9.  Use database migrations; never rely on destructive schema reset in
    normal development.
10. Keep business rules in pure functions, independent of UI and
    network.
11. Preserve historical snapshots/version references.
12. No secrets in source code, app bundle, logs, screenshots, or
    repository history.

## 4. Proposed repository structure

``` text
gymos/
  app/                         # Expo Router screens/routes
  src/
    components/                # Shared UI components
    features/
      onboarding/
      programme/
      exercises/
      workout/
      adaptive-day/
      progression/
      attendance/
      progress/
      photos/
      campaign/
      nutrition/
      coach/
      settings/
    domain/
      models/
      rules/
      services/
      validation/
    data/
      local/
        database.ts
        migrations/
        repositories/
      remote/
        supabaseClient.ts
        repositories/
        sync/
    state/                     # Transient UI state only
    theme/
    utils/
  supabase/
    migrations/
    functions/
      ai-coach/
      sync/                    # Add only if needed; avoid unnecessary server complexity
  tests/
    unit/
    integration/
  docs/
    PRD.md
    TRD.md
    CLAUDE_CODE_PROMPT.md
    FREE_TIER_LIMITS.md
  .env.example
  app.json
  package.json
  README.md
```

Adapt this structure if a package version or Expo convention requires
it, but preserve separation of domain rules, local persistence, remote
services, and UI.

## 5. Domain model

Use UUIDs or another collision-resistant stable client-generated ID.
Every cloud-owned record must include `user_id`; enforce access with
row-level security.

### Entities (minimum)

-   `profile`: goals, units, experience, equipment, availability,
    preferred session length, optional profile attributes.
-   `programme`: id, name, status, version, created_at, updated_at.
-   `programme_day`: id, programme_id, weekday/order, title, intended
    duration.
-   `programme_exercise`: id, programme_day_id, exercise_id, order,
    sets, rep_min, rep_max, rest_seconds, optional effort target, notes,
    version.
-   `exercise`: id, name, movement pattern, muscle groups, equipment,
    logging type, instructions, alternatives, is_custom.
-   `workout_session`: id, planned_day_id nullable, programme_version,
    status, session_type (`planned`, `adapted`, `freeform`), started_at,
    completed_at, actual_duration_seconds, adaptation_reason,
    original_plan_snapshot JSON, notes, sync metadata.
-   `workout_exercise`: id, session_id, exercise_id,
    source_programme_exercise_id nullable, order, disposition
    (`included`, `substituted`, `deferred`, `removed`),
    substitution_reason.
-   `workout_set`: id, workout_exercise_id, set_order, load_value
    nullable, reps nullable, duration_seconds nullable, distance_value
    nullable, rpe nullable, rir nullable, completed_at, notes.
-   `attendance_event`: id, planned_day_id nullable, date, status,
    reason, related_session_id nullable.
-   `progress_entry`: id, date, body_weight nullable, measurements JSON
    or normalized child table, energy/sleep/soreness optional.
-   `progress_photo`: id, category, captured_at, local_uri, remote_path
    nullable, upload_status, notes. Never put a public URL in the
    record.
-   `campaign`: id, name, goal, start_date, target_date nullable,
    status.
-   `campaign_milestone`: id, campaign_id, title, target_value nullable,
    due_date nullable, status.
-   `xp_event`: id, event_type, source_entity_id, idempotency_key unique
    per user, amount, created_at.
-   `badge_award`: id, badge_key, idempotency_key unique per user,
    awarded_at.
-   `sync_outbox`: id, entity_type, entity_id, operation,
    payload/version metadata, created_at, attempt_count, last_error,
    state.
-   `ai_consent`: consent state, timestamp, terms/policy version.
-   `ai_conversation`: optional, minimal retention; store only if user
    expects history. Allow delete.

Prefer normalised tables for frequently queried data; JSON may be used
for immutable snapshots or low-query metadata. Avoid duplicating
canonical values across multiple stores without a clear ownership rule.

## 6. Workout state machine and integrity

Valid transitions: - `planned` → `in_progress`, `rescheduled`, `missed`,
`cancelled` - `in_progress` → `completed_as_planned`,
`completed_adapted`, `partially_completed`, `cancelled` - `completed_*`
records are immutable in identity; corrections create auditable updates
rather than silently replacing history. - `completed_adapted` means the
adapted workout was completed; it does not mean the original plan was
fully completed. - `partially_completed` means the user stopped before
finishing the current session target. - Rescheduling must preserve
original plan and record the new date/relationship. - Avoid treating a
no-workout habit action as a workout session.

A finished session must snapshot the source programme version and list
exercises as included/substituted/deferred/removed. Session summaries
must derive from actual logged sets, not from prescribed targets.

## 7. Adaptive Day algorithm

Implement as a deterministic domain service; AI can optionally explain
the proposal but must not be the source of truth.

Inputs: - Approved programme-day snapshot. - Available minutes. -
Equipment available today. - Optional self-reported energy/readiness. -
User constraints and excluded movements. - Exercise metadata and
estimated time model.

Output: - Proposed adapted session ID/draft. - Included exercises and
selection rationale. - Substitutions and reasons. - Deferred/removed
exercises and reasons. - Estimated duration and confidence label. -
Explicit warning if estimates are approximate. - Alternative options:
shorter, home/minimal equipment, reschedule, or non-workout habit
action.

Rules: - Never mutate the original programme or planned session
snapshot. - Prioritise according to deterministic configurable
priorities: programme intent, exercise order/priority, equipment
compatibility, duration feasibility, and user exclusions. - Include
warm-up/transition buffer in duration estimates; do not reduce rest
periods below the approved plan simply to fit. - Do not promise that an
unrealistic session fits the time. - If no feasible proposal exists,
return a reason and alternatives rather than fabricate a plan. - Require
user approval before starting. - Persist the adaptation rationale for
later review. - Schedule changes are suggestions; user approves before
calendar mutation.

## 8. Progression engine

Create pure functions with unit tests. Inputs include: - Exercise and
programme prescription. - Recent comparable sessions/sets. - Rep range
and current load. - Optional RPE/RIR/user feedback. - Equipment
increments if known. - Rules version.

Output: - `increase_load`, `increase_reps`, `repeat_target`,
`reduce_or_review`, or `insufficient_data`. - Suggested target and
human-readable rationale. - Data references used. - Rule version.

Never auto-write a new prescription without user approval. Do not infer
form quality. If data is missing or inconsistent, return
`insufficient_data`. Keep configurable conservative defaults and
document them; do not present them as medical advice.

## 9. XP, streaks, and achievement idempotency

-   Define XP event types and values in one configuration module.
-   Each award includes deterministic idempotency key,
    e.g. `session_completed:<sessionId>:<ruleVersion>`.
-   Add a local uniqueness constraint and server-side uniqueness
    constraint where supported.
-   Replaying sync or processing the same event twice must not create a
    second award.
-   Session XP and PR badge awards are distinct event types.
-   Do not reward excess sets or exercise duration in ways that
    encourage unsafe volume.
-   Streak computation must account for scheduled rest days and
    user-approved rescheduling.
-   Unit-test time zones, midnight boundaries, daylight-saving changes
    where applicable, and duplicate event replay.

## 10. Offline storage and sync

### Write path

1.  Validate mutation locally.
2.  Commit to SQLite transaction.
3.  Add an outbox item in the same transaction.
4.  Update UI from local database.
5.  If online, sync asynchronously; otherwise leave pending.
6.  Mark synced only after server acknowledgement.
7.  Retry with exponential backoff and jitter, bounded retry attempts,
    and visible error state.
8.  Use stable IDs/idempotency keys so retry is safe.

### Conflict strategy

-   One primary editing device is the v1.0 assumption.
-   Include `updated_at`, version/etag or equivalent, and `deleted_at`
    tombstones where needed.
-   Prefer append-only workout sets/events and immutable session
    snapshots.
-   If server and local versions diverge, do not silently overwrite.
    Preserve local data and surface a recoverable conflict.
-   Avoid last-write-wins for workout logs without a clear merge policy.
-   Delete operations must sync as tombstones before remote purge.
-   Never clear pending local records merely because a request timed
    out.

### Sync operations

-   Batch where sensible; avoid one network request per set.
-   Handle auth expiry separately from network failure.
-   Enforce user ownership server-side.
-   Photos use a separate upload queue, private bucket, random object
    paths, and signed URLs only when needed.
-   Do not use public buckets for progress photos.

## 11. Backend and database security

-   Use Supabase Auth; enable row-level security on all user data
    tables.
-   RLS policies must enforce `auth.uid() = user_id` for reads/writes,
    with deliberate policies for child records.
-   Never ship the Supabase service-role key in the app.
-   Mobile client may use public anon/publishable key only with correct
    RLS policies.
-   AI API key (`GROQ_API_KEY`) stored only as an Edge Function secret.
-   Edge Function validates auth, request schema, consent, size limits,
    rate limits, and allowed task types.
-   Return generic client errors; never expose stack traces or secrets.
-   Limit AI input to minimal necessary context and omit photos.
-   Add data export/delete that removes cloud records and private
    objects; make local deletion explicit.
-   Add `.env.example` with placeholder names only; `.env` ignored by
    Git.
-   Avoid logging prompts/responses by default. If debugging is enabled
    locally, redact personal data.

## 12. AI integration

### API

Use the Groq API Free plan (base URL `https://api.groq.com/openai/v1`,
chat completions) through a server-side Supabase Edge Function. Plain
`fetch` is sufficient; no SDK is required. Never call Groq directly from
the mobile client. Groq deprecates models over time, so model IDs are
configuration, not constants, and must be checked against Groq's current
models and deprecations pages before release.

### Model chain (free tier only)

Free-plan limits as last checked on 2026-10-11 (per model, per
organisation): 30 requests/min, 1,000 requests/day, 8,000 tokens/min,
200,000 tokens/day for each model below. Each model has its own pool, so
falling back to another model also gives separate quota.

| Role | Default model ID | Used for | Why |
|---|---|---|---|
| Primary | `openai/gpt-oss-120b` | `programme_draft`, `weekly_review_narrative` | Strongest free model; supports strict structured outputs |
| Light | `openai/gpt-oss-20b` | `coach_question`, `adaptation_explanation` | Same free limits and strict mode; keeps high-volume chat off the primary's daily pool |
| Backup | `qwen/qwen3.8-27b` | Fallback for any task | Different model family and separate quota; supports strict structured outputs |

Env/secret names (placeholders only in `.env.example`; real values
only as Supabase function secrets): `GROQ_API_KEY`,
`GROQ_MODEL_PRIMARY`, `GROQ_MODEL_LIGHT`, `GROQ_MODEL_BACKUP`.

Do not use `openai/gpt-oss-safeguard-20b` (3 requests/min) or the
`groq/compound` systems (built-in web/code tools, not needed) in v1.0.

Fallback rules:
-   Try the task's default model first, then the next model in the
    chain, at most once per model per user request.
-   Fall back only on 429, 5xx, timeout, or model-unavailable/deprecated
    errors. On 429 honour the `retry-after` header; never retry in a
    tight loop.
-   If every model fails, return "AI temporarily unavailable / free quota
    reached" and stop. Never upgrade the Groq plan, add a payment method,
    or route to a non-Groq provider.
-   Record which model produced each response (model ID and prompt
    version) alongside the validated output.

Token budget: the 8,000 tokens/min cap is the binding limit. Keep
input plus `max_tokens` for a single request comfortably under it, send
compact app-generated summaries rather than raw history, and for large
`programme_draft` requests generate one training day per request
sequentially instead of one oversized call. Cached prompt tokens do not
count toward limits, so keep long system prompts static and first.

### Request types

-   `programme_draft`
-   `coach_question`
-   `weekly_review_narrative`
-   `adaptation_explanation` (optional; deterministic rules produce the
    actual adaptation) Use Groq structured outputs with
    `response_format: json_schema` and `strict: true` (all fields
    required, `additionalProperties: false`, optional values as
    `["type","null"]` unions). Streaming and tool use are not supported
    together with structured outputs, so use non-streaming calls. Strict
    mode guarantees shape only, not truthfulness: always validate every
    response with Zod and check exercise IDs, ranges, and safety rules.

### AI contract

-   Input: task type, minimal profile context, selected workout history,
    user message, app-generated factual summary.
-   Output: schema-conforming suggestion with summary, rationale,
    assumptions, caveats, and any proposed changes.
-   No direct database access or arbitrary tool execution.
-   No AI-generated values are persisted as canonical until validated
    and approved.
-   Keep prompt templates versioned in source control.
-   Set token/output limits, request timeouts, per-user rate limits, and
    graceful handling for 429/5xx/timeouts.
-   Cache only non-sensitive reusable output where appropriate; do not
    cache one user's private context across users.
-   When AI is unavailable, show deterministic fallbacks or let user
    continue without AI.
-   Obtain explicit opt-in before sending any personal fitness context
    to a third-party processor. Disclose what is sent and Groq's
    current retention terms. Recommend enabling Zero Data Retention in
    the Groq console Data Controls for this project. Never send photos,
    credentials, exact location, or unrelated identifiers.
-   UI must explain that AI responses can be wrong and are not medical
    advice.

### Quota behaviour

-   Add configurable daily request limit per user and a global circuit
    breaker sized below the shared Groq organisation limits (for
    example, track remaining requests/tokens from the
    `x-ratelimit-*` response headers and stop calling a model when its
    remaining quota is low).
-   Quota is per model: when one model is exhausted, the chain may use
    the next free model, but once all are exhausted stop automatic
    retries and show "AI temporarily unavailable / free quota reached";
    do not fall back to a paid plan or model.
-   AI should be on-demand by default. Proactive AI calls must be
    limited, opt-in, and only triggered for defined events.
-   Never make AI calls during workout logging or in any path that
    blocks set persistence.

## 13. Privacy and photo storage

-   Photos are private locally and in cloud storage.
-   Keep local URI separate from remote object path.
-   Upload only with user-enabled cloud backup.
-   Avoid storing public image URLs; use private storage and short-lived
    signed URLs.
-   Deletion removes photo from local storage and queues cloud deletion.
-   Do not run computer vision or send photos to AI in v1.0.
-   Document that free cloud storage quotas are limited and users should
    export important data.

## 14. Testing strategy

### Unit tests

-   Programme and exercise validation.
-   Progression engine boundaries.
-   Adaptive Day feasibility, prioritisation, and deferred-work
    representation.
-   Session state transitions.
-   XP idempotency and streak rules.
-   Unit conversions and date/time boundaries.
-   AI schema validation and malformed output handling.
-   Sync idempotency and conflict resolution.

### Integration tests

-   SQLite migrations and transaction/outbox atomicity.
-   Offline mutation followed by sync.
-   Duplicate retry handling.
-   Supabase RLS and user isolation.
-   Private photo upload/delete.
-   AI proxy consent/rate limit/timeout/quota behaviour, including
    model-chain fallback on 429/5xx/timeout and exhaustion of all
    models (mocked Groq responses; no live calls in CI).

### Manual/device tests

-   Android device or emulator; iOS simulator/device where available.
-   Airplane mode during active workout.
-   Force-close/relaunch during workout.
-   Low storage and failed photo upload.
-   Expired auth token.
-   Duplicate sync response and server timeout.
-   Font scaling/accessibility and dark theme contrast.

## 15. Performance and reliability targets

-   Local set entry should feel immediate; persist before showing
    success.
-   Avoid network calls on the critical set-logging path.
-   Paginate long histories.
-   Keep app startup and home dashboard lightweight.
-   Do not load all photos at full resolution in a timeline.
-   No acknowledged local workout data loss in tested crash/relaunch
    scenarios.
-   Sync errors are recoverable and visible.
-   AI response latency must not block workout operations.

## 16. Build, release, and free-tier controls

-   Pin compatible dependency versions and commit lockfile.
-   Provide `npm run lint`, `npm run typecheck`, `npm test`, and
    documented platform run commands.
-   Include `.env.example`, migration scripts, seed data, and local
    setup instructions.
-   Provide a no-credentials development mode using mock AI and
    local-only storage.
-   Verify current Expo, Supabase, and Groq free limits before
    release; record verification date and links in
    `docs/FREE_TIER_LIMITS.md`.
-   No paid APIs, paid SDKs, or paid fonts/UI assets.
-   Never require an AI API key to use workout logging.
-   Public store distribution may have platform developer account fees;
    document this separately from software/runtime costs.
