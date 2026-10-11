import type { SessionStatus, SessionType } from '../models/types';

/**
 * XP and badge rules (FR-10 / TRD §9). All values live here. Awards reward adherence and
 * completion with flat amounts — never volume, duration or training through fatigue.
 * Every award has a deterministic idempotency key; storage enforces uniqueness, so replaying
 * the same event (retry, sync pull, double tap) can never award twice.
 */
export const XP_CONFIG = {
  version: 'xp-v1',
  session: {
    completed_as_planned: 50,
    completed_adapted: 40,
    partially_completed: 25,
    freeform: 25,
  },
  habitAction: 5,
  /** Flat bonus once per session with ≥1 PR (not per PR, so there is nothing to farm). */
  prSession: 20,
  weeklyReview: 15,
  milestoneCompleted: 30,
  streakMilestones: { 3: 30, 7: 75, 14: 150, 30: 300 } as Record<number, number>,
  /** XP needed to go from level n to n+1 grows linearly: step * n. */
  levelStep: 150,
} as const;

export type XpCandidate = {
  eventType: string;
  sourceEntityId: string | null;
  amount: number;
  idempotencyKey: string;
  ruleVersion: string;
};

export type BadgeKey =
  | 'first_session'
  | 'sessions_10'
  | 'sessions_50'
  | 'first_pr'
  | 'pr_sessions_10'
  | 'first_adapted'
  | 'streak_7'
  | 'streak_30'
  | 'weekly_reviews_4'
  | 'campaign_complete';

export const BADGES: Record<BadgeKey, { title: string; description: string }> = {
  first_session: { title: 'First session', description: 'Logged your first workout.' },
  sessions_10: { title: 'Ten sessions', description: '10 sessions completed.' },
  sessions_50: { title: 'Fifty sessions', description: '50 sessions completed.' },
  first_pr: { title: 'First PR', description: 'Beat a previous best for the first time.' },
  pr_sessions_10: {
    title: 'Record setter',
    description: 'Personal records in 10 different sessions.',
  },
  first_adapted: {
    title: 'Adapted, not abandoned',
    description: 'Completed an adapted session instead of skipping.',
  },
  streak_7: { title: 'Seven in a row', description: '7 planned sessions attended in a row.' },
  streak_30: { title: 'Thirty in a row', description: '30 planned sessions attended in a row.' },
  weekly_reviews_4: { title: 'Reflective', description: 'Recorded 4 weekly reviews.' },
  campaign_complete: { title: 'Campaign complete', description: 'Finished a campaign.' },
};

export type BadgeCandidate = {
  badgeKey: BadgeKey;
  idempotencyKey: string;
  sourceEntityId: string | null;
};

const badge = (badgeKey: BadgeKey, sourceEntityId: string | null): BadgeCandidate => ({
  badgeKey,
  idempotencyKey: `badge:${badgeKey}`,
  sourceEntityId,
});

export type SessionAwardFacts = {
  sessionId: string;
  status: SessionStatus;
  sessionType: SessionType;
  prCount: number;
  /** Totals including this session (computed from stored records). */
  completedSessions: number;
  adaptedCompletions: number;
  prSessions: number;
  streak: { current: number; startedOn: string | null };
};

export function sessionAwards(
  f: SessionAwardFacts,
  cfg = XP_CONFIG,
): { xp: XpCandidate[]; badges: BadgeCandidate[] } {
  const xp: XpCandidate[] = [];
  const badges: BadgeCandidate[] = [];
  const completedStatuses: SessionStatus[] = [
    'completed_as_planned',
    'completed_adapted',
    'partially_completed',
  ];
  if (!completedStatuses.includes(f.status)) return { xp, badges };

  const amount =
    f.sessionType === 'freeform'
      ? cfg.session.freeform
      : (cfg.session[f.status as keyof typeof cfg.session] ?? 0);
  xp.push({
    eventType: `session_${f.status}`,
    sourceEntityId: f.sessionId,
    amount,
    idempotencyKey: `session_completed:${f.sessionId}:${cfg.version}`,
    ruleVersion: cfg.version,
  });
  if (f.prCount > 0) {
    xp.push({
      eventType: 'pr_session',
      sourceEntityId: f.sessionId,
      amount: cfg.prSession,
      idempotencyKey: `pr_session:${f.sessionId}:${cfg.version}`,
      ruleVersion: cfg.version,
    });
  }
  for (const [n, amt] of Object.entries(cfg.streakMilestones)) {
    if (f.streak.current === Number(n) && f.streak.startedOn) {
      xp.push({
        eventType: `streak_${n}`,
        sourceEntityId: f.sessionId,
        amount: amt,
        idempotencyKey: `streak_milestone:${n}:${f.streak.startedOn}:${cfg.version}`,
        ruleVersion: cfg.version,
      });
    }
  }

  if (f.completedSessions >= 1) badges.push(badge('first_session', f.sessionId));
  if (f.completedSessions >= 10) badges.push(badge('sessions_10', f.sessionId));
  if (f.completedSessions >= 50) badges.push(badge('sessions_50', f.sessionId));
  if (f.prSessions >= 1) badges.push(badge('first_pr', f.sessionId));
  if (f.prSessions >= 10) badges.push(badge('pr_sessions_10', f.sessionId));
  if (f.adaptedCompletions >= 1) badges.push(badge('first_adapted', f.sessionId));
  if (f.streak.current >= 7) badges.push(badge('streak_7', f.sessionId));
  if (f.streak.current >= 30) badges.push(badge('streak_30', f.sessionId));
  return { xp, badges };
}

export function habitActionAward(attendanceId: string, date: string, cfg = XP_CONFIG): XpCandidate {
  // One habit-action award per calendar day at most.
  return {
    eventType: 'habit_action',
    sourceEntityId: attendanceId,
    amount: cfg.habitAction,
    idempotencyKey: `habit_action:${date}:${cfg.version}`,
    ruleVersion: cfg.version,
  };
}

export function weeklyReviewAward(
  reviewId: string,
  weekStart: string,
  cfg = XP_CONFIG,
): XpCandidate {
  return {
    eventType: 'weekly_review',
    sourceEntityId: reviewId,
    amount: cfg.weeklyReview,
    idempotencyKey: `weekly_review:${weekStart}:${cfg.version}`,
    ruleVersion: cfg.version,
  };
}

export function milestoneAward(milestoneId: string, cfg = XP_CONFIG): XpCandidate {
  return {
    eventType: 'milestone_completed',
    sourceEntityId: milestoneId,
    amount: cfg.milestoneCompleted,
    idempotencyKey: `milestone:${milestoneId}:${cfg.version}`,
    ruleVersion: cfg.version,
  };
}

export type LevelInfo = { level: number; xpIntoLevel: number; xpForNext: number; total: number };

export function levelFor(totalXp: number, cfg = XP_CONFIG): LevelInfo {
  let level = 1;
  let floor = 0;
  while (totalXp >= floor + cfg.levelStep * level) {
    floor += cfg.levelStep * level;
    level += 1;
  }
  return { level, xpIntoLevel: totalXp - floor, xpForNext: cfg.levelStep * level, total: totalXp };
}
