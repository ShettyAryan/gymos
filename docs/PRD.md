# GymOS --- Product Requirements Document (PRD)

**Version:** 1.0\
**Status:** Implementation baseline\
**Audience:** Product owner, Claude Code, developers, QA\
**Product:** GymOS --- personal fitness operating system\
**Platforms:** Android and iOS\
**Product principle:** Reward consistency while remaining honest about
the work completed.

## 1. Product vision

GymOS helps one person consistently train toward a physique/strength
goal by connecting planning, workout execution, progression, recovery,
accountability, nutrition basics, and transformation tracking in one
private app.

The product must be useful even when AI is unavailable, the user has no
network, or a free-tier quota has been reached. AI assists;
deterministic, testable application logic owns workout records,
progression calculations, scheduling, XP, and sync.

## 2. Goals and non-goals

### Goals

-   Make it fast to start and log a workout.
-   Remember the user's exercise history and provide sensible
    next-session targets.
-   Adapt a planned session to available time/equipment without
    misrepresenting what was completed.
-   Help the user remain consistent without encouraging unsafe
    overtraining.
-   Track strength, adherence, body measurements, weight, and private
    progress photos over time.
-   Provide AI-assisted programme creation and a context-aware
    assistant, with explicit user approval for meaningful changes.
-   Work offline for core workflows and sync safely when connectivity
    returns.
-   Use a free-first stack and a free AI API tier; never require paid
    services for core use.

### Non-goals for v1.0

-   Social feed, public leaderboards, trainer marketplace, multi-user
    coaching.
-   Billing/subscriptions or paywalls.
-   Full calorie/food database, barcode scanning, meal-photo
    recognition.
-   Computer-vision body-fat or muscle-mass estimation.
-   Advanced wearable integrations.
-   Multi-device simultaneous editing or real-time collaboration.
-   Medical diagnosis, injury treatment, or clinical recommendations.

## 3. Target user and product assumptions

-   Initial use is personal, with possible commercialisation later.
-   User has one primary phone; Android is a practical first testing
    target, but the codebase supports iOS.
-   Premium dark minimal design.
-   The user can create/edit exercises and programmes.
-   One active campaign at a time, with supporting milestones.
-   Workout logging, active workout recovery after app restart, and
    local persistence are core requirements.
-   App should not assume a particular split, training experience, goal,
    equipment, or schedule.

## 4. Product success criteria

-   User can complete onboarding and create/approve a programme.
-   A normal workout can be started and a set logged in a few taps.
-   Active workout survives force-close/relaunch without losing
    acknowledged local entries.
-   Core workout history, programme view, progression recommendations,
    and logging work offline.
-   Adapted workouts are clearly differentiated from the original
    planned session.
-   XP and achievements are idempotent: retries do not award duplicates.
-   Progression recommendations are explainable from logged data and
    versioned rules.
-   Photos are private by default and are not sent to an AI provider.
-   AI quota/network failure does not break the rest of the app.
-   User can export and delete their data.
-   Automated tests cover the rules engine, adaptive session
    classification, XP idempotency, and sync retry behaviour.

## 5. Information architecture

Bottom navigation: 1. **Home** --- today's plan, next session, weekly
adherence, streak, campaign milestone, quick-start. 2. **Train** ---
active programme, exercise library, workout logger, workout history. 3.
**Progress** --- strength trends, PRs, weight/measurements, private
photo timeline. 4. **Coach** --- AI assistant, approved suggestions,
weekly accountability review. 5. **Profile** --- goals, availability,
equipment, preferences, reminders, privacy, export/delete.

Critical path: Home → Start/Adapt workout → Log sets → Finish → Session
summary. Avoid making users navigate through Coach to perform core
training actions.

## 6. Functional requirements

### FR-01 --- Onboarding and fitness profile

Collect only what is needed, with optional fields clearly marked: -
Goal(s): strength, muscle gain/hypertrophy, general fitness,
consistency, or custom. - Experience level and approximate training
history. - Height, current body weight (optional), age (optional), and
preferred units. - Weekly availability and preferred training days. -
Available equipment/location: full gym, home gym, bodyweight/minimal
equipment, custom. - Known limitations or movements the user chooses to
avoid (not a diagnosis). - Preferred session duration. - Starting
measurements and optional progress photos. - Campaign start/end date or
target event/date (optional).

