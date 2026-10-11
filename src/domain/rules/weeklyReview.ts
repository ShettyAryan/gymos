import type { WeekAdherence } from './schedule';

/**
 * Weekly accountability review (FR-08). Built only from recorded data; suggestions are
 * deterministic and explicitly labelled as interpretation, separate from facts.
 */
export const REVIEW_VERSION = 'review-v1';

export type WeeklyFacts = {
  version: string;
  weekStart: string;
  weekEnd: string;
  weeklyTarget: number | null;
  adherence: WeekAdherence & { rescheduled: number; habitActions: number };
  /** attended / planned (null when nothing was planned). */
  adherencePct: number | null;
  sessions: { id: string; title: string; status: string; date: string }[];
  prs: { exercise: string; recordType: string; value: number }[];
  strength: { exercise: string; previousBest: number; best: number }[];
  bodyWeightKg: { first: number | null; last: number | null; entries: number };
  checkins: {
    days: number;
    avgSleepHours: number | null;
    avgEnergy: number | null;
    avgSoreness: number | null;
    avgProteinG: number | null;
  };
  streak: { current: number; best: number };
};

export type ReviewNote = { kind: 'fact' | 'interpretation'; text: string };

const round1 = (v: number) => Math.round(v * 10) / 10;

export function reviewNotes(f: WeeklyFacts): ReviewNote[] {
  const notes: ReviewNote[] = [];
  const a = f.adherence;
  if (a.planned > 0) {
    notes.push({
      kind: 'fact',
      text: `${a.attended} of ${a.planned} planned sessions attended${a.adapted ? ` (${a.adapted} adapted)` : ''}${a.partial ? `, ${a.partial} partial` : ''}.`,
    });
  } else {
    notes.push({ kind: 'fact', text: 'No sessions were planned this week.' });
  }
  if (a.extra)
    notes.push({
      kind: 'fact',
      text: `${a.extra} extra session${a.extra > 1 ? 's' : ''} outside the plan.`,
    });
  if (a.rescheduled)
    notes.push({
      kind: 'fact',
      text: `${a.rescheduled} session${a.rescheduled > 1 ? 's' : ''} rescheduled.`,
    });
  if (a.habitActions)
    notes.push({
      kind: 'fact',
      text: `${a.habitActions} habit action${a.habitActions > 1 ? 's' : ''} recorded (not counted as workouts).`,
    });
  if (f.prs.length)
    notes.push({
      kind: 'fact',
      text: `${f.prs.length} personal record${f.prs.length > 1 ? 's' : ''}: ${[...new Set(f.prs.map((p) => p.exercise))].join(', ')}.`,
    });
  if (f.bodyWeightKg.first !== null && f.bodyWeightKg.last !== null && f.bodyWeightKg.entries > 1) {
    const d = round1(f.bodyWeightKg.last - f.bodyWeightKg.first);
    notes.push({
      kind: 'fact',
      text: `Body weight changed by ${d > 0 ? '+' : ''}${d} kg across ${f.bodyWeightKg.entries} entries (day-to-day fluctuation is normal).`,
    });
  }
  if (f.checkins.avgSleepHours !== null)
    notes.push({
      kind: 'fact',
      text: `Average logged sleep: ${round1(f.checkins.avgSleepHours)} h over ${f.checkins.days} day(s).`,
    });

  // Interpretation — clearly labelled, never presented as fact.
  if (f.weeklyTarget && a.attended >= f.weeklyTarget) {
    notes.push({
      kind: 'interpretation',
      text: 'You met your weekly commitment. Keep the same plan next week rather than adding volume.',
    });
  } else if (a.planned >= 2 && f.adherencePct !== null && f.adherencePct < 0.5) {
    notes.push({
      kind: 'interpretation',
      text: 'Fewer than half of planned sessions happened. On busy days, try Adaptive Day for a shorter session, or consider a lower weekly commitment you can sustain.',
    });
  }
  if (a.adapted > 0)
    notes.push({
      kind: 'interpretation',
      text: 'Adapting instead of skipping kept your routine going — that is the habit that compounds.',
    });
  if (a.missed > 0 && a.planned > 0)
    notes.push({
      kind: 'interpretation',
      text: 'For sessions that did not happen, rescheduling early in the week is often easier than catching up later. Deferred work does not need to be crammed in.',
    });
  if (f.checkins.avgSleepHours !== null && f.checkins.avgSleepHours < 6) {
    notes.push({
      kind: 'interpretation',
      text: 'Logged sleep was on the low side. This is context only, not a diagnosis; if you feel unwell, consider professional advice.',
    });
  }
  if (f.checkins.avgSoreness !== null && f.checkins.avgSoreness >= 4) {
    notes.push({
      kind: 'interpretation',
      text: 'Soreness was reported as high. Progression suggestions stay conservative; never train through pain.',
    });
  }
  return notes;
}
