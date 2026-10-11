# GymOS

GymOS is a personal, offline-first fitness app for iOS and Android, with a premium dark minimal design. It is built with React Native, Expo SDK 54 and TypeScript, and runs in **Expo Go 54** (tested target: Expo Go client 54.0.8).

What it does:
- Plan and log workouts, including adapting a day's session to the time, equipment and energy you actually have (Adaptive Day).
- Track progression, personal records and attendance.
- Run campaigns and earn XP.
- Log body measurements, private progress photos and recovery check-ins.
- Back up optionally to Supabase Free.
- Use an optional AI coach (Groq Free plan) through a server-side Edge Function.

**Core training works with no account, no network and no AI.**

| Doc | Purpose |
|---|---|
| [`docs/PRD.md`](docs/PRD.md) / [`docs/TRD.md`](docs/TRD.md) | Product and technical source of truth |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Implementation decisions (where the PRD/TRD left details open) |
| [`docs/FREE_TIER_LIMITS.md`](docs/FREE_TIER_LIMITS.md) | Verified free-tier limits, sources, release checklist |
| [`docs/EXPORT_FORMAT.md`](docs/EXPORT_FORMAT.md) | Data export format |
| [`docs/MANUAL_TEST_CHECKLIST.md`](docs/MANUAL_TEST_CHECKLIST.md) | On-device test script |
| [`docs/IMPLEMENTATION_REPORT.md`](docs/IMPLEMENTATION_REPORT.md) | What was built, what was tested, known limitations |

---

## 1. Quick start (local-only, no credentials)

Prerequisites:
- Node 22 LTS and npm 10.
- A phone with **Expo Go**, or an Android emulator/iOS simulator.

```bash
npm install
npx expo start          # scan the QR code with Expo Go (Android) or the Camera app (iOS)
```

With no `.env`, the app runs in **local-only mode**:
- Everything is stored in SQLite on the device.
- Cloud backup shows as "not configured".
- The AI coach can be tried with **Mock AI**: Profile → AI coach & data sharing → enable, then turn on "Mock AI (development)".

All packages are Expo Go-compatible, so no development build is required.

### Scripts

| Command | What it does |
|---|---|
| `npm start` | Expo dev server |
| `npm run android` / `npm run ios` | Dev server, opening on Android/iOS |
| `npm run lint` | ESLint (`eslint-config-expo` + Prettier compatibility) |
| `npm run format` | Prettier |
| `npm run typecheck` | `tsc --noEmit` (strict, `noUncheckedIndexedAccess`) |
| `npm test` | Jest (unit + integration + component), then the Postgres schema tests |
| `npm run test:unit` / `npm run test:sql` | Run only one of the two suites |
| `npm run check` | lint + typecheck + all tests |

The tests run real SQL. They use:
- **better-sqlite3** for the app's SQLite schema, migrations, transactions and sync outbox.
- **PGlite** (Postgres compiled to WASM) for the Supabase migration, RLS and `sync_push`.

AI tests use a mocked Groq, so no network or credentials are needed.

---

## 2. Running on Android / iOS

- **Android, physical phone (easiest):**
  1. Install Expo Go.
  2. Run `npx expo start`.
  3. Scan the QR code.
- **Android emulator:**
  1. Install Android Studio, which includes a JDK and an emulator.
  2. Start an emulator.
  3. Run `npm run android`.
- **Local Android build (APK):** with Android Studio and a JDK installed, run `npx expo run:android`. This generates `android/` through Continuous Native Generation; don't edit that folder by hand.
- **iOS:** Expo Go on an iPhone works from Windows. Simulators and local iOS builds need macOS with Xcode. Alternatively, `npx eas-cli build -p ios` uses the EAS free quota, which is optional.
- **Store distribution:** Google Play and the Apple Developer Program charge developer account fees. These are separate from GymOS's runtime costs, which are free.

---

## 3. Supabase setup (optional cloud backup)

GymOS uses **Supabase Free**: Auth, Postgres with RLS, a private Storage bucket and Edge Functions.

