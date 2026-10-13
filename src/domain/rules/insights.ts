import { addDays, diffDays, startOfWeek, type DateKey } from '@/utils/dates';

import type { Goal, LoggingType, MovementPattern, Muscle } from '../models/constants';
import type { ProgressionDecision } from './progression';
import { estimateOneRepMax } from './prs';

/**
 * Training insights (deterministic, versioned). Turns logged sets into:
 * - weekly sets per muscle vs. an evidence-informed range for the user's goal,
 * - push/pull and quad/posterior balance,
 * - per-exercise strength trend (e1RM) and progression readiness,
 * - recovery signals ("felt off" flags, same muscle trained hard on consecutive days).
 * Guidance only — not medical advice. Ranges are configurable and deliberately conservative.
 */
export const INSIGHTS_VERSION = 'insights-v1';

export const VOLUME_RANGES: Record<'hypertrophy' | 'strength' | 'general', [number, number]> = {
  // Weekly hard sets per muscle (primary = 1 set, secondary = 0.5).
  hypertrophy: [10, 20],
  strength: [6, 15],
  general: [6, 14],
};

export const TRACKED_MUSCLES: Muscle[] = [
  'chest',
  'back',
  'shoulders',
  'biceps',
  'triceps',
  'quads',
  'hamstrings',
  'glutes',
  'calves',
  'core',
];

export type InsightSet = {
  sessionId: string;
  exerciseId: string;
  date: DateKey;
  load_kg: number | null;
  reps: number | null;
  is_warmup: boolean;
  set_kind: 'normal' | 'drop';
  rpe: number | null;
  rir: number | null;
};

export type InsightExercise = {
  id: string;
  name: string;
  movement_pattern: MovementPattern;
  primary_muscles: Muscle[];
  secondary_muscles: Muscle[];
  logging_type: LoggingType;
  load_increment_kg: number | null;
};

export type VolumeStatus = 'none' | 'under' | 'low' | 'good' | 'high' | 'very_high';

export type MuscleRow = {
  muscle: Muscle;
  /** Average weekly sets over the analysed weeks. */
  weeklySets: number;
  /** Sets in the last 7 days. */
  last7: number;
  /** Average distinct training days per week for this muscle. */
  daysPerWeek: number;
  range: [number, number];
  status: VolumeStatus;
};

export type Trend = 'improving' | 'flat' | 'declining' | 'new';

export type ExerciseTrend = {
  exerciseId: string;
  name: string;
  sessions: number;
  latestE1rm: number | null;
  changePct: number | null;
  trend: Trend;
  /** Sessions in a row without beating the earlier best e1RM. */
  stalledSessions: number;
};

export type Readiness = {
  exerciseId: string;
  name: string;
  decision: ProgressionDecision;
  /** Suggested next load (kg), when the rule produced one. */
  nextLoadKg: number | null;
  currentLoadKg: number | null;
  rationale: string;
};

export type InsightCard = {
  id: string;
  tone: 'success' | 'warning' | 'danger' | 'info';
  title: string;
  body: string;
};

export type Insights = {
  version: string;
  weeksAnalysed: number;
  earlyData: boolean;
  muscles: MuscleRow[];
  trends: ExerciseTrend[];
  readiness: Readiness[];
  cards: InsightCard[];
};

export function rangeForGoals(goals: Goal[]): [number, number] {
  if (goals.includes('hypertrophy')) return VOLUME_RANGES.hypertrophy;
  if (goals.includes('strength')) return VOLUME_RANGES.strength;
  return VOLUME_RANGES.general;
}

export function volumeStatus(weekly: number, [lo, hi]: [number, number]): VolumeStatus {
  if (weekly === 0) return 'none';
  if (weekly < lo * 0.6) return 'under';
  if (weekly < lo) return 'low';
  if (weekly <= hi) return 'good';
  if (weekly <= hi * 1.3) return 'high';
  return 'very_high';
}

const countsForVolume = (s: InsightSet) => !s.is_warmup;
const isTopSet = (s: InsightSet) => !s.is_warmup && s.set_kind === 'normal';
const round1 = (v: number) => Math.round(v * 10) / 10;