User can edit the profile at any time. Do not infer or fabricate profile
values. Explain why any sensitive information is requested.

### FR-02 --- AI-assisted programme builder

-   Generate a draft based on the user's profile, goal, availability,
    equipment, experience, and session duration.
-   Draft must contain training days, exercises, set/rep targets, rest
    guidance, optional effort target, exercise alternatives, and
    rationale.
-   The user can edit, reorder, replace, remove, and add exercises
    before activation.
-   User explicitly approves the programme before it becomes active.
-   Support manual programme creation without AI.
-   Preserve programme versions. A programme change must not rewrite
    historic sessions.
-   AI output is untrusted input: validate schema, exercise IDs, ranges,
    and safety rules before display/save.
-   No silent major programme changes. Explain proposed changes and
    require approval.

### FR-03 --- Exercise library

-   Seed a modest, curated starter library; do not claim exhaustive
    coverage.
-   Exercise fields: name, movement pattern, primary/secondary muscle
    groups, equipment, instructions, default rest, supported logging
    type, alternatives, and optional caution notes.
-   Support custom exercises.
-   Logging types include weight + reps, bodyweight + reps, assisted
    bodyweight, duration, distance, and time-based holds as appropriate.
-   Users can search/filter by name, equipment, and muscle group.
-   Avoid making medical claims in exercise instructions.

### FR-04 --- Workout execution and logging

-   Start a planned session, a freeform session, or an adapted session.
-   Log each set with the fields relevant to that exercise: load, reps,
    duration/distance where applicable, and optional RPE/RIR.
-   Show previous performance and prescribed target near the input.
-   Include rest timer, pause/resume, undo/edit, exercise substitution,
    notes, and finish confirmation.
-   Save every acknowledged edit locally immediately; no "Save" action
    should be required for each set.
-   Active workout survives app restart and offline use.
-   Finish summary shows actual logged work, elapsed time, PRs, and any
    deferred exercises.
-   A partial session must not be labelled as the complete original
    programme.

### FR-05 --- Strength Memory and progression

-   Show previous logged performance for the same exercise, including
    date and sets.
-   Track exercise-level records, rep/load trends, volume trends where
    meaningful, and personal records.
-   Deterministic progression engine uses the current programme's rep
    range, previous performance, and optional effort feedback.
-   Never blindly increase load every session.
-   Example policy: if all prescribed working sets reach the top of the
    rep range with acceptable effort and no user-reported issue, suggest
    a small load increase next time; if not, suggest repeating or
    adjusting within the range. Exact thresholds are configurable and
    must be covered by tests.
-   Recommendations include a short explanation and can be
    dismissed/edited by the user.
-   Do not infer technique quality unless the user provides feedback; do
    not claim the app observed form.
-   Version the progression rules and store which rule version generated
    a recommendation.

### FR-06 --- Adaptive Day (core MVP)

The user can adapt a planned workout based on: - Available time:
original planned duration, or shorter options. - Equipment/location
available today. - Energy/readiness self-report: low, normal, high
(optional). - Optional reason: schedule, equipment, fatigue, travel, or
custom.

Flow: 1. User taps **Adapt today's workout**. 2. App collects missing
constraints with minimal friction. 3. Rules engine proposes a realistic
alternative from the approved programme and available equipment. 4.
Proposal identifies retained, substituted, deferred, and removed
exercises, with estimated time. 5. User reviews and approves before
starting. 6. User logs actual work normally. 7. Summary distinguishes
adapted session completion from completion of the original plan. 8. App
reviews future schedule and proposes changes only if needed; user
approves rescheduling.

Rules: - Preserve the original planned session and programme version. -
Do not force all deferred exercises into the next day. - Do not compress
rest periods or encourage rushed, unsafe sets just to meet a time
limit. - Estimate time conservatively and include warm-up/transitions
where appropriate. - Never silently replace a workout or alter future
days. - If no safe/realistic adaptation can be generated, offer
rescheduling or a short habit-support action instead.

