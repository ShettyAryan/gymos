import type { SyncMeta } from '@/domain/models/types';
import { estimateOneRepMax } from '@/domain/rules/prs';
import { weekAdherence } from '@/domain/rules/schedule';
import { REVIEW_VERSION, type WeeklyFacts } from '@/domain/rules/weeklyReview';
import { weeklyReviewAward } from '@/domain/rules/xp';
import { nowIso } from '@/utils/clock';
import { addDays, type DateKey } from '@/utils/dates';

import type { SqlDb } from '../db';
import { patchEntity, queryEntities, saveEntity } from '../store';

import { getCalendar, getStreak } from './attendance';
import { applyAwards } from './awards';
import { getExerciseMap } from './exercises';
import { getProfile } from './profile';
import { listCheckins, listProgressEntries } from './progress';

export type WeeklyReview = SyncMeta & {
  id: string;
  week_start: DateKey;
  facts: WeeklyFacts;
  reflection: string | null;
  ai_narrative: unknown | null;
  ai_model: string | null;
  recorded_at: string;
};

const avg = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => typeof x === 'number');
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

/** Gathers the week's facts from local records only (no AI, no invention). */
export async function getWeeklyFacts(db: SqlDb, weekStart: DateKey): Promise<WeeklyFacts> {
  const weekEnd = addDays(weekStart, 6);
  const [calendar, profile, exercises, entries, checkins, streak] = await Promise.all([
    getCalendar(db, weekStart, weekEnd),
    getProfile(db),
    getExerciseMap(db),
    listProgressEntries(db, weekStart, weekEnd),
    listCheckins(db, weekStart, weekEnd),
    getStreak(db),
  ]);
  const occ = calendar.flatMap((d) => d.occurrences);
  const adherence = {
    ...weekAdherence(calendar),
    rescheduled: occ.filter((o) => o.outcome === 'rescheduled').length,
    habitActions: calendar.filter((d) => d.habitAction).length,
  };

  const sessions = await db.all<{
    id: string;
    title: string;
    status: string;
    session_date: string;
  }>(
    `SELECT id, title, status, session_date FROM workout_session
     WHERE deleted_at IS NULL AND session_date BETWEEN ? AND ?
       AND status IN ('completed_as_planned','completed_adapted','partially_completed')
     ORDER BY session_date`,
    [weekStart, weekEnd],
  );
  const prRows = await db.all<{ exercise_id: string; record_type: string; value: number }>(
    `SELECT pr.exercise_id, pr.record_type, pr.value FROM personal_record pr
     JOIN workout_session s ON s.id = pr.session_id
     WHERE pr.deleted_at IS NULL AND s.session_date BETWEEN ? AND ?`,
    [weekStart, weekEnd],
  );

  // Strength: best e1RM this week vs best before this week, per weighted exercise trained this week.
  const sets = await db.all<{
    exercise_id: string;
    load_kg: number | null;
    reps: number | null;
    session_date: string;
  }>(
    `SELECT ws.exercise_id, ws.load_kg, ws.reps, s.session_date FROM workout_set ws
     JOIN workout_session s ON s.id = ws.session_id
     WHERE ws.deleted_at IS NULL AND ws.is_warmup = 0 AND s.deleted_at IS NULL
       AND s.status IN ('completed_as_planned','completed_adapted','partially_completed')
       AND s.session_date <= ?`,
    [weekEnd],
  );
  const best = new Map<string, { before: number | null; week: number | null }>();
  for (const s of sets) {
    if (
      exercises.get(s.exercise_id)?.logging_type !== 'weight_reps' ||
      s.load_kg === null ||
      s.reps === null
    )
      continue;
    const e = estimateOneRepMax(s.load_kg, s.reps);
    if (e === null) continue;
    const cur = best.get(s.exercise_id) ?? { before: null, week: null };
    if (s.session_date >= weekStart) cur.week = Math.max(cur.week ?? 0, e);
    else cur.before = Math.max(cur.before ?? 0, e);
    best.set(s.exercise_id, cur);
  }
  const strength = [...best.entries()]
    .filter(([, v]) => v.week !== null && v.before !== null)
    .map(([id, v]) => ({
      exercise: exercises.get(id)?.name ?? id,
      previousBest: Math.round(v.before! * 10) / 10,
      best: Math.round(v.week! * 10) / 10,
    }))
    .sort((a, b) => b.best - b.previousBest - (a.best - a.previousBest))
    .slice(0, 5);

  const weights = entries.filter((e) => e.body_weight_kg !== null);
  return {
    version: REVIEW_VERSION,
    weekStart,
    weekEnd,
    weeklyTarget: profile?.weekly_target ?? null,
    adherence,
    adherencePct: adherence.planned ? adherence.attended / adherence.planned : null,
    sessions: sessions.map((s) => ({
      id: s.id,
      title: s.title,
      status: s.status,
      date: s.session_date,
    })),
    prs: prRows.map((p) => ({
      exercise: exercises.get(p.exercise_id)?.name ?? p.exercise_id,
      recordType: p.record_type,
      value: p.value,
    })),
    strength,
    bodyWeightKg: {
      first: weights[0]?.body_weight_kg ?? null,
      last: weights[weights.length - 1]?.body_weight_kg ?? null,
      entries: weights.length,
    },
    checkins: {
      days: checkins.length,
      avgSleepHours: avg(checkins.map((c) => c.sleep_hours)),
      avgEnergy: avg(checkins.map((c) => c.energy)),
      avgSoreness: avg(checkins.map((c) => c.soreness)),
      avgProteinG: avg(checkins.map((c) => c.protein_g)),
    },
    streak: { current: streak.current, best: streak.best },
  };
}

export async function getWeeklyReview(db: SqlDb, weekStart: DateKey): Promise<WeeklyReview | null> {
  const rows = await queryEntities<WeeklyReview>(
    db,
    'weekly_review',
    'deleted_at IS NULL AND week_start = ?',
    [weekStart],
  );
  return rows[0] ?? null;
}

/** Records (or updates) the week's review. XP is awarded once per week via its idempotency key. */
export async function recordWeeklyReview(
  db: SqlDb,
  weekStart: DateKey,
  reflection: string | null,
): Promise<WeeklyReview> {
  return db.transaction(async (tx) => {
    const facts = await getWeeklyFacts(tx, weekStart);
    const existing = await getWeeklyReview(tx, weekStart);
    const review = existing
      ? await patchEntity<WeeklyReview>(tx, 'weekly_review', existing.id, { facts, reflection })
      : await saveEntity<WeeklyReview>(tx, 'weekly_review', {
          week_start: weekStart,
          facts,
          reflection,
          ai_narrative: null,
          ai_model: null,
          recorded_at: nowIso(),
        });
    const count = await tx.first<{ n: number }>(
      'SELECT COUNT(*) AS n FROM weekly_review WHERE deleted_at IS NULL',
    );
    await applyAwards(
      tx,
      [weeklyReviewAward(review.id, weekStart)],
      (count?.n ?? 0) >= 4
        ? [
            {
              badgeKey: 'weekly_reviews_4',
              idempotencyKey: 'badge:weekly_reviews_4',
              sourceEntityId: review.id,
            },
          ]
        : [],
    );
    return review;
  });
}

export function saveReviewNarrative(db: SqlDb, id: string, narrative: unknown, model: string) {
  return patchEntity<WeeklyReview>(db, 'weekly_review', id, {
    ai_narrative: narrative,
    ai_model: model,
  });
}
