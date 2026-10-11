import {
  DEFAULT_ENV,
  handleAiRequest,
  modelChain,
  parseDuration,
  type AiDeps,
  type ModelState,
} from '../../supabase/functions/_shared/aiCore';
import {
  AI_POLICY_VERSION,
  programmeDayOutput,
  toStrictJsonSchema,
} from '../../supabase/functions/_shared/schemas';

const env = { ...DEFAULT_ENV, GROQ_API_KEY: 'test-key', AI_TIMEOUT_MS: 50 };
const coachOutput = {
  answer: 'Keep going.',
  assumptions: [],
  caveats: [],
  dataGaps: [],
  proposedChanges: [],
  safetyNote: null,
};

type Reply = {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  hang?: boolean;
  raw?: string;
};

function makeDeps(replies: Reply[], over: Partial<AiDeps> = {}) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const states = new Map<string, ModelState>();
  let t = 1_000_000;
  const deps: AiDeps = {
    env,
    getUserId: async (h) => (h === 'Bearer good' ? 'user-1' : null),
    hasConsent: async () => true,
    consumeUserQuota: async () => true,
    getModelState: async (m) => states.get(m) ?? null,
    setModelState: async (m, s) => {
      states.set(m, s);
    },
    now: () => t,
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      const r = replies.shift() ?? { status: 500 };
      if (r.hang) {
        return new Promise((_, reject) =>
          init.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
        );
      }
      const text = r.raw ?? JSON.stringify(r.body ?? {});
      return new Response(text, { status: r.status, headers: r.headers });
    }) as unknown as typeof fetch,
    ...over,
  };
  return { deps, calls, states, advance: (ms: number) => (t += ms) };
}

const ok = (output: unknown, headers: Record<string, string> = {}): Reply => ({
  status: 200,
  headers,
  body: { choices: [{ message: { content: JSON.stringify(output) } }] },
});
const body = (task = 'coach_question') =>
  JSON.stringify({
    task,
    policyVersion: AI_POLICY_VERSION,
    input: {
      question: 'How is my week?',
      context: {
        profile: null,
        programmeSummary: null,
        recentSessions: [],
        weekSummary: null,
        campaign: null,
      },
    },
  });

