import type {
  DaySnapshot,
  Exercise,
  ExerciseTarget,
  SessionStatus,
  WorkoutExercise,
  WorkoutSession,
  WorkoutSet,
} from '@/domain/models/types';
import type { AdaptationReason, AdaptiveProposal, Energy } from '@/domain/rules/adaptiveDay';
import { recommendProgression, type ProgressionResult } from '@/domain/rules/progression';
import { detectPersonalRecords, type PrCandidate } from '@/domain/rules/prs';
import {
  assertTransition,
  classifyCompletion,
  COMPLETED_STATUSES,
} from '@/domain/rules/sessionState';
import { sessionAwards } from '@/domain/rules/xp';
import { validateSetValues, type SetValues } from '@/domain/validation/set';
import { now, nowIso } from '@/utils/clock';
import { toDateKey, type DateKey } from '@/utils/dates';

import type { SqlDb } from '../db';
import { getEntity, patchEntity, queryEntities, saveEntity } from '../store';

import { applyAwards, type BadgeAward, type XpEvent } from './awards';
import { getStreak, recordPlannedOutcome } from './attendance';
import { getExerciseMap } from './exercises';

export class ActiveSessionExistsError extends Error {
  constructor(public sessionId: string) {
    super('A workout is already in progress. Finish or cancel it first.');
    this.name = 'ActiveSessionExistsError';
  }
}

export class NoSetsLoggedError extends Error {
  constructor() {
    super('No working sets were logged. Log at least one set, or cancel the session.');
    this.name = 'NoSetsLoggedError';
  }
}

const COMPLETED_SQL = `('completed_as_planned','completed_adapted','partially_completed')`;

export type StartSessionInput =
  | { kind: 'freeform'; title?: string }
  | {
      kind: 'planned';
      programmeId: string;
      versionId: string;
      day: DaySnapshot;
      /** null = started off-schedule from the programme (recorded as extra attendance). */
      plannedDate: DateKey | null;
    }
  | {
      kind: 'adapted';
      programmeId: string;
      versionId: string;
      day: DaySnapshot;
      plannedDate: DateKey;
      proposal: AdaptiveProposal;
      reason: AdaptationReason | null;
      reasonNote: string | null;
      constraints: { availableMinutes: number; equipment: string[]; energy: Energy | null };
    };

export async function getActiveSession(db: SqlDb): Promise<WorkoutSession | null> {
  const rows = await queryEntities<WorkoutSession>(
    db,
    'workout_session',
    "status = 'in_progress' AND deleted_at IS NULL",
  );
  return rows[0] ?? null;
}

/**
 * Starts a session. Planned/adapted sessions keep an immutable copy of the original programme day
 * (`original_plan_snapshot`) separate from what will actually be performed (workout_exercise rows).
 */
