import type { SqlDb } from '@/data/local/db';
import { getExerciseMap } from '@/data/local/repositories/exercises';
import { getProfile } from '@/data/local/repositories/profile';
import { addDay, addExerciseToDay, createProgramme } from '@/data/local/repositories/programmes';
import type { Programme } from '@/domain/models/types';

import type {
  ProgrammeDayDraft,
  ProgrammeOutline,
} from '../../../supabase/functions/_shared/schemas';

import { requestAi } from './aiClient';
import { catalogueFor, profileContext } from './aiContext';

export type DraftProgress = { step: string; done: number; total: number };
export type DraftResult =
  | { ok: true; programme: Programme; warnings: string[]; model: string; mock: boolean }
  | { ok: false; message: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * AI programme draft: one outline request, then one request per training day (keeps each call well
 * under the free 8,000 tokens/minute limit). Output is untrusted: unknown exercise IDs are dropped
 * with a warning, and the result is saved as a DRAFT — it never becomes active without approval.
 */
export async function generateProgrammeDraft(
  db: SqlDb,
  onProgress: (p: DraftProgress) => void,
): Promise<DraftResult> {
  const [profile, exercises] = await Promise.all([getProfile(db), getExerciseMap(db)]);
  const ctx = profileContext(profile);
  const catalogue = catalogueFor(exercises, profile);
  if (catalogue.length < 3)
    return {
      ok: false,
      message:
        'Not enough exercises match your equipment and preferences. Add equipment or custom exercises first.',
    };

  onProgress({ step: 'Planning your week…', done: 0, total: 1 });
  const outline = await requestAi<ProgrammeOutline>(db, {
    task: 'programme_draft',
    input: { stage: 'outline', profile: ctx },
  });
  if (!outline.ok) return { ok: false, message: outline.message };

  const warnings: string[] = [];
  const days: {
    title: string;
    weekday: number | null;
    minutes: number;
    focus: string;
    draft: ProgrammeDayDraft | null;
  }[] = [];
  const total = outline.output.days.length + 1;
  for (let i = 0; i < outline.output.days.length; i++) {
    const d = outline.output.days[i]!;
    onProgress({ step: `Choosing exercises for ${d.title}…`, done: i + 1, total });
    const req = {
      task: 'programme_draft' as const,
      input: {
        stage: 'day' as const,
        profile: ctx,
        programmeName: outline.output.programmeName,
        day: { title: d.title, focus: d.focus, intendedMinutes: d.intendedMinutes },
        otherDays: outline.output.days.filter((_, j) => j !== i).map((x) => x.title),
        catalogue,
      },
    };
    let res = await requestAi<ProgrammeDayDraft>(db, req);
    // Free-tier pacing: if every model is briefly rate-limited, wait once (≤ 60 s) and retry.
    if (
      !res.ok &&
      res.error === 'ai_unavailable' &&
      res.retryAfterSeconds &&
      res.retryAfterSeconds <= 60
    ) {
      onProgress({
        step: `Free AI limit reached — waiting ${res.retryAfterSeconds}s…`,
        done: i + 1,
        total,
      });
      await sleep(res.retryAfterSeconds * 1000);
      res = await requestAi<ProgrammeDayDraft>(db, req);
    }
    if (!res.ok) return { ok: false, message: `${res.message} No programme was saved.` };
    days.push({
      title: d.title,
      weekday: d.weekday,
      minutes: d.intendedMinutes,
      focus: d.focus,
      draft: res.output,
    });
  }

  const allowed = new Set(catalogue.map((c) => c.id));
  const programme = await db.transaction(async (tx) => {
    const p = await createProgramme(tx, {
      name: outline.output.programmeName,
      source: 'ai',
      goal: profile?.goals.join(', ') ?? null,
      rationale: [outline.output.rationale, ...outline.output.caveats.map((c) => `Caveat: ${c}`)]
        .join('\n')
        .slice(0, 2000),
      ai_model: outline.model,
      ai_prompt_version: outline.promptVersion,
    });
    const usedWeekdays = new Set<number>();
    for (const d of days) {
      const weekday = d.weekday !== null && !usedWeekdays.has(d.weekday) ? d.weekday : null;
      if (weekday !== null) usedWeekdays.add(weekday);
      else if (d.weekday !== null)
        warnings.push(`${d.title}: duplicate weekday removed — set it in the editor.`);
      const day = await addDay(tx, p.id, {
        title: d.title,
        weekday,
        intended_minutes: d.minutes,
        focus: d.focus,
      });
      for (const e of d.draft?.exercises ?? []) {
        if (!allowed.has(e.exerciseId)) {
          warnings.push(
            `${d.title}: the AI suggested an exercise that is not in your library ("${e.exerciseId}") — it was left out.`,
          );
          continue;
        }
        if (e.repMin > e.repMax) {
          warnings.push(`${d.title}: an invalid rep range was corrected — please review.`);
        }
        await addExerciseToDay(tx, day.id, e.exerciseId, {
          sets: e.sets,
          rep_min: Math.min(e.repMin, e.repMax),
          rep_max: Math.max(e.repMin, e.repMax),
          rest_seconds: e.restSeconds,
          target_rir: e.targetRir,
          priority: e.priority,
          alternative_ids: e.alternativeIds.filter((a) => allowed.has(a) && a !== e.exerciseId),
          notes: e.note,
        });
      }
    }
    return p;
  });
  onProgress({ step: 'Draft saved', done: total, total });
  return { ok: true, programme, warnings, model: outline.model, mock: outline.mock };
}