describe('AI proxy core', () => {
  it('rejects unauthenticated requests without calling Groq', async () => {
    const { deps, calls } = makeDeps([]);
    const r = await handleAiRequest(body(), null, deps);
    expect(r.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it('requires consent for the current policy version', async () => {
    const { deps, calls } = makeDeps([], { hasConsent: async () => false });
    expect((await handleAiRequest(body(), 'Bearer good', deps)).body).toMatchObject({
      ok: false,
      error: 'consent_required',
    });
    const stale = JSON.stringify({ ...JSON.parse(body()), policyVersion: 'old' });
    const { deps: d2 } = makeDeps([]);
    expect((await handleAiRequest(stale, 'Bearer good', d2)).status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it('validates request schema, unknown tasks and size', async () => {
    const { deps } = makeDeps([]);
    expect((await handleAiRequest('{"task":"run_sql"}', 'Bearer good', deps)).status).toBe(400);
    expect((await handleAiRequest('not json', 'Bearer good', deps)).status).toBe(400);
    expect((await handleAiRequest('x'.repeat(20_000), 'Bearer good', deps)).status).toBe(413);
    const extra = JSON.stringify({
      ...JSON.parse(body()),
      input: { ...JSON.parse(body()).input, photos: ['file://x'] },
    });
    expect((await handleAiRequest(extra, 'Bearer good', deps)).status).toBe(400); // strict: unknown fields (e.g. photos) rejected
  });

  it('enforces the per-user daily limit', async () => {
    const { deps, calls } = makeDeps([], { consumeUserQuota: async () => false });
    const r = await handleAiRequest(body(), 'Bearer good', deps);
    expect(r.status).toBe(429);
    expect(r.body).toMatchObject({ error: 'user_quota' });
    expect(calls).toHaveLength(0);
  });

  it('calls only the Groq endpoint with strict structured output and the task default model', async () => {
    const { deps, calls } = makeDeps([ok(coachOutput)]);
    const r = await handleAiRequest(body(), 'Bearer good', deps);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      ok: true,
      model: 'openai/gpt-oss-20b',
      promptVersion: 'prompts-v1',
    });
    expect(calls[0]!.url).toBe('https://api.groq.com/openai/v1/chat/completions');
    const rf = calls[0]!.body.response_format as { type: string; json_schema: { strict: boolean } };
    expect(rf.type).toBe('json_schema');
    expect(rf.json_schema.strict).toBe(true);
    expect(calls[0]!.body.stream).toBe(false);
  });

  it('falls back on 429 (honouring retry-after), then 5xx, then succeeds on the backup model', async () => {
    const { deps, calls, states } = makeDeps([
      { status: 429, headers: { 'retry-after': '7' } },
      { status: 503 },
      ok(coachOutput),
    ]);
    const r = await handleAiRequest(body(), 'Bearer good', deps);
    expect(r.status).toBe(200);
    expect(calls.map((c) => c.body.model)).toEqual([
      'openai/gpt-oss-20b',
      'openai/gpt-oss-120b',
      'qwen/qwen3.8-27b',
    ]);
    expect(r.body).toMatchObject({ model: 'qwen/qwen3.8-27b' });
    expect(states.get('openai/gpt-oss-20b')!.blockedUntil).toBe(1_000_000 + 7000);
  });

  it('falls back on timeout and on a decommissioned model', async () => {
    const { deps, calls } = makeDeps([
      { status: 0, hang: true },
      { status: 400, body: { error: { message: 'The model `x` has been decommissioned' } } },
      ok(coachOutput),
    ]);
    const r = await handleAiRequest(body(), 'Bearer good', deps);
    expect(r.status).toBe(200);
    expect(calls).toHaveLength(3);
  });

  it('when every free model fails it stops with "AI temporarily unavailable" — no paid or other provider', async () => {
    const { deps, calls } = makeDeps([
      { status: 429, headers: { 'retry-after': '30' } },
      { status: 429, headers: { 'retry-after': '12' } },
      { status: 500 },
    ]);
    const r = await handleAiRequest(body(), 'Bearer good', deps);
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ ok: false, error: 'ai_unavailable', retryAfterSeconds: 12 });
    expect(calls).toHaveLength(3); // each model at most once
    expect(calls.every((c) => c.url.startsWith('https://api.groq.com/'))).toBe(true);
  });

  it('circuit breaker skips a blocked model until its window passes', async () => {
    const { deps, calls, advance } = makeDeps([
      { status: 429, headers: { 'retry-after': '60' } },
      ok(coachOutput),
      ok(coachOutput),
      ok(coachOutput),
    ]);
    await handleAiRequest(body(), 'Bearer good', deps);
    await handleAiRequest(body(), 'Bearer good', deps);
    expect(calls.map((c) => c.body.model)).toEqual([
      'openai/gpt-oss-20b',
      'openai/gpt-oss-120b',
      'openai/gpt-oss-120b',
    ]);
    advance(61_000);
    await handleAiRequest(body(), 'Bearer good', deps);
    expect(calls[3]!.body.model).toBe('openai/gpt-oss-20b');
  });

  it('pauses a model proactively when remaining free quota headers run low', async () => {
    const { deps, states } = makeDeps([
      ok(coachOutput, {
        'x-ratelimit-remaining-requests': '3',
        'x-ratelimit-reset-requests': '2m30s',
      }),
    ]);
    await handleAiRequest(body(), 'Bearer good', deps);
    expect(states.get('openai/gpt-oss-20b')!.blockedUntil).toBe(1_000_000 + 150_000);
  });

  it('malformed or schema-invalid output is discarded (no fallback that would burn quota)', async () => {
    const bad = makeDeps([
      { status: 200, raw: '{"choices":[{"message":{"content":"not json"}}]}' },
      ok(coachOutput),
    ]);
    expect((await handleAiRequest(body(), 'Bearer good', bad.deps)).body).toMatchObject({
      error: 'invalid_output',
    });
    expect(bad.calls).toHaveLength(1);
    const wrong = makeDeps([ok({ answer: 42 })]);
    expect((await handleAiRequest(body(), 'Bearer good', wrong.deps)).body).toMatchObject({
      error: 'invalid_output',
    });
  });

  it('other 4xx errors do not fall back', async () => {
    const { deps, calls } = makeDeps([
      { status: 400, body: { error: { message: 'bad request' } } },
      ok(coachOutput),
    ]);
    expect((await handleAiRequest(body(), 'Bearer good', deps)).status).toBe(502);
    expect(calls).toHaveLength(1);
  });

  it('is unavailable (not crashing) when the API key is missing', async () => {
    const { deps } = makeDeps([], { env: { ...env, GROQ_API_KEY: '' } });
    expect((await handleAiRequest(body(), 'Bearer good', deps)).status).toBe(503);
  });

  it('programme drafts and weekly reviews default to the primary model', () => {
    expect(modelChain('programme_draft', env)[0]).toBe('openai/gpt-oss-120b');
    expect(modelChain('weekly_review_narrative', env)[0]).toBe('openai/gpt-oss-120b');
    expect(modelChain('coach_question', env)).toEqual([
      'openai/gpt-oss-20b',
      'openai/gpt-oss-120b',
      'qwen/qwen3.8-27b',
    ]);
  });

  it('parses Groq duration headers', () => {
    expect(parseDuration('7.66s')).toBeCloseTo(7.66);
    expect(parseDuration('2m59.56s')).toBeCloseTo(179.56);
    expect(parseDuration('120ms')).toBeCloseTo(0.12);
    expect(parseDuration('30')).toBe(30);
    expect(parseDuration(null)).toBeNull();
  });
});

describe('strict JSON schema conversion', () => {
  it('requires every property, forbids extras and expresses nullables as type unions', () => {
    const s = toStrictJsonSchema(programmeDayOutput) as Record<string, any>;
    expect(s.$schema).toBeUndefined();
    expect(s.additionalProperties).toBe(false);
    expect(s.required).toEqual(['rationale', 'caveats', 'exercises']);
    const item = s.properties.exercises.items;
    expect(item.additionalProperties).toBe(false);
    expect(item.required).toEqual(Object.keys(item.properties));
    expect(item.properties.targetRir.type).toEqual(['integer', 'null']);
    expect(item.properties.note.type).toEqual(['string', 'null']);
    expect(JSON.stringify(s)).not.toMatch(/"minimum"|"maxLength"|"anyOf"/);
  });
});