export async function startSession(db: SqlDb, input: StartSessionInput): Promise<WorkoutSession> {
  return db.transaction(async (tx) => {
    const active = await getActiveSession(tx);
    if (active) throw new ActiveSessionExistsError(active.id);
    const startedAt = nowIso();
    const sessionDate = toDateKey(now());

    if (input.kind === 'freeform') {
      return saveEntity<WorkoutSession>(tx, 'workout_session', {
        programme_id: null,
        programme_version_id: null,
        planned_day_id: null,
        planned_date: null,
        session_date: sessionDate,
        session_type: 'freeform',
        status: 'in_progress',
        title: input.title?.trim() || 'Freeform workout',
        started_at: startedAt,
        completed_at: null,
        paused_at: null,
        paused_seconds: 0,
        actual_duration_seconds: null,
        adaptation_reason: null,
        adaptation: null,
        original_plan_snapshot: null,
        notes: null,
      });
    }

    if (input.kind === 'adapted' && !input.proposal.feasible) {
      throw new Error(
        'This adaptation is not feasible. Choose reschedule or a habit action instead.',
      );
    }

    const session = await saveEntity<WorkoutSession>(tx, 'workout_session', {
      programme_id: input.programmeId,
      programme_version_id: input.versionId,
      planned_day_id: input.day.id,
      planned_date: input.plannedDate,
      session_date: sessionDate,
      session_type: input.kind,
      status: 'in_progress',
      title: input.kind === 'adapted' ? input.proposal.title : input.day.title,
      started_at: startedAt,
      completed_at: null,
      paused_at: null,
      paused_seconds: 0,
      actual_duration_seconds: null,
      adaptation_reason: input.kind === 'adapted' ? input.reason : null,
      adaptation:
        input.kind === 'adapted'
          ? {
              proposal: input.proposal,
              constraints: input.constraints,
              reasonNote: input.reasonNote,
            }
          : null,
      original_plan_snapshot: structuredCloneSafe(input.day),
      notes: null,
    });

    if (input.kind === 'planned') {
      const planned = [...input.day.exercises].sort((a, b) => a.order - b.order);
      for (let i = 0; i < planned.length; i++) {
        const p = planned[i]!;
        await saveEntity<WorkoutExercise>(tx, 'workout_exercise', {
          session_id: session.id,
          exercise_id: p.exerciseId,
          source_programme_exercise_id: p.programmeExerciseId,
          ex_order: i,
          disposition: 'included',
          substitution_reason: null,
          replaced_exercise_id: null,
          target: {
            sets: p.sets,
            repMin: p.repMin,
            repMax: p.repMax,
            restSeconds: p.restSeconds,
            targetRir: p.targetRir,
            priority: p.priority,
          },
          issue_flag: false,
          notes: null,
        });
      }
    } else {
      const items = [...input.proposal.items].sort((a, b) => a.order - b.order);
      for (let i = 0; i < items.length; i++) {
        const it = items[i]!;
        const active = it.disposition === 'included' || it.disposition === 'substituted';
        await saveEntity<WorkoutExercise>(tx, 'workout_exercise', {
          session_id: session.id,
          exercise_id: active ? it.exerciseId! : it.plannedExerciseId,
          source_programme_exercise_id: it.programmeExerciseId,
          ex_order: i,
          disposition: it.disposition,
          substitution_reason: it.reasons.join(' ') || null,
          replaced_exercise_id: it.disposition === 'substituted' ? it.plannedExerciseId : null,
          target: { ...it.target, sets: active ? it.proposedSets : it.plannedSets },
          issue_flag: false,
          notes: null,
        });
      }
    }
    return session;
  });
}

function structuredCloneSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export type SessionItem = {
  we: WorkoutExercise;
  exercise: Exercise | undefined;
  sets: WorkoutSet[];
};
export type SessionDetail = { session: WorkoutSession; items: SessionItem[] };

export async function getSessionDetail(
  db: SqlDb,
  sessionId: string,
): Promise<SessionDetail | null> {
  const session = await getEntity<WorkoutSession>(db, 'workout_session', sessionId);
  if (!session || session.deleted_at) return null;
  const [wes, sets, exercises] = await Promise.all([
    queryEntities<WorkoutExercise>(
      db,
      'workout_exercise',
      'session_id = ? AND deleted_at IS NULL',
      [sessionId],
      'ex_order',
    ),
    queryEntities<WorkoutSet>(
      db,
      'workout_set',
      'session_id = ? AND deleted_at IS NULL',
      [sessionId],
      'set_order',
    ),
    getExerciseMap(db),
  ]);
  return {
    session,
    items: wes.map((we) => ({
      we,
      exercise: exercises.get(we.exercise_id),
      sets: sets.filter((s) => s.workout_exercise_id === we.id),
    })),
  };
}

async function requireSession(db: SqlDb, sessionId: string): Promise<WorkoutSession> {
  const s = await getEntity<WorkoutSession>(db, 'workout_session', sessionId);
  if (!s || s.deleted_at) throw new Error('Session not found.');
  return s;
}

async function requireInProgress(db: SqlDb, sessionId: string): Promise<WorkoutSession> {
  const s = await requireSession(db, sessionId);
  if (s.status !== 'in_progress') throw new Error('This session is no longer in progress.');
  return s;
}

/**
 * Logs one set. Persisted (with its outbox entry) before the promise resolves, so the UI only
 * shows success for data that is already on disk. No network or AI involvement.
 */
