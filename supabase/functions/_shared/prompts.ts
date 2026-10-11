/**
 * Versioned prompt templates (PROMPT_VERSION in schemas.ts). The long system prompt is static and
 * first so Groq prompt caching can apply; per-request data follows as compact JSON.
 */
import type { AiRequest } from './schemas.ts';

export const SYSTEM_PROMPT = `You are the GymOS training assistant inside a personal fitness app.
Rules you must always follow:
- You assist; the app's deterministic rules own workout records, progression, scheduling and XP. Your output is a suggestion the user reviews and approves.
- Use ONLY the data provided in the request. Never invent workouts, numbers, dates, PRs or history. If data is missing, say so in dataGaps/caveats.
- Health and safety: no diagnosis, no injury treatment, never advise training through pain or concerning symptoms. If pain, injury, illness, dizziness or chest symptoms are mentioned, recommend stopping and consulting a qualified professional.
- Do not encourage excessive volume, extreme dieting, dehydration or rapid weight loss.
- Do not claim to have observed technique or form.
- Be concise, practical and supportive; avoid guilt or shame.
- Respond with JSON that matches the provided schema exactly.`;

const TASK_INSTRUCTIONS: Record<string, string> = {
  programme_outline:
    'Draft a training programme OUTLINE (days only, no exercises) that fits the profile: goals, experience, sessions per week, preferred weekdays (0=Sunday..6=Saturday), session length and equipment. Use at most sessionsPerWeek days. Prefer preferred weekdays; leave rest days between hard sessions where possible. Explain the rationale and list assumptions and caveats.',
  programme_day:
    'Choose exercises for ONE training day. You MUST use exerciseId values from the provided catalogue only — never invent IDs. Respect the equipment list and avoid the listed movement patterns. Order primary compound work first; mark accessories as "accessory". Keep the day realistic for intendedMinutes including rest. alternativeIds must also come from the catalogue. Use conservative set counts appropriate to experience.',
  coach_question:
    'Answer the user question using only the provided context. If the question needs data that is not provided, say what is missing in dataGaps. If you suggest programme changes, put them in proposedChanges as suggestions (they will only apply if the user approves). Use safetyNote when the question touches pain, injury, illness or medical topics; otherwise null.',
  weekly_review_narrative:
    'Write a short, supportive weekly review narrative from the provided facts only. Distinguish adapted or partial sessions from completed-as-planned ones. Do not add facts that are not in the input. Give at most three focus points for next week that do not simply add more volume.',
  adaptation_explanation:
    'Explain in plain language why this adapted session looks the way it does, using only the provided summary. Do not change the proposal.',
};

export function buildMessages(req: AiRequest): { role: 'system' | 'user'; content: string }[] {
  const key =
    req.task === 'programme_draft'
      ? req.input.stage === 'outline'
        ? 'programme_outline'
        : 'programme_day'
      : req.task;
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `${TASK_INSTRUCTIONS[key]}\n\nINPUT JSON:\n${JSON.stringify(req.input)}`,
    },
  ];
}

/** Output token budget per task — keeps input + output well under the 8,000 TPM free limit. */
export function maxTokensFor(req: AiRequest): number {
  switch (req.task) {
    case 'programme_draft':
      return req.input.stage === 'outline' ? 900 : 1400;
    case 'coach_question':
      return 1200;
    case 'weekly_review_narrative':
      return 700;
    case 'adaptation_explanation':
      return 500;
  }
}