**Illustrative example --- 60-minute leg day, 20 minutes available, full
gym, normal energy:** propose a short session prioritising the most
important movements from the approved leg day. Display what is included
and deferred, and label it "shortened leg session". The example is
behavioural, not an individual training prescription.

Completion states: - `planned` - `in_progress` -
`completed_as_planned` - `completed_adapted` - `partially_completed` -
`rescheduled` - `missed` - `cancelled`

Do not conflate attendance, workout completion, or original-plan
completion.

### FR-07 --- Time-constrained and no-gym alternatives

For days with less/no gym time: - Offer realistic paths such as full
session, shortened session, home/minimal-equipment session, reschedule,
or recovery/habit-support action. - No-time option may be a non-workout
habit action (e.g., plan next session, prepare gear, or record a
check-in). Clearly label it as a habit action, not a workout. - Never
award full workout completion for a non-workout action. - Do not shame
the user for choosing rest or rescheduling. - Rest days do not break the
training streak if they are part of the plan.

### FR-08 --- Attendance and accountability

-   Calendar showing planned vs completed, adapted, rescheduled, missed,
    and rest days.
-   Weekly commitment is user-configurable.
-   Streak rules reward consistency against the plan, not daily exercise
    at all costs.
-   Missed-session check-in should be supportive and offer
    reschedule/adapt/skip options.
-   Weekly review summarises planned vs completed sessions, consistency,
    strength trends, notable PRs, and next-week suggestions.
-   Keep review grounded in recorded facts; distinguish data from
    interpretation.
-   Reminders are opt-in and configurable.

### FR-09 --- Transformation tracking

-   Log body weight and optional measurements (e.g., waist, chest, arms,
    thighs) with date and units.
-   Store private photos with categories such as front, side, and back.
-   User can add a campaign target date/photoshoot milestone and compare
    photos over time.
-   Provide prompts for consistent pose, lighting, distance, and time of
    day.
-   Photos are private by default; no public sharing by default.
-   Do not estimate body fat or muscle mass from images.
-   Never send photos to the AI provider by default.
-   Provide delete controls and explain cloud backup/storage behaviour.

### FR-10 --- Campaigns, XP, badges, milestones

-   One active campaign with editable name, goal, start date, target
    date, and supporting milestones.
-   Award XP for defined events: completing an eligible workout,
    consistency milestones, recording a review, or personal records.
-   Keep XP values in configuration, not scattered hard-coded values.
-   Award events use unique idempotency keys; repeated sync cannot
    duplicate XP or badges.
-   Award adherence and completion, not reckless volume or training
    through fatigue.
-   A PR badge is separate from session XP and campaign milestones.
-   Rest days should not break streaks when planned.
-   Avoid punishing the user for illness, travel, or legitimate
    rescheduling.

### FR-11 --- Nutrition and recovery basics

-   Optional simple tracking for protein, water, body weight, sleep
    duration/quality, energy, and soreness.
-   No mandatory calorie counting in v1.0.
-   Avoid presenting estimates as exact or providing extreme
    weight-loss/dehydration recommendations.
-   The user can skip nutrition/recovery tracking entirely.
-   Recovery check-ins inform context but do not diagnose conditions.

### FR-12 --- AI coach and proactive alerts

-   On-demand questions about programme, recorded workouts, progression,
    schedule, consistency, and campaign progress.
-   AI may propose programme changes, but changes require user approval.
-   Weekly summary and a small number of meaningful, opt-in alerts
    (e.g., missed plan check-in, weekly review ready).
-   Send only minimum relevant structured records needed for the
    request.
-   Never send progress photos, credentials, secrets, or unnecessary
    profile fields to the model.
-   AI response must not invent historical data. If data is missing, say
    so.
-   Use deterministic application functions to fetch context; do not let
    the model execute arbitrary database queries.
-   If AI fails or quota is exhausted, show a clear message and keep the
    app usable.
-   Health/safety boundary: no diagnosis, no injury treatment, no advice
    to train through pain or concerning symptoms. Encourage appropriate
    professional evaluation when warranted.