export async function logSet(
  db: SqlDb,
  workoutExerciseId: string,
  values: SetValues,
): Promise<WorkoutSet> {
  return db.transaction(async (tx) => {
    const we = await getEntity<WorkoutExercise>(tx, 'workout_exercise', workoutExerciseId);
    if (!we || we.deleted_at) throw new Error('Exercise not found in this session.');
    await requireInProgress(tx, we.session_id);
    const ex = await getEntity<Exercise>(tx, 'exercise', we.exercise_id);
    const err = validateSetValues(ex?.logging_type ?? 'weight_reps', values);
    if (err) throw new Error(err);
    if (we.disposition === 'deferred' || we.disposition === 'removed') {
      await patchEntity<WorkoutExercise>(tx, 'workout_exercise', we.id, {
        disposition: we.replaced_exercise_id ? 'substituted' : 'included',
      });
    }
    const max = await tx.first<{ m: number | null }>(
      'SELECT MAX(set_order) AS m FROM workout_set WHERE workout_exercise_id = ?',
      [we.id],
    );
    return saveEntity<WorkoutSet>(tx, 'workout_set', {
      workout_exercise_id: we.id,
      session_id: we.session_id,
      exercise_id: we.exercise_id,
      set_order: (max?.m ?? -1) + 1,
      ...values,
      completed_at: nowIso(),
    });
  });
}

/** Edits a logged set. Also allowed after completion; the version bump makes corrections auditable. */
export async function updateSet(db: SqlDb, setId: string, values: SetValues): Promise<WorkoutSet> {
  return db.transaction(async (tx) => {
    const set = await getEntity<WorkoutSet>(tx, 'workout_set', setId);
    if (!set || set.deleted_at) throw new Error('Set not found.');
    const ex = await getEntity<Exercise>(tx, 'exercise', set.exercise_id);
    const err = validateSetValues(ex?.logging_type ?? 'weight_reps', values);
    if (err) throw new Error(err);
    return patchEntity<WorkoutSet>(tx, 'workout_set', setId, values);
  });
}

export async function deleteSet(db: SqlDb, setId: string): Promise<void> {
  await patchEntity<WorkoutSet>(db, 'workout_set', setId, { deleted_at: nowIso() });
}

/** Undo for an accidental delete. */
export async function restoreSet(db: SqlDb, setId: string): Promise<void> {
  await patchEntity<WorkoutSet>(db, 'workout_set', setId, { deleted_at: null });
}

export async function addExerciseToSession(
  db: SqlDb,
  sessionId: string,
  exerciseId: string,
): Promise<WorkoutExercise> {
  return db.transaction(async (tx) => {
    await requireInProgress(tx, sessionId);
    const ex = await getEntity<Exercise>(tx, 'exercise', exerciseId);
    if (!ex || ex.deleted_at) throw new Error('Exercise not found.');
    const max = await tx.first<{ m: number | null }>(
      'SELECT MAX(ex_order) AS m FROM workout_exercise WHERE session_id = ?',
      [sessionId],
    );
    return saveEntity<WorkoutExercise>(tx, 'workout_exercise', {
      session_id: sessionId,
      exercise_id: exerciseId,
      source_programme_exercise_id: null,
      ex_order: (max?.m ?? -1) + 1,
      disposition: 'included',
      substitution_reason: null,
      replaced_exercise_id: null,
      target: null,
      issue_flag: false,
      notes: null,
    });
  });
}

async function workingSetCount(db: SqlDb, weId: string): Promise<number> {
  const r = await db.first<{ n: number }>(
    'SELECT COUNT(*) AS n FROM workout_set WHERE workout_exercise_id = ? AND deleted_at IS NULL AND is_warmup = 0',
    [weId],
  );
  return r?.n ?? 0;
}

/**
 * Swap an exercise mid-session. Before any sets: the row becomes "substituted" in place.
 * After sets were logged: the logged work stays with the original exercise and a new
 * substituted row is added for the remaining sets.
 */