/** Weekly set volume per muscle over the last `weeks` weeks ending today. */
export function muscleVolume(
  sets: InsightSet[],
  exercises: Map<string, InsightExercise>,
  today: DateKey,
  goals: Goal[],
  weeks = 4,
): { rows: MuscleRow[]; weeksAnalysed: number; earlyData: boolean } {
  const from = addDays(today, -(weeks * 7 - 1));
  const recentFrom = addDays(today, -6);
  const inWindow = sets.filter((s) => s.date >= from && s.date <= today && countsForVolume(s));
  const firstDate = inWindow.reduce<DateKey | null>(
    (m, s) => (m === null || s.date < m ? s.date : m),
    null,
  );
  // Divide by the weeks actually covered (a new user's first week is not "0.25 of normal").
  const daysCovered = firstDate ? diffDays(firstDate, today) + 1 : 0;
  const weeksAnalysed = Math.max(1, Math.min(weeks, Math.ceil(daysCovered / 7)));
  const range = rangeForGoals(goals);

  const total = new Map<Muscle, number>();
  const recent = new Map<Muscle, number>();
  const days = new Map<Muscle, Set<DateKey>>();
  for (const s of inWindow) {
    const ex = exercises.get(s.exerciseId);
    if (!ex) continue;
    const add = (m: Muscle, w: number) => {
      total.set(m, (total.get(m) ?? 0) + w);
      if (s.date >= recentFrom) recent.set(m, (recent.get(m) ?? 0) + w);
      if (w === 1) days.set(m, (days.get(m) ?? new Set()).add(s.date));
    };
    ex.primary_muscles.forEach((m) => add(m, 1));
    ex.secondary_muscles.filter((m) => !ex.primary_muscles.includes(m)).forEach((m) => add(m, 0.5));
  }

  const rows = TRACKED_MUSCLES.map((muscle): MuscleRow => {
    const weeklySets = round1((total.get(muscle) ?? 0) / weeksAnalysed);
    return {
      muscle,
      weeklySets,
      last7: round1(recent.get(muscle) ?? 0),
      daysPerWeek: round1((days.get(muscle)?.size ?? 0) / weeksAnalysed),
      range,
      status: volumeStatus(weeklySets, range),
    };
  });
  return { rows, weeksAnalysed, earlyData: daysCovered < 14 };
}

/** Best e1RM per session for weighted lifts, oldest first, and the resulting trend. */
export function exerciseTrends(
  sets: InsightSet[],
  exercises: Map<string, InsightExercise>,
): ExerciseTrend[] {
  const bySession = new Map<string, Map<string, { date: DateKey; best: number }>>();
  for (const s of sets) {
    const ex = exercises.get(s.exerciseId);
    if (
      !ex ||
      ex.logging_type !== 'weight_reps' ||
      !isTopSet(s) ||
      s.load_kg === null ||
      s.reps === null
    )
      continue;
    const e = estimateOneRepMax(s.load_kg, s.reps);
    if (e === null) continue;
    const perEx = bySession.get(s.exerciseId) ?? new Map();
    const cur = perEx.get(s.sessionId);
    if (!cur || e > cur.best) perEx.set(s.sessionId, { date: s.date, best: e });
    bySession.set(s.exerciseId, perEx);
  }
  const out: ExerciseTrend[] = [];
  for (const [exerciseId, perEx] of bySession) {
    const series = [...perEx.values()]
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .map((x) => x.best);
    const name = exercises.get(exerciseId)!.name;
    if (series.length < 3) {
      out.push({
        exerciseId,
        name,
        sessions: series.length,
        latestE1rm: series.at(-1) ?? null,
        changePct: null,
        trend: 'new',
        stalledSessions: 0,
      });
      continue;
    }
    // Compare the recent best (last 2 sessions) with the best of the 3 sessions before that.
    const recent = Math.max(...series.slice(-2));
    const earlier = Math.max(...series.slice(-5, -2));
    const changePct = round1(((recent - earlier) / earlier) * 100);
    let stalled = 0;
    let runningBest = series[0]!;
    for (const v of series.slice(1)) {
      if (v > runningBest + 1e-6) {
        runningBest = v;
        stalled = 0;
      } else stalled += 1;
    }
    out.push({
      exerciseId,
      name,
      sessions: series.length,
      latestE1rm: round1(series.at(-1)!),
      changePct,
      trend: changePct >= 1.5 ? 'improving' : changePct <= -3 ? 'declining' : 'flat',
      stalledSessions: stalled,
    });
  }
  return out.sort((a, b) => b.sessions - a.sessions);
}

export type LatestRecommendation = {
  exerciseId: string;
  decision: ProgressionDecision;
  loadKg: number | null;
  rationale: string;
};

export function readinessFrom(
  recs: LatestRecommendation[],
  lastTopLoad: Map<string, number>,
  exercises: Map<string, InsightExercise>,
): Readiness[] {
  const order: Record<ProgressionDecision, number> = {
    increase_load: 0,
    increase_reps: 1,
    repeat_target: 2,
    reduce_or_review: 3,
    insufficient_data: 4,
  };
  return recs
    .filter((r) => exercises.has(r.exerciseId))
    .map((r) => ({
      exerciseId: r.exerciseId,
      name: exercises.get(r.exerciseId)!.name,
      decision: r.decision,
      nextLoadKg: r.loadKg,
      currentLoadKg: lastTopLoad.get(r.exerciseId) ?? null,
      rationale: r.rationale,
    }))
    .sort((a, b) => order[a.decision] - order[b.decision] || a.name.localeCompare(b.name));
}

