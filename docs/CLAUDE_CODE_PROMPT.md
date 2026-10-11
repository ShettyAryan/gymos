# Claude Code Master Prompt --- GymOS

You are the senior engineer responsible for implementing GymOS. Read
`docs/PRD.md` and `docs/TRD.md` fully before changing code. They are the
product and technical source of truth. If an implementation detail is
unspecified, choose the simplest safe and maintainable option, document
the decision, and do not silently change product scope.

## Mission

Build GymOS as a premium dark minimal, offline-first fitness app for iOS
and Android using React Native, Expo, and TypeScript. Use only
free/open-source dependencies and free-tier services. Core workout
logging must not depend on an account, network, or AI API. The initial
backend is Supabase Free and the AI provider is the Groq API Free plan,
called only through a server-side Supabase Edge Function. Use an ordered
chain of Groq free-tier models (primary, light, backup; see
`docs/TRD.md` section 12). Do not enable paid fallbacks, do not upgrade
the Groq plan, and do not add another AI provider.

## Non-negotiable product rules

1.  Adaptive Day is a core MVP feature.
2.  Persist each workout mutation locally before showing success.
3.  Active workouts must survive force-close/relaunch and work offline.
4.  The original planned session and actual adapted session must remain
    distinct.
5.  AI-created programmes are drafts until user approval.
6.  AI must never silently modify a programme or canonical workout
    history.
7.  Progression, Adaptive Day selection, scheduling, XP, badges,
    streaks, and sync idempotency are deterministic application logic
    with tests.
8.  Never send progress photos or secrets to the AI provider.
9.  Ask for explicit opt-in before sending personal fitness context to
    Groq (a third-party processor); disclose what is sent, that it is
    processed outside the device, and the provider's current retention
    terms.
10. Do not embed AI secrets or Supabase service-role credentials in the
    mobile app.
11. Do not add paid SDKs, billing, social features, image analysis, or
    unrelated features.
12. Do not invent user data. Label estimates and AI suggestions clearly.
13. No workout set logging path may wait for an AI response or network
    request.
14. Do not reward excessive volume or training through pain. Do not
    diagnose or prescribe treatment.

## Working protocol

-   First inspect the existing repository. Do not overwrite existing
    work blindly.
-   If the repository is empty, scaffold the app using the stack in
    `docs/TRD.md`.
-   Before each phase, state the objective, files/modules expected to
    change, and acceptance criteria.
-   Implement one vertical slice at a time. After each slice, run lint,
    typecheck, and relevant tests; fix failures before proceeding.
-   Do not claim a command or test passed unless you actually ran it and
    observed success.
-   Prefer small, typed modules and pure domain functions. Keep UI,
    domain rules, local persistence, sync, and remote services
    separated.
-   Add/update tests with every business-rule change.
-   Use migrations for database changes. Never use destructive resets as
    a normal workflow.
-   Do not add dependencies without explaining why and confirming that
    they are free/open-source and compatible with Expo.
-   Do not expose secrets in logs, diffs, commits, generated docs, or
    client bundles.
-   If credentials are missing, implement a mock/local development path
    and document the exact manual setup needed; do not block core
    offline development.
-   Do not ask broad questions when a reasonable reversible default is
    possible. Ask only when a missing decision materially affects
    correctness, safety, or user data.
-   Keep `README.md`, `.env.example`, and `docs/FREE_TIER_LIMITS.md`
    current.

## Required implementation phases

### Phase 0 --- Repository and plan

Inspect the repo and toolchain. Report existing files, constraints, and
a phased plan. Verify current compatible Expo/React Native packages and
current free-tier constraints using official documentation if web access
is available. Record any uncertainty instead of assuming.

### Phase 1 --- Foundation and design system

Create app scaffold, strict TypeScript, navigation, theme tokens,
reusable controls, loading/empty/error/offline states,
lint/format/typecheck/test scripts, and README. Implement a premium dark
minimal shell with Home, Train, Progress, Coach, and Profile tabs. Use
placeholder content only where clearly marked.

### Phase 2 --- Local data and onboarding

