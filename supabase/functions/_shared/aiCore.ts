/**
 * AI proxy core (TRD §12). Runtime-agnostic: all I/O is injected so the same code runs in the
 * Supabase Edge Function (Deno) and in Jest with a mocked Groq. Free-tier only — the chain contains
 * only the configured Groq free models; there is no paid fallback and no other provider.
 */
import { buildMessages, maxTokensFor } from './prompts.ts';
import {
  AI_POLICY_VERSION,
  aiRequestSchema,
  outputSchemaFor,
  PROMPT_VERSION,
  toStrictJsonSchema,
  type AiRequest,
  type AiResponse,
  type AiTask,
} from './schemas.ts';

export const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

export type AiEnv = {
  GROQ_API_KEY: string;
  GROQ_MODEL_PRIMARY: string;
  GROQ_MODEL_LIGHT: string;
  GROQ_MODEL_BACKUP: string;
  AI_USER_DAILY_LIMIT: number;
  AI_MODEL_MIN_REMAINING_REQUESTS: number;
  AI_MODEL_MIN_REMAINING_TOKENS: number;
  AI_TIMEOUT_MS: number;
  AI_MAX_INPUT_CHARS: number;
};

export const DEFAULT_ENV: Omit<AiEnv, 'GROQ_API_KEY'> = {
  GROQ_MODEL_PRIMARY: 'openai/gpt-oss-120b',
  GROQ_MODEL_LIGHT: 'openai/gpt-oss-20b',
  GROQ_MODEL_BACKUP: 'qwen/qwen3.8-27b',
  AI_USER_DAILY_LIMIT: 20,
  AI_MODEL_MIN_REMAINING_REQUESTS: 25,
  AI_MODEL_MIN_REMAINING_TOKENS: 2500,
  AI_TIMEOUT_MS: 25_000,
  AI_MAX_INPUT_CHARS: 12_000,
};

export type ModelState = { blockedUntil: number | null };

export type AiDeps = {
  env: AiEnv;
  /** Resolves the authenticated user from the request's bearer token (null = unauthenticated). */
  getUserId: (authHeader: string | null) => Promise<string | null>;
  hasConsent: (userId: string, policyVersion: string) => Promise<boolean>;
  /** Atomically consumes one request from the user's daily allowance; false when exhausted. */
  consumeUserQuota: (userId: string, dailyLimit: number) => Promise<boolean>;
  getModelState: (model: string) => Promise<ModelState | null>;
  setModelState: (model: string, state: ModelState) => Promise<void>;
  fetch: typeof fetch;
  now: () => number;
};

type Result = { status: number; body: AiResponse };

const fail = (
  status: number,
  error: Extract<AiResponse, { ok: false }>['error'],
  message: string,
  retryAfterSeconds?: number,
): Result => ({
  status,
  body: {
    ok: false,
    error,
    message,
    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
  },
});

/** Task → ordered model chain (default first, each model at most once). */
export function modelChain(task: AiTask, env: AiEnv): string[] {
  const first =
    task === 'programme_draft' || task === 'weekly_review_narrative'
      ? env.GROQ_MODEL_PRIMARY
      : env.GROQ_MODEL_LIGHT;
  return [
    ...new Set(
      [first, env.GROQ_MODEL_PRIMARY, env.GROQ_MODEL_LIGHT, env.GROQ_MODEL_BACKUP].filter(Boolean),
    ),
  ];
}

/** Parses Groq duration strings like "2m59.56s", "7.66s", "120ms", "1h2m" into seconds. */
export function parseDuration(v: string | null): number | null {
  if (!v) return null;
  if (/^\d+(\.\d+)?$/.test(v.trim())) return Number(v);
  let total = 0;
  let matched = false;
  for (const m of v.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) {
    matched = true;
    const n = Number(m[1]);
    total += m[2] === 'h' ? n * 3600 : m[2] === 'm' ? n * 60 : m[2] === 's' ? n : n / 1000;
  }
  return matched ? total : null;
}

const isModelUnavailable = (status: number, text: string) =>
  status === 404 ||
  (status === 400 &&
    /model.*(decommission|deprecat|not.?found|does not exist|unavailable)/i.test(text));