export async function substituteExercise(
  db: SqlDb,
  weId: string,
  newExerciseId: string,
  reason: string | null,
): Promise<WorkoutExercise> {
  return db.transaction(async (tx) => {
    const we = await getEntity<WorkoutExercise>(tx, 'workout_exercise', weId);
    if (!we) throw new Error('Exercise not found in this session.');
    await requireInProgress(tx, we.session_id);
    if (newExerciseId === we.exercise_id) return we;
    const logged = await workingSetCount(tx, weId);
    const why = reason ?? 'Substituted during the workout.';
    if (logged === 0) {
      return patchEntity<WorkoutExercise>(tx, 'workout_exercise', weId, {
        exercise_id: newExerciseId,
        replaced_exercise_id: we.replaced_exercise_id ?? we.exercise_id,
        disposition: 'substituted',
        substitution_reason: why,
      });
    }
    const remaining: ExerciseTarget | null = we.target
      ? { ...we.target, sets: Math.max(1, we.target.sets - logged) }
      : null;
    if (we.target)
      await patchEntity<WorkoutExercise>(tx, 'workout_exercise', weId, {
        target: { ...we.target, sets: logged },
      });
    await tx.run(
      'UPDATE workout_exercise SET ex_order = ex_order + 1 WHERE session_id = ? AND ex_order > ?',
      [we.session_id, we.ex_order],
    );
    return saveEntity<WorkoutExercise>(tx, 'workout_exercise', {
      session_id: we.session_id,
      exercise_id: newExerciseId,
      source_programme_exercise_id: we.source_programme_exercise_id,
      ex_order: we.ex_order + 1,
      disposition: 'substituted',
      substitution_reason: why,
      replaced_exercise_id: we.exercise_id,
      target: remaining,
      issue_flag: false,
      notes: null,
    });
  });
}

/** "Skip for today": only possible before any working set is logged. */
export async function deferExercise(db: SqlDb, weId: string, reason: string | null): Promise<void> {
  await db.transaction(async (tx) => {
    const we = await getEntity<WorkoutExercise>(tx, 'workout_exercise', weId);
    if (!we) throw new Error('Exercise not found in this session.');
    await requireInProgress(tx, we.session_id);
    if ((await workingSetCount(tx, weId)) > 0)
      throw new Error('Sets were already logged for this exercise.');
    await patchEntity<WorkoutExercise>(tx, 'workout_exercise', weId, {
      disposition: 'deferred',
      substitution_reason: reason ?? 'Skipped during the workout.',
    });
  });
}

export async function undeferExercise(db: SqlDb, weId: string): Promise<void> {
  const we = await getEntity<WorkoutExercise>(db, 'workout_exercise', weId);
  if (!we) return;
  await patchEntity<WorkoutExercise>(db, 'workout_exercise', weId, {
    disposition: we.replaced_exercise_id ? 'substituted' : 'included',
  });
}

export function setIssueFlag(db: SqlDb, weId: string, flag: boolean) {
  return patchEntity<WorkoutExercise>(db, 'workout_exercise', weId, { issue_flag: flag });
}

export function setExerciseNotes(db: SqlDb, weId: string, notes: string | null) {
  return patchEntity<WorkoutExercise>(db, 'workout_exercise', weId, { notes });
}

export async function pauseSession(db: SqlDb, sessionId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const s = await requireInProgress(tx, sessionId);
    if (!s.paused_at)
      await patchEntity<WorkoutSession>(tx, 'workout_session', sessionId, { paused_at: nowIso() });
  });
}

export async function resumeSession(db: SqlDb, sessionId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const s = await requireInProgress(tx, sessionId);
    if (!s.paused_at) return;
    const pausedFor = Math.max(
      0,
      Math.round((now().getTime() - new Date(s.paused_at).getTime()) / 1000),
    );
    await patchEntity<WorkoutSession>(tx, 'workout_session', sessionId, {
      paused_at: null,
      paused_seconds: s.paused_seconds + pausedFor,
    });
  });
}