const PUSH: MovementPattern[] = ['horizontal_push', 'vertical_push'];
const PULL: MovementPattern[] = ['horizontal_pull', 'vertical_pull'];

const MUSCLE_LABEL: Record<Muscle, string> = {
  chest: 'Chest',
  back: 'Back',
  shoulders: 'Shoulders',
  biceps: 'Biceps',
  triceps: 'Triceps',
  forearms: 'Forearms',
  quads: 'Quads',
  hamstrings: 'Hamstrings',
  glutes: 'Glutes',
  calves: 'Calves',
  core: 'Core',
  cardio: 'Cardio',
};
export const muscleLabel = (m: Muscle) => MUSCLE_LABEL[m];

export function buildInsights(params: {
  sets: InsightSet[];
  exercises: Map<string, InsightExercise>;
  today: DateKey;
  goals: Goal[];
  recommendations: LatestRecommendation[];
  issueFlags: { exerciseId: string; date: DateKey }[];
}): Insights {
  const { sets, exercises, today, goals } = params;
  const vol = muscleVolume(sets, exercises, today, goals);
  const trends = exerciseTrends(sets, exercises);

  // Current load = heaviest top set in the most recent session of each exercise.
  const latest = new Map<string, { date: DateKey; load: number }>();
  for (const s of sets) {
    if (!isTopSet(s) || s.load_kg === null) continue;
    const cur = latest.get(s.exerciseId);
    if (!cur || s.date > cur.date) latest.set(s.exerciseId, { date: s.date, load: s.load_kg });
    else if (s.date === cur.date && s.load_kg > cur.load) cur.load = s.load_kg;
  }
  const lastTopLoad = new Map([...latest].map(([id, v]) => [id, v.load]));
  const readiness = readinessFrom(params.recommendations, lastTopLoad, exercises);
  const cards: InsightCard[] = [];
  const trained = vol.rows.filter((r) => r.status !== 'none');

  if (sets.length === 0) {
    cards.push({
      id: 'no-data',
      tone: 'info',
      title: 'Log a few sessions first',
      body: 'Insights appear once you have finished workouts. Two weeks of training gives a reliable picture.',
    });
    return {
      version: INSIGHTS_VERSION,
      weeksAnalysed: vol.weeksAnalysed,
      earlyData: true,
      muscles: vol.rows,
      trends,
      readiness,
      cards,
    };
  }

  // Under / over volume.
  const under = vol.rows.filter((r) => r.status === 'under' || r.status === 'none');
  const over = vol.rows.filter((r) => r.status === 'very_high');
  const high = vol.rows.filter((r) => r.status === 'high');
  if (under.length && trained.length) {
    cards.push({
      id: 'under',
      tone: 'warning',
      title: `Undertrained: ${under.map((r) => muscleLabel(r.muscle)).join(', ')}`,
      body: `These get fewer than ${Math.round(vol.rows[0]!.range[0] * 0.6)} weekly sets. Adding 2–4 sets a week (spread over 2 sessions) is usually enough to start.`,
    });
  }
  if (over.length) {
    cards.push({
      id: 'over',
      tone: 'danger',
      title: `Possibly overtrained: ${over.map((r) => muscleLabel(r.muscle)).join(', ')}`,
      body: `Well above ${vol.rows[0]!.range[1]} weekly sets. More volume isn't always better — if performance or recovery is slipping, trim a few sets here first.`,
    });
  } else if (high.length) {
    cards.push({
      id: 'high',
      tone: 'info',
      title: `High volume: ${high.map((r) => muscleLabel(r.muscle)).join(', ')}`,
      body: 'Above the usual range. Fine if you are recovering well and still progressing.',
    });
  }

  // Frequency: trained hard but only once a week.
  const onceAWeek = vol.rows.filter(
    (r) => r.weeklySets >= 6 && r.daysPerWeek > 0 && r.daysPerWeek < 1.5,
  );
  if (onceAWeek.length && !vol.earlyData) {
    cards.push({
      id: 'frequency',
      tone: 'info',
      title: 'Spread volume across the week',
      body: `${onceAWeek.map((r) => muscleLabel(r.muscle)).join(', ')} ${onceAWeek.length > 1 ? 'are' : 'is'} trained about once a week. Splitting the same sets over two sessions often helps both recovery and progress.`,
    });
  }

  // Balance.
  let push = 0;
  let pull = 0;
  let quad = 0;
  let posterior = 0;
  const from = addDays(today, -27);
  for (const s of sets) {
    if (s.date < from || !countsForVolume(s)) continue;
    const ex = exercises.get(s.exerciseId);
    if (!ex) continue;
    if (PUSH.includes(ex.movement_pattern)) push += 1;
    if (PULL.includes(ex.movement_pattern)) pull += 1;
    if (ex.primary_muscles.includes('quads')) quad += 1;
    if (ex.primary_muscles.includes('hamstrings') || ex.movement_pattern === 'hinge')
      posterior += 1;
  }
  if (push >= 6 && pull < push / 1.5) {
    cards.push({
      id: 'push-pull',
      tone: 'warning',
      title: 'More pushing than pulling',
      body: `${push} pushing vs ${pull} pulling sets in the last 4 weeks. Aim for roughly equal — add rows or pulldowns for shoulder balance.`,
    });
  }
  if (quad >= 6 && posterior < quad / 2) {
    cards.push({
      id: 'quad-ham',
      tone: 'warning',
      title: 'Quads outweigh hamstrings',
      body: `${quad} quad-focused vs ${posterior} hinge/hamstring sets. Add Romanian deadlifts, leg curls or hip thrusts.`,
    });
  }

  // Recovery signals.
  const recentFlags = params.issueFlags.filter((f) => f.date >= from);
  const flagged = new Map<string, number>();
  recentFlags.forEach((f) => flagged.set(f.exerciseId, (flagged.get(f.exerciseId) ?? 0) + 1));
  for (const [id, n] of flagged) {
    if (n >= 2) {
      cards.push({
        id: `flag-${id}`,
        tone: 'danger',
        title: `${exercises.get(id)?.name ?? 'An exercise'} felt off ${n} times`,
        body: 'Hold the load or try an alternative. If you have pain, check with a qualified professional before progressing.',
      });
    }
  }

  // Strength trend.
  const stalled = trends.filter((t) => t.stalledSessions >= 3 && t.trend !== 'improving');
  if (stalled.length) {
    cards.push({
      id: 'stalled',
      tone: 'info',
      title: `Plateau: ${stalled
        .slice(0, 3)
        .map((t) => t.name)
        .join(', ')}`,
      body: 'No new best in 3+ sessions. Options: add a rep before adding load, change the rep range for a few weeks, or reduce the load ~10% and build back up.',
    });
  }
  const improving = trends.filter((t) => t.trend === 'improving');
  if (improving.length) {
    cards.push({
      id: 'improving',
      tone: 'success',
      title: `Getting stronger: ${improving
        .slice(0, 3)
        .map((t) => t.name)
        .join(', ')}`,
      body: 'Estimated 1RM is up over your recent sessions. Keep the plan steady.',
    });
  }

  const ready = readiness.filter((r) => r.decision === 'increase_load');
  if (ready.length) {
    cards.push({
      id: 'ready',
      tone: 'success',
      title: `Ready to increase: ${ready.length} exercise${ready.length > 1 ? 's' : ''}`,
      body: 'You hit the top of your rep range on every set. See "Ready to progress" below for the suggested loads.',
    });
  }

  if (vol.earlyData) {
    cards.push({
      id: 'early',
      tone: 'info',
      title: 'Early data',
      body: 'Less than two weeks logged — these numbers will settle as you train.',
    });
  }

  return {
    version: INSIGHTS_VERSION,
    weeksAnalysed: vol.weeksAnalysed,
    earlyData: vol.earlyData,
    muscles: vol.rows,
    trends,
    readiness,
    cards,
  };
}