Implement SQLite schema/migrations, typed repositories, seed exercise
library, onboarding/profile/goals/equipment/availability, and local-only
mode. Verify persistence after app restart.

### Phase 3 --- Programme and exercise library

Implement editable programmes, programme versions/snapshots, exercise
search/filter, custom exercises, AI-independent manual programme
creation, and explicit approval before activation. Add validation and
tests.

### Phase 4 --- Workout logger and Strength Memory

Implement active workout persistence, set logging for supported exercise
types, previous performance display, rest timer, pause/resume,
substitutions, finish summary, history, and PR detection. No network
dependency in the logging path. Test force-close/relaunch and offline
use.

### Phase 5 --- Deterministic progression and Adaptive Day

Implement progression as pure, versioned, tested functions. Implement
Adaptive Day proposal generation based on available time, equipment,
programme intent, and optional readiness. Preserve
included/substituted/deferred/removed work and original plan snapshot.
Require approval. Add state machine and XP/idempotency tests. Do not
defer Adaptive Day to a later release.

### Phase 6 --- Attendance, campaigns, accountability

Implement planned/completed/adapted/partial/rescheduled/missed/rest
states, streak rules that respect scheduled rest, one active campaign,
milestones, XP, badges, and weekly review from recorded data. Ensure
event replay cannot duplicate rewards.

### Phase 7 --- Progress and basic nutrition/recovery

Implement weight/measurement logs, private photo timeline and upload
state, campaign/photo milestones, and optional
protein/water/sleep/energy/soreness logs. Photos are private by default
and excluded from AI requests. Do not add photo analysis.

### Phase 8 --- Sync and Supabase

Implement authentication, RLS migrations, private storage bucket, outbox
sync, idempotent retries, conflict visibility, photo upload queue,
export/delete, and offline status. If credentials are not available,
keep a mock adapter and document setup. Never use a service-role key in
the app.

### Phase 9 --- Groq AI integration

Implement a server-side Edge Function with auth, explicit consent,
schema validation, request limits, timeouts, and quota handling. Call
Groq's OpenAI-compatible endpoint with a configurable model chain
(primary, light, backup), using strict structured outputs where the
model supports it. Fall back to the next free-tier model only on
429/5xx/timeout/model-unavailable, never to a paid plan. Respect the
`retry-after` header and keep each request within the free per-minute
token limit. Add
programme-draft, coach-question, and weekly-review tasks. Use Zod or
equivalent to validate every response. Keep deterministic rules
authoritative. If AI is unavailable, the rest of the app must continue
to work.

### Phase 10 --- Hardening and handoff

Run the complete test suite, lint, typecheck, and platform builds
available in the environment. Test offline/relaunch, duplicate sync, AI
quota errors, user isolation, private photo storage, export/delete, and
malformed AI responses. Fix issues, document known limitations, and
produce a final checklist.

## Required outputs

-   Working source code.
-   `docs/PRD.md` and `docs/TRD.md` preserved and updated only when a
    decision is explicitly agreed or a technical incompatibility
    requires a documented change.
-   `docs/FREE_TIER_LIMITS.md` with official source links, date checked,
    current free limits, and caveats.
-   `.env.example` containing variable names and placeholders only.
-   Database migrations and seed data.
-   Tests for critical domain logic.
-   `README.md` with setup, run, test, Supabase setup, Groq setup,
    Android/iOS run instructions, and limitations.
-   A final implementation report: features completed, tests actually
    run and their results, manual setup still required, known
    limitations, and any costs that might arise outside the free stack.

## Definition of done

Do not call the project complete until: - The core workout loop works
offline. - Active workout data survives app restart. - Adaptive Day
keeps the original plan and adapted completion separate. - Progression,
XP, streaks, and sync have automated tests. - Sync retry does not
duplicate sessions, sets, XP, or achievements. - AI output is validated
and never becomes canonical without approval. - Photos are private and
never sent to AI. - AI quota/network failure does not break core
functionality. - Setup documentation is sufficient for a new developer
to run the app. - All test/build claims are backed by actual command
output.

Start with Phase 0 only. Inspect the repository and return the plan
before implementing Phase 1.
