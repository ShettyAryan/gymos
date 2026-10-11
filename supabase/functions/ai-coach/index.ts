// Supabase Edge Function (Deno): authenticated, consent-checked, rate-limited proxy to the
// Groq free tier. Secrets come only from function secrets; nothing is logged except error kinds.
import { createClient } from 'npm:@supabase/supabase-js@2';

import { DEFAULT_ENV, handleAiRequest, type AiEnv } from '../_shared/aiCore.ts';

const num = (k: string, d: number) => {
  const v = Number(Deno.env.get(k));
  return Number.isFinite(v) && v > 0 ? v : d;
};

const env: AiEnv = {
  GROQ_API_KEY: Deno.env.get('GROQ_API_KEY') ?? '',
  GROQ_MODEL_PRIMARY: Deno.env.get('GROQ_MODEL_PRIMARY') || DEFAULT_ENV.GROQ_MODEL_PRIMARY,
  GROQ_MODEL_LIGHT: Deno.env.get('GROQ_MODEL_LIGHT') || DEFAULT_ENV.GROQ_MODEL_LIGHT,
  GROQ_MODEL_BACKUP: Deno.env.get('GROQ_MODEL_BACKUP') || DEFAULT_ENV.GROQ_MODEL_BACKUP,
  AI_USER_DAILY_LIMIT: num('AI_USER_DAILY_LIMIT', DEFAULT_ENV.AI_USER_DAILY_LIMIT),
  AI_MODEL_MIN_REMAINING_REQUESTS: num(
    'AI_MODEL_MIN_REMAINING_REQUESTS',
    DEFAULT_ENV.AI_MODEL_MIN_REMAINING_REQUESTS,
  ),
  AI_MODEL_MIN_REMAINING_TOKENS: num(
    'AI_MODEL_MIN_REMAINING_TOKENS',
    DEFAULT_ENV.AI_MODEL_MIN_REMAINING_TOKENS,
  ),
  AI_TIMEOUT_MS: num('AI_TIMEOUT_MS', DEFAULT_ENV.AI_TIMEOUT_MS),
  AI_MAX_INPUT_CHARS: num('AI_MAX_INPUT_CHARS', DEFAULT_ENV.AI_MAX_INPUT_CHARS),
};

// Service-role client lives only inside the function (auto-provided secret); never in the app.
const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  {
    auth: { persistSession: false },
  },
);

const headers = { 'Content-Type': 'application/json' };

Deno.serve(async (req) => {
  if (req.method !== 'POST')
    return new Response(
      JSON.stringify({ ok: false, error: 'invalid_request', message: 'POST only' }),
      { status: 405, headers },
    );
  try {
    const raw = await req.text();
    const result = await handleAiRequest(raw, req.headers.get('Authorization'), {
      env,
      fetch,
      now: () => Date.now(),
      getUserId: async (auth) => {
        const token = auth?.replace(/^Bearer\s+/i, '');
        if (!token) return null;
        const { data, error } = await admin.auth.getUser(token);
        return error ? null : (data.user?.id ?? null);
      },
      hasConsent: async (userId, policyVersion) => {
        const { data } = await admin
          .from('ai_consent')
          .select('granted, policy_version')
          .eq('user_id', userId)
          .maybeSingle();
        return !!data?.granted && data.policy_version === policyVersion;
      },
      consumeUserQuota: async (userId, limit) => {
        const { data, error } = await admin.rpc('ai_try_consume', {
          p_user: userId,
          p_limit: limit,
        });
        return !error && data === true;
      },
      getModelState: async (model) => {
        const { data } = await admin
          .from('ai_model_state')
          .select('blocked_until')
          .eq('model', model)
          .maybeSingle();
        return data
          ? { blockedUntil: data.blocked_until ? Date.parse(data.blocked_until) : null }
          : null;
      },
      setModelState: async (model, s) => {
        await admin.from('ai_model_state').upsert({
          model,
          blocked_until: s.blockedUntil ? new Date(s.blockedUntil).toISOString() : null,
          updated_at: new Date().toISOString(),
        });
      },
    });
    if (!result.body.ok) console.warn(`ai-coach: ${result.body.error}`); // error kind only, never content
    return new Response(JSON.stringify(result.body), { status: result.status, headers });
  } catch {
    console.error('ai-coach: unexpected error');
    return new Response(
      JSON.stringify({ ok: false, error: 'server_error', message: 'Something went wrong.' }),
      { status: 500, headers },
    );
  }
});
