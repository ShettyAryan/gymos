import { AI_POLICY_VERSION } from '../../../supabase/functions/_shared/schemas';

export { AI_POLICY_VERSION };

/**
 * In-app AI data notice. Wording reflects Groq's "Your data" page as checked on 2026-10-11
 * (see docs/FREE_TIER_LIMITS.md). Changing this text requires bumping AI_POLICY_VERSION so
 * users re-consent.
 */
export const AI_DISCLOSURE = {
  title: 'Before you use the AI coach',
  points: [
    'AI features are optional. Workout logging, programmes, progression, Adaptive Day and everything else work without them.',
    'When you ask the AI something, GymOS sends a minimal summary to Groq, a third-party AI provider, via GymOS’s server. It is processed outside your device, in the United States.',
    'What is sent: your goals, experience, schedule preferences, equipment, movements you avoid, and short summaries of your programme and recent workouts relevant to the request — plus your question.',
    'What is never sent: progress photos, your name or email, passwords, exact location, or other identifiers.',
    'Groq states it does not retain inference data by default, but inputs and outputs may be logged for up to 30 days for troubleshooting or abuse investigation. Zero Data Retention can be enabled by the GymOS operator.',
    'AI answers can be wrong and are not medical advice. AI suggestions never change your programme or history unless you approve them.',
    'The free AI service has shared daily limits; when they are reached you will see “AI temporarily unavailable”.',
  ],
  checkedOn: '2026-10-11',
} as const;