/** Active (unpaused) elapsed seconds. */
export function elapsedSeconds(s: WorkoutSession, at: Date = now()): number {
  if (!s.started_at) return 0;
  const end = s.completed_at ? new Date(s.completed_at) : at;
  const pausedNow =
    s.paused_at && !s.completed_at ? (at.getTime() - new Date(s.paused_at).getTime()) / 1000 : 0;
  return Math.max(
    0,
    Math.round(
      (end.getTime() - new Date(s.started_at).getTime()) / 1000 - s.paused_seconds - pausedNow,
    ),
  );
}

export async function cancelSession(db: SqlDb, sessionId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const s = await requireSession(tx, sessionId);
    assertTransition(s.status, 'cancelled');
    await patchEntity<WorkoutSession>(tx, 'workout_session', sessionId, {
      status: 'cancelled',
      completed_at: nowIso(),
      paused_at: null,
      actual_duration_seconds: elapsedSeconds(s),
    });
  });
}

export type FinishResult = {
  session: WorkoutSession;
  prs: (PrCandidate & { exerciseId: string })[];
  recommendations: (ProgressionResult & { exerciseId: string })[];
  awards: { xp: XpEvent[]; badges: BadgeAward[] };
};

/** Previous working sets for an exercise from completed sessions (excluding one session). */
async function priorSetsFor(
  db: SqlDb,
  exerciseId: string,
  excludeSessionId: string,
): Promise<WorkoutSet[]> {
  return queryEntities<WorkoutSet>(
    db,
    'workout_set',
    `exercise_id = ? AND deleted_at IS NULL AND session_id != ? AND session_id IN
       (SELECT id FROM workout_session WHERE status IN ${COMPLETED_SQL} AND deleted_at IS NULL)`,
    [exerciseId, excludeSessionId],
  );
}

/**
 * Completes a session in ONE transaction: status from actual logged sets, PRs, progression
 * recommendations (pending, never auto-applied), attendance, and idempotent XP/badges.
 */
