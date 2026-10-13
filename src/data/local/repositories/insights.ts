import type { Goal } from '@/domain/models/constants';
import {
  buildInsights,
  weeklySeries,
  type InsightExercise,
  type InsightSet,
  type Insights,
  type LatestRecommendation,
  type WeekPoint,
} from '@/domain/rules/insights';
import type { ProgressionDecision } from '@/domain/rules/progression';
import { addDays, type DateKey } from '@/utils/dates';

import type { SqlDb } from '../db';

import { today as todayKey } from './attendance';
import { getExerciseMap } from './exercises';
import { getProfile } from './profile';

const COMPLETED = `('completed_as_planned','completed_adapted','partially_completed')`;

/** Sets from completed sessions since `from` (inclusive), with their session date. */
async function setsSince(db: SqlDb, from: DateKey): Promise<InsightSet[]> {
  const rows = await db.all<{
    session_id: string;
    exercise_id: string;
    session_date: string;
    load_kg: number | null;
    reps: number | null;
    is_warmup: number;
    set_kind: 'normal' | 'drop';
    rpe: number | null;
    rir: number | null;
  }>(
    `SELECT ws.session_id, ws.exercise_id, s.session_date, ws.load_kg, ws.reps, ws.is_warmup, ws.set_kind, ws.rpe, ws.rir
     FROM workout_set ws JOIN workout_session s ON s.id = ws.session_id
     WHERE ws.deleted_at IS NULL AND s.deleted_at IS NULL AND s.status IN ${COMPLETED} AND s.session_date >= ?`,
    [from],
  );
  return rows.map((r) => ({
    sessionId: r.session_id,
    exerciseId: r.exercise_id,
    date: r.session_date,
    load_kg: r.load_kg,
    reps: r.reps,
    is_warmup: r.is_warmup === 1,
    set_kind: r.set_kind ?? 'normal',
    rpe: r.rpe,
    rir: r.rir,
  }));
}

async function insightExercises(db: SqlDb): Promise<Map<string, InsightExercise>> {
  const all = await getExerciseMap(db);
  return new Map([...all].map(([id, e]) => [id, e]));
}

export async function getInsights(db: SqlDb, today: DateKey = todayKey()): Promise<Insights> {
  const [profile, exercises, sets, recRows, flags] = await Promise.all([
    getProfile(db),
    insightExercises(db),
    // 12 weeks: 4 for volume, the rest for strength trends.
    setsSince(db, addDays(today, -83)),
    db.all<{
      exercise_id: string;
      decision: ProgressionDecision;
      suggestion: string;
      rationale: string;
    }>(
      `SELECT r.exercise_id, r.decision, r.suggestion, r.rationale FROM progression_recommendation r
       WHERE r.deleted_at IS NULL AND r.status != 'dismissed'
         AND r.created_at = (SELECT MAX(created_at) FROM progression_recommendation r2
                             WHERE r2.exercise_id = r.exercise_id AND r2.deleted_at IS NULL AND r2.status != 'dismissed')`,
    ),
    db.all<{ exercise_id: string; session_date: string }>(
      `SELECT we.exercise_id, s.session_date FROM workout_exercise we JOIN workout_session s ON s.id = we.session_id
       WHERE we.deleted_at IS NULL AND we.issue_flag = 1 AND s.deleted_at IS NULL`,
    ),
  ]);
  const recommendations: LatestRecommendation[] = recRows.map((r) => {
    let loadKg: number | null = null;
    try {
      loadKg = (JSON.parse(r.suggestion) as { loadKg: number | null }).loadKg ?? null;
    } catch {
      loadKg = null;
    }
    return { exerciseId: r.exercise_id, decision: r.decision, loadKg, rationale: r.rationale };
  });
  return buildInsights({
    sets,
    exercises,
    today,
    goals: (profile?.goals ?? []) as Goal[],
    recommendations,
    issueFlags: flags.map((f) => ({ exerciseId: f.exercise_id, date: f.session_date })),
  });
}

export async function getWeeklySeries(
  db: SqlDb,
  weeks = 12,
  today: DateKey = todayKey(),
): Promise<WeekPoint[]> {
  const from = addDays(today, -(weeks * 7 + 6));
  const [sets, sessions] = await Promise.all([
    setsSince(db, from),
    db.all<{ id: string; session_date: string }>(
      `SELECT id, session_date FROM workout_session WHERE deleted_at IS NULL AND status IN ${COMPLETED} AND session_date >= ?`,
      [from],
    ),
  ]);
  return weeklySeries(
    sessions.map((s) => ({ id: s.id, date: s.session_date })),
    sets,
    today,
    weeks,
  );
}

/** e1RM per session for one exercise (oldest first), for the progress chart. */
export async function getE1rmSeries(
  db: SqlDb,
  exerciseId: string,
): Promise<{ date: DateKey; value: number }[]> {
  const rows = await db.all<{ session_date: string; load_kg: number; reps: number }>(
    `SELECT s.session_date, ws.load_kg, ws.reps FROM workout_set ws JOIN workout_session s ON s.id = ws.session_id
     WHERE ws.exercise_id = ? AND ws.deleted_at IS NULL AND ws.is_warmup = 0 AND ws.set_kind = 'normal'
       AND ws.load_kg IS NOT NULL AND ws.reps BETWEEN 1 AND 12 AND s.deleted_at IS NULL AND s.status IN ${COMPLETED}
     ORDER BY s.session_date`,
    [exerciseId],
  );
  const best = new Map<string, number>();
  for (const r of rows) {
    const e = r.reps === 1 ? r.load_kg : r.load_kg * (1 + r.reps / 30);
    best.set(r.session_date, Math.max(best.get(r.session_date) ?? 0, e));
  }
  return [...best].map(([date, value]) => ({ date, value: Math.round(value * 10) / 10 }));
}

/** Weighted exercises with at least two logged sessions, most-trained first (chart picker). */
export async function getChartableLifts(
  db: SqlDb,
): Promise<{ id: string; name: string; sessions: number }[]> {
  return db.all(
    `SELECT e.id, e.name, COUNT(DISTINCT ws.session_id) AS sessions FROM workout_set ws
     JOIN exercise e ON e.id = ws.exercise_id JOIN workout_session s ON s.id = ws.session_id
     WHERE ws.deleted_at IS NULL AND ws.is_warmup = 0 AND ws.load_kg IS NOT NULL AND e.logging_type = 'weight_reps'
       AND s.status IN ${COMPLETED}
     GROUP BY e.id HAVING sessions >= 2 ORDER BY sessions DESC, e.name LIMIT 12`,
  );
}