1. Create a project at https://supabase.com. Do **not** add a payment method or a paid plan.
2. Install the CLI (https://supabase.com/docs/guides/cli), then link the project:
   ```bash
   supabase login
   supabase link --project-ref <your-project-ref>
   ```
3. Apply the schema (tables, RLS policies, the `sync_push` RPC, AI quota tables and the private `progress-photos` bucket):
   ```bash
   supabase db push
   ```
   Alternatively, paste `supabase/migrations/20261011000000_init.sql` into the SQL editor.
4. Deploy the Edge Functions:
   ```bash
   supabase functions deploy ai-coach
   supabase functions deploy delete-account
   ```
5. Auth: Email/password is used.
   - For personal use, you can disable "Confirm email" (Authentication → Providers → Email).
   - Otherwise, users confirm by email before signing in.
6. App config: copy `.env.example` to `.env` and fill in:
   ```
   EXPO_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon/publishable key>
   ```
   Restart `npx expo start` after changing it.
7. In the app: Profile → Cloud backup & sync → create an account or sign in → turn on "Back up and sync".

**Security model:**
- The app only ever holds the public anon key and the user's session. The session is stored in the OS keychain through `expo-secure-store`.
- Every table has row-level security (RLS) with `auth.uid() = user_id`.
- Photos live under `<user_id>/<random uuid>.jpg` in a **private** bucket. They are viewed only through short-lived signed URLs.
- The service-role key exists only inside Edge Functions, where Supabase injects it automatically.

**Free tier caveats** (details in `docs/FREE_TIER_LIMITS.md`):
- 500 MB database, 1 GB storage and 50 MB per file.
- **Projects pause after a week of inactivity.** The app keeps working locally; restore the project in the dashboard.
- There is no backup SLA, so export your data regularly.

---

## 4. Groq setup (optional AI coach)

1. Create a free account at https://console.groq.com and an API key. The Free plan needs no payment method; don't add one.
2. Recommended: enable **Zero Data Retention** under Settings → Data Controls.
3. Set the Edge Function secrets. Never put these in `.env` or in any `EXPO_PUBLIC_*` variable:
   ```bash
   cp supabase/functions/.env.example supabase/functions/.env   # fill in GROQ_API_KEY
   supabase secrets set --env-file supabase/functions/.env
   ```
4. In the app: Profile → AI coach & data sharing → read the notice → enable.

**Model chain** (free models only; configured through secrets):

| Role | Default model |
|---|---|
| Primary | `openai/gpt-oss-120b` |
| Light | `openai/gpt-oss-20b` |
| Backup | `qwen/qwen3.8-27b` |

How the AI proxy behaves:
- **Fallback:** it moves to the next model only on 429, 5xx, a timeout or an unavailable model, and tries each model at most once.
- **Rate limits:** it honours `retry-after`.
- **Circuit breaker:** it pauses a model when `x-ratelimit-remaining-*` runs low.
- **Per-user cap:** 20 requests per day by default.
- **When every model fails:** it returns "AI temporarily unavailable / free quota reached". There is no paid fallback and no other provider.
- **Before release:** check that the models are still listed and not deprecated (`docs/FREE_TIER_LIMITS.md` → release check).

What is sent to the AI:
- **Sent:** minimal summaries (goals, experience, schedule, equipment, avoided movements, programme and recent-session summaries) plus the question.
- **Never sent:** photos, name, email, age, body weight, measurements or device paths.
- **Validation:** the Edge Function rejects unknown fields, and every response is validated with Zod on both the server and the client.

---

## 5. Architecture

```
src/
  app/                 Expo Router screens (tabs: Home, Train, Progress, Coach, Profile)
  components/          Design system (dark tokens, buttons, inputs, states, charts)
  domain/
    models/            Types and constants
    rules/             Pure, versioned, tested rules: progression, adaptiveDay, sessionState,
                       prs, schedule/streaks, xp, weeklyReview, timeEstimate
    validation/        Zod/domain validation (programme, set)
  data/
    local/             SQLite: migrations, seed library, store (write + outbox), repositories
    remote/            Supabase client, SecureStore session, sync engine, photo queue
  features/            Feature UI and services (workout, adaptive-day, coach, sync, settings…)
  state/               Transient UI state only (network, rest timer, sync status)
supabase/
  migrations/          Schema + RLS + RPCs + private bucket
  functions/           ai-coach (Groq proxy), delete-account, _shared (runtime-agnostic core)
tests/                 unit/, integration/ (Jest + better-sqlite3), sql/ (node:test + PGlite)
```

**Write path:**
1. A mutation is validated.
2. It is committed in one SQLite transaction together with its outbox row. All writes go through a single lock.
3. The UI re-reads from SQLite.
4. Background sync pushes batches through the idempotent `sync_push`.
5. An outbox row is deleted only after the server acknowledges it.

**Sync failures and conflicts:**
- Network failures retry with exponential backoff and jitter. After 8 attempts, items stay visible as failed.
- An expired login is reported separately and doesn't count as a failed attempt.
- Conflicts are never overwritten silently. They are listed under Profile → Cloud backup.

---

## 6. Known limitations

The full list is in `docs/IMPLEMENTATION_REPORT.md`. The main ones:
- Not yet run on a physical device or emulator in this environment (none available). Verified so far: compile/bundle (`expo export`), automated tests and typed routes. Use `docs/MANUAL_TEST_CHECKLIST.md`.
- The Edge Functions were not executed against live Supabase or Groq. Their core logic is unit-tested with mocks, and the SQL is tested in PGlite.
- The schedule is weekday-based (no rotating splits yet). The rest timer resets if the app process is killed (logged sets don't).
- Photo files are not part of the JSON export.
- One primary device is assumed, and conflicts are resolved per record.