export async function finishSession(
  db: SqlDb,
  sessionId: string,
  opts: { notes?: string | null } = {},
): Promise<FinishResult> {
  return db.transaction(async (tx) => {
    const detail = await getSessionDetail(tx, sessionId);
    if (!detail) throw new Error('Session not found.');
    const { session, items } = detail;
    if (session.status !== 'in_progress') throw new Error('This session is already finished.');

    const working = (sets: WorkoutSet[]) => sets.filter((s) => !s.is_warmup);
    const status = classifyCompletion(
      session.session_type,
      items.map((i) => ({
        disposition: i.we.disposition,
        targetSets: i.we.target?.sets ?? null,
        loggedWorkingSets: working(i.sets).length,
      })),
    );
    if (!status) throw new NoSetsLoggedError();
    assertTransition(session.status, status);

    const completedAt = nowIso();
    const finished = await patchEntity<WorkoutSession>(tx, 'workout_session', sessionId, {
      status,
      completed_at: completedAt,
      paused_at: null,
      paused_seconds: session.paused_at
        ? session.paused_seconds +
          Math.max(0, Math.round((now().getTime() - new Date(session.paused_at).getTime()) / 1000))
        : session.paused_seconds,
      actual_duration_seconds: elapsedSeconds(session),
      notes: opts.notes ?? session.notes,
    });

    // Personal records — per exercise (the same exercise may appear on several rows).
    const prs: FinishResult['prs'] = [];
    const byExercise = new Map<string, WorkoutSet[]>();
    for (const i of items)
      byExercise.set(i.we.exercise_id, [
        ...(byExercise.get(i.we.exercise_id) ?? []),
        ...working(i.sets),
      ]);
    for (const [exerciseId, sets] of byExercise) {
      const ex = items.find((i) => i.we.exercise_id === exerciseId)?.exercise;
      if (!ex || sets.length === 0) continue;
      const found = detectPersonalRecords(
        ex.logging_type,
        sets,
        await priorSetsFor(tx, exerciseId, sessionId),
      );
      for (const pr of found) {
        await saveEntity(tx, 'personal_record', {
          exercise_id: exerciseId,
          session_id: sessionId,
          set_id: pr.setId,
          record_type: pr.recordType,
          value: pr.value,
          previous_value: pr.previousValue,
          achieved_at: completedAt,
        });
        prs.push({ ...pr, exerciseId });
      }
    }

    // Progression recommendations (stored as pending suggestions; the user decides).
    const recommendations: FinishResult['recommendations'] = [];
    for (const i of items) {
      if (!i.exercise || !i.we.target) continue;
      if (i.we.disposition !== 'included' && i.we.disposition !== 'substituted') continue;
      const sets = working(i.sets);
      if (sets.length === 0) continue;
      const rec = recommendProgression({
        loggingType: i.exercise.logging_type,
        target: { sets: i.we.target.sets, repMin: i.we.target.repMin, repMax: i.we.target.repMax },
        sets,
        issueFlagged: i.we.issue_flag,
        incrementKg: i.exercise.load_increment_kg,
      });
      await saveEntity(tx, 'progression_recommendation', {
        exercise_id: i.we.exercise_id,
        workout_exercise_id: i.we.id,
        session_id: sessionId,
        programme_exercise_id: i.we.source_programme_exercise_id,
        rule_version: rec.ruleVersion,
        decision: rec.decision,
        suggestion: { ...rec.suggestion, basedOnSetIds: rec.basedOnSetIds },
        rationale: rec.rationale,
        status: 'pending',
      });
      recommendations.push({ ...rec, exerciseId: i.we.exercise_id });
    }

    // Attendance: planned occurrences record their real outcome; freeform sessions are "extra".
    if (session.planned_day_id && session.planned_date) {
      await recordPlannedOutcome(tx, {
        date: session.planned_date,
        plannedDayId: session.planned_day_id,
        versionId: session.programme_version_id,
        status: status as 'completed_as_planned' | 'completed_adapted' | 'partially_completed',
        sessionId,
      });
    } else {
      await saveEntity(tx, 'attendance_event', {
        date: session.session_date,
        planned_day_id: null,
        programme_version_id: null,
        status: 'extra',
        reason: null,
        related_session_id: sessionId,
        rescheduled_to: null,
        note: null,
      });
    }

    // Awards from stored facts; idempotency keys make replays harmless.
    const counts = await tx.first<{ completed: number; adapted: number }>(
      `SELECT COUNT(*) AS completed, SUM(CASE WHEN status = 'completed_adapted' THEN 1 ELSE 0 END) AS adapted
       FROM workout_session WHERE status IN ${COMPLETED_SQL} AND deleted_at IS NULL`,
    );
    const prSessions = await tx.first<{ n: number }>(
      'SELECT COUNT(DISTINCT session_id) AS n FROM personal_record WHERE deleted_at IS NULL',
    );
    const streak = await getStreak(tx);
    const { xp, badges } = sessionAwards({
      sessionId,
      status,
      sessionType: session.session_type,
      prCount: prs.length,
      completedSessions: counts?.completed ?? 0,
      adaptedCompletions: counts?.adapted ?? 0,
      prSessions: prSessions?.n ?? 0,
      streak: { current: streak.current, startedOn: streak.currentStartedOn },
    });
    const awards = await applyAwards(tx, xp, badges);
    return { session: finished, prs, recommendations, awards };
  });
}

// ---------- History & Strength Memory ----------

export type HistoryRow = WorkoutSession & { exercise_count: number; set_count: number };

export async function listSessionHistory(db: SqlDb, limit = 20, offset = 0): Promise<HistoryRow[]> {
  const rows = await db.all<Record<string, unknown>>(
    `SELECT s.*,
       (SELECT COUNT(*) FROM workout_exercise we WHERE we.session_id = s.id AND we.deleted_at IS NULL AND we.disposition IN ('included','substituted')) AS exercise_count,
       (SELECT COUNT(*) FROM workout_set ws WHERE ws.session_id = s.id AND ws.deleted_at IS NULL AND ws.is_warmup = 0) AS set_count
     FROM workout_session s
     WHERE s.deleted_at IS NULL AND s.status IN ${COMPLETED_SQL.slice(0, -1)},'cancelled')
     ORDER BY s.started_at DESC LIMIT ? OFFSET ?`,
    [limit, offset],
  );
  return rows.map((r) => ({
    ...(r as unknown as WorkoutSession),
    adaptation: r.adaptation ? JSON.parse(r.adaptation as string) : null,
    original_plan_snapshot: r.original_plan_snapshot
      ? JSON.parse(r.original_plan_snapshot as string)
      : null,
    exercise_count: Number(r.exercise_count),
    set_count: Number(r.set_count),
  }));
}

