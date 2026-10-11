import type { SqlDb } from '@/data/local/db';
import { hasValidConsent } from '@/data/local/repositories/aiConsent';
import { getPreferences } from '@/data/local/repositories/settings';
import { isCloudConfigured } from '@/data/remote/config';
import { getSupabase } from '@/data/remote/supabaseClient';

import {
  AI_POLICY_VERSION,
  aiRequestSchema,
  outputSchemaFor,
  PROMPT_VERSION,
  type AiFailure,
  type AiRequest,
} from '../../../supabase/functions/_shared/schemas';

import { MOCK_MODEL, mockAiOutput } from './mockAi';

export type AiResult<T> =
  { ok: true; output: T; model: string; promptVersion: string; mock: boolean } | AiFailure;

const CLIENT_TIMEOUT_MS = 40_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/**
 * Sends one AI request through the authenticated Edge Function (or the dev mock). Never called from
 * the logging path. The response is treated as untrusted: validated again here with zod; callers
 * apply domain validation (exercise IDs, ranges, safety) before showing anything as a suggestion.
 */
export async function requestAi<T>(
  db: SqlDb,
  req: Omit<AiRequest, 'policyVersion'>,
): Promise<AiResult<T>> {
  const prefs = await getPreferences(db);
  if (!prefs.aiEnabled || !(await hasValidConsent(db, AI_POLICY_VERSION))) {
    return {
      ok: false,
      error: 'consent_required',
      message: 'Enable the AI coach and accept the data notice first (Profile → AI coach).',
    };
  }
  const full = aiRequestSchema.safeParse({ ...req, policyVersion: AI_POLICY_VERSION });
  if (!full.success)
    return {
      ok: false,
      error: 'invalid_request',
      message: 'That request is too large or incomplete.',
    };
  const schema = outputSchemaFor(full.data);

  if (prefs.mockAi) {
    const out = schema.safeParse(mockAiOutput(full.data));
    if (!out.success)
      return { ok: false, error: 'invalid_output', message: 'Mock output failed validation.' };
    return {
      ok: true,
      output: out.data as T,
      model: MOCK_MODEL,
      promptVersion: PROMPT_VERSION,
      mock: true,
    };
  }

  const sb = getSupabase();
  if (!isCloudConfigured() || !sb) {
    return {
      ok: false,
      error: 'ai_unavailable',
      message:
        'The AI coach needs the GymOS cloud backend, which is not configured in this build. Everything else works offline.',
    };
  }
  const { data: session } = await sb.auth.getSession();
  if (!session.session)
    return {
      ok: false,
      error: 'unauthorized',
      message: 'Sign in (Profile → Cloud backup) to use the AI coach.',
    };

  try {
    const { data, error } = await withTimeout(
      sb.functions.invoke('ai-coach', { body: full.data }),
      CLIENT_TIMEOUT_MS,
    );
    let body: unknown = data;
    if (error) {
      const ctx = (error as { context?: Response }).context;
      body = ctx && typeof ctx.json === 'function' ? await ctx.json().catch(() => null) : null;
      if (!body)
        return {
          ok: false,
          error: 'ai_unavailable',
          message:
            'AI temporarily unavailable. Please try again later — everything else keeps working.',
        };
    }
    const b = body as {
      ok?: boolean;
      output?: unknown;
      model?: string;
      promptVersion?: string;
    } & Partial<AiFailure>;
    if (!b?.ok) {
      return {
        ok: false,
        error: b?.error ?? 'server_error',
        message: b?.message ?? 'AI request failed.',
        retryAfterSeconds: b?.retryAfterSeconds,
      };
    }
    const out = schema.safeParse(b.output);
    if (!out.success)
      return {
        ok: false,
        error: 'invalid_output',
        message: 'The AI response did not pass validation and was discarded.',
      };
    return {
      ok: true,
      output: out.data as T,
      model: b.model ?? 'unknown',
      promptVersion: b.promptVersion ?? PROMPT_VERSION,
      mock: false,
    };
  } catch {
    return {
      ok: false,
      error: 'ai_unavailable',
      message: 'AI temporarily unavailable (network or timeout). Everything else keeps working.',
    };
  }
}

/** Upserts the consent decision server-side so the Edge Function can verify it. */
export async function syncConsentToServer(granted: boolean): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { data } = await sb.auth.getSession();
  if (!data.session) return;
  await sb.from('ai_consent').upsert({
    user_id: data.session.user.id,
    granted,
    policy_version: AI_POLICY_VERSION,
    decided_at: new Date().toISOString(),
  });
}