export async function handleAiRequest(
  rawBody: string,
  authHeader: string | null,
  deps: AiDeps,
): Promise<Result> {
  const { env } = deps;
  if (!env.GROQ_API_KEY) return fail(503, 'ai_unavailable', 'AI is not configured on the server.');

  const userId = await deps.getUserId(authHeader);
  if (!userId) return fail(401, 'unauthorized', 'Sign in to use the AI coach.');

  if (rawBody.length > env.AI_MAX_INPUT_CHARS)
    return fail(413, 'too_large', 'Request is too large.');
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    return fail(400, 'invalid_request', 'Invalid request.');
  }
  const parsed = aiRequestSchema.safeParse(parsedJson);
  if (!parsed.success) return fail(400, 'invalid_request', 'Invalid request.');
  const req: AiRequest = parsed.data;

  if (
    req.policyVersion !== AI_POLICY_VERSION ||
    !(await deps.hasConsent(userId, AI_POLICY_VERSION))
  ) {
    return fail(403, 'consent_required', 'Please review and accept the AI data notice first.');
  }
  if (!(await deps.consumeUserQuota(userId, env.AI_USER_DAILY_LIMIT))) {
    return fail(
      429,
      'user_quota',
      `Daily AI limit reached (${env.AI_USER_DAILY_LIMIT} requests). Everything else keeps working.`,
    );
  }

  const outputSchema = outputSchemaFor(req);
  const jsonSchema = toStrictJsonSchema(outputSchema);
  const messages = buildMessages(req);
  let soonestRetry: number | null = null;

  for (const model of modelChain(req.task, env)) {
    const state = await deps.getModelState(model);
    if (state?.blockedUntil && state.blockedUntil > deps.now()) {
      const wait = Math.ceil((state.blockedUntil - deps.now()) / 1000);
      soonestRetry = soonestRetry === null ? wait : Math.min(soonestRetry, wait);
      continue; // circuit breaker: skip this model until its window resets
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.AI_TIMEOUT_MS);
    let res: Response;
    try {
      res = await deps.fetch(`${GROQ_BASE_URL}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${env.GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.3,
          max_completion_tokens: maxTokensFor(req),
          stream: false,
          response_format: {
            type: 'json_schema',
            json_schema: { name: `gymos_${req.task}`, strict: true, schema: jsonSchema },
          },
        }),
      });
    } catch {
      clearTimeout(timer);
      continue; // timeout or network error → next model
    }
    clearTimeout(timer);

    // Track remaining free quota from headers; pause a model before it hits the shared limit.
    const remReq = Number(res.headers.get('x-ratelimit-remaining-requests'));
    const remTok = Number(res.headers.get('x-ratelimit-remaining-tokens'));
    if (
      res.headers.has('x-ratelimit-remaining-requests') &&
      remReq < env.AI_MODEL_MIN_REMAINING_REQUESTS
    ) {
      const reset = parseDuration(res.headers.get('x-ratelimit-reset-requests')) ?? 60;
      await deps.setModelState(model, { blockedUntil: deps.now() + reset * 1000 });
    } else if (
      res.headers.has('x-ratelimit-remaining-tokens') &&
      remTok < env.AI_MODEL_MIN_REMAINING_TOKENS
    ) {
      const reset = parseDuration(res.headers.get('x-ratelimit-reset-tokens')) ?? 60;
      await deps.setModelState(model, { blockedUntil: deps.now() + reset * 1000 });
    }

    if (res.status === 429) {
      const retryAfter = parseDuration(res.headers.get('retry-after')) ?? 60;
      await deps.setModelState(model, { blockedUntil: deps.now() + retryAfter * 1000 });
      soonestRetry =
        soonestRetry === null
          ? Math.ceil(retryAfter)
          : Math.min(soonestRetry, Math.ceil(retryAfter));
      continue;
    }
    if (res.status >= 500) continue;
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (isModelUnavailable(res.status, text)) {
        await deps.setModelState(model, { blockedUntil: deps.now() + 3600_000 });
        continue;
      }
      // Other 4xx: a request problem, not capacity — do not burn other models' quota.
      return fail(502, 'server_error', 'The AI request could not be processed.');
    }

    let content: unknown;
    try {
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      content = JSON.parse(json.choices?.[0]?.message?.content ?? '');
    } catch {
      return fail(
        502,
        'invalid_output',
        'The AI returned an unreadable response. Please try again.',
      );
    }
    const out = outputSchema.safeParse(content);
    if (!out.success)
      return fail(
        502,
        'invalid_output',
        'The AI response did not pass validation and was discarded.',
      );
    return {
      status: 200,
      body: { ok: true, task: req.task, model, promptVersion: PROMPT_VERSION, output: out.data },
    };
  }

  return fail(
    503,
    'ai_unavailable',
    'AI temporarily unavailable / free quota reached. Everything else keeps working.',
    soonestRetry ?? 60,
  );
}