export type PerformanceEntry = {
  sessionId: string;
  date: DateKey;
  title: string;
  completedAt: string | null;
  sets: WorkoutSet[];
};

/** Strength Memory: logged working sets for an exercise grouped by completed session, newest first. */
export async function getExerciseHistory(
  db: SqlDb,
  exerciseId: string,
  limit = 20,
  excludeSessionId?: string,
): Promise<PerformanceEntry[]> {
  const sessions = await db.all<{
    id: string;
    session_date: string;
    title: string;
    completed_at: string | null;
  }>(
    `SELECT DISTINCT s.id, s.session_date, s.title, s.completed_at FROM workout_session s
     JOIN workout_set ws ON ws.session_id = s.id
     WHERE ws.exercise_id = ? AND ws.deleted_at IS NULL AND ws.is_warmup = 0
       AND s.status IN ${COMPLETED_SQL} AND s.deleted_at IS NULL AND s.id != ?
     ORDER BY s.completed_at DESC LIMIT ?`,
    [exerciseId, excludeSessionId ?? '', limit],
  );
  const out: PerformanceEntry[] = [];
  for (const s of sessions) {
    const sets = await queryEntities<WorkoutSet>(
      db,
      'workout_set',
      'session_id = ? AND exercise_id = ? AND deleted_at IS NULL AND is_warmup = 0',
      [s.id, exerciseId],
      'set_order',
    );
    out.push({
      sessionId: s.id,
      date: s.session_date,
      title: s.title,
      completedAt: s.completed_at,
      sets,
    });
  }
  return out;
}

export async function getPreviousPerformance(
  db: SqlDb,
  exerciseId: string,
  excludeSessionId?: string,
): Promise<PerformanceEntry | null> {
  return (await getExerciseHistory(db, exerciseId, 1, excludeSessionId))[0] ?? null;
}

export type Recommendation = {
  id: string;
  exercise_id: string;
  session_id: string;
  rule_version: string;
  decision: ProgressionResult['decision'];
  suggestion: ProgressionResult['suggestion'] & { basedOnSetIds?: string[] };
  rationale: string;
  status: 'pending' | 'accepted' | 'dismissed';
  created_at: string;
};

/** Most recent recommendation for an exercise (pending or accepted), used as the next-session target hint. */
export async function getLatestRecommendation(
  db: SqlDb,
  exerciseId: string,
): Promise<Recommendation | null> {
  const rows = await queryEntities<Recommendation>(
    db,
    'progression_recommendation',
    "exercise_id = ? AND deleted_at IS NULL AND status != 'dismissed'",
    [exerciseId],
    'created_at DESC LIMIT 1',
  );
  return rows[0] ?? null;
}

export function setRecommendationStatus(db: SqlDb, id: string, status: 'accepted' | 'dismissed') {
  return patchEntity(db, 'progression_recommendation', id, { status } as never);
}

export type PersonalRecordRow = {
  id: string;
  exercise_id: string;
  session_id: string;
  record_type: string;
  value: number;
  previous_value: number | null;
  achieved_at: string;
};

export function listPersonalRecords(
  db: SqlDb,
  exerciseId?: string,
  limit = 50,
): Promise<PersonalRecordRow[]> {
  return exerciseId
    ? queryEntities<PersonalRecordRow>(
        db,
        'personal_record',
        'deleted_at IS NULL AND exercise_id = ?',
        [exerciseId],
        `achieved_at DESC LIMIT ${limit}`,
      )
    : queryEntities<PersonalRecordRow>(
        db,
        'personal_record',
        'deleted_at IS NULL',
        [],
        `achieved_at DESC LIMIT ${limit}`,
      );
}

export function isCompletedStatus(s: SessionStatus) {
  return COMPLETED_STATUSES.includes(s);
}