-   AI requests are processed by a third-party provider (Groq, free
    plan). Explain this clearly, including what is sent and the
    provider's current retention terms, obtain explicit opt-in before
    sending personal fitness context, and allow AI features to be
    disabled.

### FR-13 --- Offline-first behaviour and cloud backup

-   Core workout logging, active workout, current programme, exercise
    library, history, attendance, basic analytics, and progression rules
    work offline.
-   Use persistent local storage, not in-memory state alone.
-   Every local mutation gets a stable ID, timestamp, and sync state.
-   Queue changes and sync when online.
-   Retry safely with idempotency; never duplicate sessions, sets, XP,
    or achievements.
-   Show sync status and actionable errors.
-   Define conflict handling. For v1.0, assume one primary editing
    device. Use field-level or record-level version checks and make
    unresolved conflicts visible rather than silently overwriting.
-   Photos upload independently and show pending/uploaded/failed status.
-   App must never delete the only local copy of unsynced user data.
-   Cloud backup is best-effort on free tier; user must be told that
    free services are not a substitute for a guaranteed backup SLA.

### FR-14 --- Privacy, export, and deletion

-   Authentication and user-scoped access to cloud data.
-   Private-by-default data and photos.
-   Provide data export in a documented format and account/data deletion
    flow.
-   No API keys embedded in the mobile app.
-   Do not log tokens, passwords, photo URLs, or full sensitive prompts.
-   Use least-privilege access and database row-level security.
-   Clearly disclose that AI requests are sent to a third-party
    provider (Groq) and under what retention terms; explicit opt-in
    before sending personal context.
-   Include a local-only mode or allow the user to disable cloud/AI
    features where practical.

## 7. UX and visual design

-   Premium dark minimal interface; restrained accent colour, clear
    typography, high contrast, generous spacing.
-   Prioritise readability in gym lighting and large, easy-to-tap
    controls.
-   Keep set logging fast; avoid modal-heavy flows.
-   Show loading, empty, error, offline, and sync-pending states.
-   Confirm destructive actions; allow undo for accidental set
    edits/deletions where practical.
-   Accessibility: screen-reader labels, scalable text,
    colour-independent status indicators, and minimum comfortable touch
    targets.
-   Avoid gamification patterns that guilt users or encourage excessive
    training.

## 8. Analytics and event tracking

Use local analytics/diagnostic counters first; no third-party tracking
is required for MVP. If telemetry is added later, make it opt-in and
exclude workout details and photos by default. Useful product events
include onboarding completed, programme approved, workout started,
adapted workout approved, session completed, sync succeeded/failed,
weekly review viewed, and export/delete completed.

## 9. Acceptance criteria

-   User can complete onboarding without AI.
-   AI programme is a draft until explicitly approved.
-   Historic workout records are unchanged when programme is edited.
-   An offline set log survives app restart.
-   Sync retry creates no duplicate records or XP.
-   Adapted session summary accurately distinguishes completed vs
    deferred exercises.
-   No-time habit action does not count as workout completion.
-   Rest days configured in the programme do not break streaks.
-   Progress photos are not sent to AI.
-   AI output is schema-validated before use.
-   Progression suggestions show their rationale.
-   User can export and delete their data.
-   Every feature has loading/empty/error/offline states and tests for
    its key logic.

## 10. Release scope

**v1.0:** all FR-01 through FR-14 at a pragmatic personal-use level,
including Adaptive Day, offline core loop, cloud sync/backup, basic AI
coach, campaigns, private photos, and basic nutrition/recovery.\
**Later:** subscriptions, social features, wearable integrations,
advanced nutrition, image analysis, trainer marketplace.

## 11. Product decisions that must not be changed silently

-   Adaptive Day is MVP, not a later enhancement.
-   Offline workout logging is a core requirement.
-   The original planned session and actual adapted session remain
    distinct.
-   AI never silently edits an approved programme.
-   Progress photos are private and excluded from AI prompts by default.
-   XP and progression are deterministic, testable, and idempotent.
-   No paid service may be required for the core workout loop.
