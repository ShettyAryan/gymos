# Free-tier verification checklist

**Last reviewed:** 2026-10-11 (Phase 0 verification against official pages; verify again before release)

## Proposed free-first services
- Expo / React Native: open-source app framework; local development/builds are possible. Optional hosted build services may have quotas. Project targets Expo SDK 54 (`expo` ~54.0.37, `react-native` 0.81.5) so it runs in Expo Go 54.x.
- Supabase Free: Auth, Postgres, private Storage, and Edge Functions. Sources: https://supabase.com/pricing and https://supabase.com/docs/guides/platform/billing-on-supabase
- Groq API (Free plan): no payment method required for the Free plan; limits are rate-based, per model, and apply per organisation (shared by all app users). Sources: https://console.groq.com/docs/rate-limits, https://console.groq.com/docs/structured-outputs, https://console.groq.com/docs/your-data. Exact limits for the account are on https://console.groq.com/settings/limits (authoritative; the docs table is a summary and may have exceptions). Model deprecations: https://console.groq.com/docs/deprecations

## Supabase Free limits (checked 2026-10-11 against supabase.com/pricing)

| Resource | Free limit |
|---|---|
| Database size | 500 MB per project (shared CPU, 500 MB RAM) |
| File storage | 1 GB |
| Egress | 5 GB + 5 GB cached egress |
| Edge Function invocations | 500,000 / month |
| Monthly active users | 50,000 |
| Max upload file size | 50 MB |
| Active free projects | 2 |
| Inactivity | **Free projects are paused after 1 week of inactivity** |

Caveats: no backups/SLA guarantees on Free; GymOS keeps the local database as the primary copy and offers JSON export. A paused project must be restored manually in the Supabase dashboard; the app keeps working locally meanwhile.

## Groq free-plan limits (checked 2026-10-11 against console.groq.com/docs/rate-limits)

| Role | Model ID | RPM | RPD | TPM | TPD | Strict structured outputs |
|---|---|---|---|---|---|---|
| Primary | `openai/gpt-oss-120b` | 30 | 1,000 | 8,000 | 200,000 | Yes |
| Light | `openai/gpt-oss-20b` | 30 | 1,000 | 8,000 | 200,000 | Yes |
| Backup | `qwen/qwen3.8-27b` | 30 | 1,000 | 8,000 | 200,000 | Yes |
| Not used | `openai/gpt-oss-safeguard-20b` | 3 | 1,000 | 2,000 | 200,000 | No (best-effort only) |
| Not used | `groq/compound` | 30 | 250 | 70,000 | not checked | n/a (third-party summary, not the official table) |

Verified 2026-10-11:
- Strict mode (`strict: true`) is documented for exactly `openai/gpt-oss-20b`, `openai/gpt-oss-120b`, `qwen/qwen3.8-27b`.
- None of the three chain models is listed on the deprecations page. (`qwen/qwen3.6-27b` is deprecated 2026-09-14 with `qwen/qwen3.8-27b` as replacement.)
- Rate-limit response headers: `retry-after`, `x-ratelimit-limit-requests`, `x-ratelimit-limit-tokens`, `x-ratelimit-remaining-requests`, `x-ratelimit-remaining-tokens`, `x-ratelimit-reset-requests`, `x-ratelimit-reset-tokens`. Exceeding a limit returns HTTP 429.

Caveats:
- Limits are per model and per organisation; the first limit reached (RPM, RPD, TPM or TPD) triggers HTTP 429 with a `retry-after` header.
- 8,000 tokens/min is the binding constraint: keep input plus output per request well below it and split large programme drafts into per-day requests.
- Cached prompt tokens do not count toward limits.
- Streaming and tool use are not supported together with structured outputs.
- Model IDs can be deprecated; keep them in configuration and re-check before release.
- Data handling per Groq's "Your data" page (checked 2026-10-11): "By default, Groq does not retain customer data for inference requests." Inputs and outputs **may be temporarily logged for up to 30 days** when troubleshooting errors or investigating abuse. Zero Data Retention (ZDR) can be enabled in Data Controls (https://console.groq.com/settings/data-controls), which prevents retention for reliability/abuse monitoring. Customer data is retained in GCP buckets in the United States. The in-app disclosure (`src/features/coach/disclosure.ts`) uses this wording.
- Upgrading to the paid Developer plan would raise limits but is out of scope; never enable it automatically.
- GitHub Actions: optional; verify current included minutes/storage at https://docs.github.com/en/billing/concepts/product-billing/github-actions
- Android/iOS store distribution: store developer account fees may apply; verify current policies with Google Play and Apple.

## GymOS defaults sized below the shared limits
- Per-user AI cap: `AI_USER_DAILY_LIMIT` (default 20 requests/day).
- Global circuit breaker: a model is skipped when `x-ratelimit-remaining-requests` < `AI_MODEL_MIN_REMAINING_REQUESTS` (default 25) or `x-ratelimit-remaining-tokens` < `AI_MODEL_MIN_REMAINING_TOKENS` (default 2,500), until its reset time.
- Per-request `max_tokens` ≤ 1,800 and input capped at ~12,000 characters (~3,000 tokens), keeping one request under ~5,000 tokens.

## Required release check
1. Confirm each model in the chain (primary, light, backup) is still available on the Free plan for the account and is not deprecated.
2. Confirm current requests-per-minute/day and token quotas on the Groq limits page for the organisation.
3. Read current Groq data-use/retention terms and enable Zero Data Retention in Data Controls if desired. Obtain explicit opt-in before sending personal fitness context.
3a. Confirm no payment method or paid plan is attached to the Groq organisation, and the Edge Function never targets a non-free model or another provider.
4. Confirm Supabase Free database/storage/egress/function limits and inactivity behaviour.
5. Ensure no paid fallback or automatic billing is enabled.
6. Verify the app continues working when every remote service is unavailable.
7. Record date checked and official links here.
