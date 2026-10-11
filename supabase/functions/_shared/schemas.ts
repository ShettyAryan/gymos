/**
 * AI request/response contract shared by the Edge Function (Deno) and the app (validation).
 * Plain TypeScript + zod only — no runtime-specific APIs — so Jest can test it directly.
 * Strict structured outputs guarantee shape only; every response is still validated here,
 * and the app additionally checks exercise IDs, ranges and safety rules before showing it.
 */
import { z } from 'zod';

export const PROMPT_VERSION = 'prompts-v1';
/** Bump when the in-app AI disclosure text changes; consent must match this version. */
export const AI_POLICY_VERSION = 'ai-policy-2026-10-11';

export const AI_TASKS = [
  'programme_draft',
  'coach_question',
  'weekly_review_narrative',
  'adaptation_explanation',
] as const;
export type AiTask = (typeof AI_TASKS)[number];

const shortText = z.string().max(600);
const list = (max: number) => z.array(shortText).max(max);

// ---------- inputs (what the app may send; minimal, no photos, no identifiers) ----------

export const profileContextSchema = z
  .object({
    goals: z.array(z.string().max(40)).max(6),
    customGoal: z.string().max(200).nullable(),
    experience: z.string().max(20).nullable(),
    sessionsPerWeek: z.number().int().min(1).max(7).nullable(),
    preferredWeekdays: z.array(z.number().int().min(0).max(6)).max(7),
    sessionMinutes: z.number().int().min(10).max(240).nullable(),
    equipment: z.array(z.string().max(30)).max(20),
    avoidPatterns: z.array(z.string().max(30)).max(20),
    limitationsNote: z.string().max(300).nullable(),
    units: z.enum(['metric', 'imperial']),
  })
  .strict();

export const catalogueItemSchema = z
  .object({
    id: z.string().max(80),
    name: z.string().max(80),
    pattern: z.string().max(30),
    muscles: z.array(z.string().max(20)).max(6),
    equipment: z.array(z.string().max(30)).max(6),
  })
  .strict();

export const programmeOutlineInput = z
  .object({ stage: z.literal('outline'), profile: profileContextSchema })
  .strict();
export const programmeDayInput = z
  .object({
    stage: z.literal('day'),
    profile: profileContextSchema,
    programmeName: z.string().max(80),
    day: z
      .object({
        title: z.string().max(60),
        focus: z.string().max(120).nullable(),
        intendedMinutes: z.number().int().min(10).max(180),
      })
      .strict(),
    otherDays: z.array(z.string().max(60)).max(7),
    catalogue: z.array(catalogueItemSchema).max(80),
  })
  .strict();

export const coachQuestionInput = z
  .object({
    question: z.string().min(1).max(800),
    context: z
      .object({
        profile: profileContextSchema.nullable(),
        programmeSummary: z.string().max(2500).nullable(),
        recentSessions: z.array(z.string().max(300)).max(12),
        weekSummary: z.string().max(1200).nullable(),
        campaign: z.string().max(300).nullable(),
      })
      .strict(),
  })
  .strict();

export const weeklyNarrativeInput = z.object({ facts: z.record(z.string(), z.unknown()) }).strict();
export const adaptationExplanationInput = z.object({ summary: z.string().max(2000) }).strict();

export const aiRequestSchema = z.discriminatedUnion('task', [
  z
    .object({
      task: z.literal('programme_draft'),
      policyVersion: z.string(),
      input: z.union([programmeOutlineInput, programmeDayInput]),
    })
    .strict(),
  z
    .object({
      task: z.literal('coach_question'),
      policyVersion: z.string(),
      input: coachQuestionInput,
    })
    .strict(),
  z
    .object({
      task: z.literal('weekly_review_narrative'),
      policyVersion: z.string(),
      input: weeklyNarrativeInput,
    })
    .strict(),
  z
    .object({
      task: z.literal('adaptation_explanation'),
      policyVersion: z.string(),
      input: adaptationExplanationInput,
    })
    .strict(),
]);
export type AiRequest = z.infer<typeof aiRequestSchema>;

// ---------- outputs (strict structured outputs; all fields required, nullable where optional) ----------