export type WeekPoint = { weekStart: DateKey; sessions: number; sets: number; volumeKg: number };

/** Last `weeks` ISO weeks (oldest first): sessions, working sets and load volume (kg × reps). */
export function weeklySeries(
  sessions: { id: string; date: DateKey }[],
  sets: InsightSet[],
  today: DateKey,
  weeks = 12,
): WeekPoint[] {
  const thisWeek = startOfWeek(today);
  const points: WeekPoint[] = Array.from({ length: weeks }, (_, i) => ({
    weekStart: addDays(thisWeek, -(weeks - 1 - i) * 7),
    sessions: 0,
    sets: 0,
    volumeKg: 0,
  }));
  const idx = (d: DateKey) =>
    points.findIndex((p) => d >= p.weekStart && d < addDays(p.weekStart, 7));
  for (const s of sessions) {
    const i = idx(s.date);
    if (i >= 0) points[i]!.sessions += 1;
  }
  for (const s of sets) {
    if (!countsForVolume(s)) continue;
    const i = idx(s.date);
    if (i < 0) continue;
    points[i]!.sets += 1;
    if (s.load_kg !== null && s.reps !== null) points[i]!.volumeKg += s.load_kg * s.reps;
  }
  return points.map((p) => ({ ...p, volumeKg: Math.round(p.volumeKg) }));
}