export const programmeOutlineOutput = z.object({
  programmeName: z.string().max(80),
  summary: shortText,
  rationale: shortText,
  assumptions: list(6),
  caveats: list(6),
  days: z
    .array(
      z.object({
        title: z.string().max(60),
        focus: z.string().max(120),
        weekday: z.number().int().min(0).max(6).nullable(),
        intendedMinutes: z.number().int().min(10).max(180),
      }),
    )
    .min(1)
    .max(7),
});

export const programmeDayOutput = z.object({
  rationale: shortText,
  caveats: list(4),
  exercises: z
    .array(
      z.object({
        exerciseId: z.string().max(80),
        sets: z.number().int().min(1).max(8),
        repMin: z.number().int().min(1).max(100),
        repMax: z.number().int().min(1).max(100),
        restSeconds: z.number().int().min(0).max(600),
        targetRir: z.number().int().min(0).max(5).nullable(),
        priority: z.enum(['primary', 'secondary', 'accessory']),
        alternativeIds: z.array(z.string().max(80)).max(3),
        note: z.string().max(200).nullable(),
      }),
    )
    .min(1)
    .max(12),
});

export const coachAnswerOutput = z.object({
  answer: z.string().max(2500),
  assumptions: list(5),
  caveats: list(5),
  dataGaps: list(5),
  proposedChanges: z.array(z.object({ description: shortText, rationale: shortText })).max(5),
  safetyNote: z.string().max(400).nullable(),
});

export const weeklyNarrativeOutput = z.object({
  summary: z.string().max(1200),
  highlights: list(5),
  focusNextWeek: list(3),
  caveats: list(4),
});

export const adaptationExplanationOutput = z.object({
  explanation: z.string().max(1200),
  caveats: list(4),
});

export function outputSchemaFor(req: AiRequest) {
  switch (req.task) {
    case 'programme_draft':
      return req.input.stage === 'outline' ? programmeOutlineOutput : programmeDayOutput;
    case 'coach_question':
      return coachAnswerOutput;
    case 'weekly_review_narrative':
      return weeklyNarrativeOutput;
    case 'adaptation_explanation':
      return adaptationExplanationOutput;
  }
}

export type ProgrammeOutline = z.infer<typeof programmeOutlineOutput>;
export type ProgrammeDayDraft = z.infer<typeof programmeDayOutput>;
export type CoachAnswer = z.infer<typeof coachAnswerOutput>;
export type WeeklyNarrative = z.infer<typeof weeklyNarrativeOutput>;
export type AdaptationExplanation = z.infer<typeof adaptationExplanationOutput>;

export type AiSuccess = {
  ok: true;
  task: AiTask;
  model: string;
  promptVersion: string;
  output: unknown;
};
export type AiFailure = {
  ok: false;
  error:
    | 'unauthorized'
    | 'consent_required'
    | 'invalid_request'
    | 'too_large'
    | 'user_quota'
    | 'ai_unavailable'
    | 'invalid_output'
    | 'server_error';
  message: string;
  retryAfterSeconds?: number;
};
export type AiResponse = AiSuccess | AiFailure;

type Json = { [k: string]: unknown };
const DROP = [
  '$schema',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'pattern',
  'format',
];

/**
 * Converts a zod schema to the strict JSON Schema subset used for structured outputs:
 * every property required, additionalProperties false, nullables as ["type","null"],
 * and numeric/length constraints removed (they are enforced by zod after the call).
 */
export function toStrictJsonSchema(schema: z.ZodType): Json {
  const raw = z.toJSONSchema(schema, { io: 'output' }) as Json;
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== 'object') return node;
    const n = { ...(node as Json) };
    for (const k of DROP) delete n[k];
    if (Array.isArray(n.anyOf)) {
      const parts = n.anyOf as Json[];
      const nonNull = parts.filter((p) => p.type !== 'null');
      if (parts.length === 2 && nonNull.length === 1 && typeof nonNull[0]!.type === 'string') {
        const inner = walk(nonNull[0]) as Json;
        delete n.anyOf;
        return { ...n, ...inner, type: [inner.type as string, 'null'] };
      }
      n.anyOf = parts.map(walk);
    }
    if (n.type === 'object' && n.properties) {
      const props = n.properties as Json;
      n.properties = Object.fromEntries(Object.entries(props).map(([k, v]) => [k, walk(v)]));
      n.required = Object.keys(props);
      n.additionalProperties = false;
    }
    if (n.items) n.items = walk(n.items);
    return n;
  };
  return walk(raw) as Json;
}
