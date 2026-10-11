import type { DaySnapshot, WorkoutSession } from '@/domain/models/types';
import { weekAdherence, type Occurrence, type WeekAdherence } from '@/domain/rules/schedule';
import { levelFor, type LevelInfo } from '@/domain/rules/xp';
import { addDays, startOfWeek, type DateKey } from '@/utils/dates';

import type { SqlDb } from '../db';

import { getCalendar, getStreak, today as todayKey } from './attendance';
import { totalXp } from './awards';
import { getActiveCampaign, listMilestones, type Campaign, type Milestone } from './campaign';
import { getActiveProgramme, getVersion, type ActiveProgramme } from './programmes';
import { getActiveSession } from './workouts';

export type PlannedOccurrence = Occurrence & { day: DaySnapshot | null };

export type Dashboard = {
  today: DateKey;
  active: ActiveProgramme | null;
  activeSession: WorkoutSession | null;
  todayPlan: PlannedOccurrence[];
  next: PlannedOccurrence | null;
  /** Recent past planned sessions with nothing recorded — offered a supportive check-in. */
  needsCheckIn: PlannedOccurrence[];
  week: WeekAdherence;
  streak: { current: number; best: number };
  level: LevelInfo;
  campaign: { campaign: Campaign; nextMilestone: Milestone | null; daysLeft: number | null } | null;
};

/** Resolves an occurrence to the immutable day snapshot of the version in effect on that date. */
export async function resolveDay(db: SqlDb, o: Occurrence): Promise<PlannedOccurrence> {
  const v = await getVersion(db, o.versionId);
  return { ...o, day: v?.snapshot.days.find((d) => d.id === o.dayId) ?? null };
}

export async function getDashboard(db: SqlDb): Promise<Dashboard> {
  const today = todayKey();
  const [active, activeSession, calendar, streak, xp, campaign] = await Promise.all([
    getActiveProgramme(db),
    getActiveSession(db),
    getCalendar(db, addDays(today, -3), addDays(today, 7), today),
    getStreak(db, today),
    totalXp(db),
    getActiveCampaign(db),
  ]);
  const todayOcc = calendar.find((d) => d.date === today)?.occurrences ?? [];
  const todayPlan = await Promise.all(todayOcc.map((o) => resolveDay(db, o)));
  const upcoming = calendar
    .filter((d) => d.date > today)
    .flatMap((d) => d.occurrences)
    .find((o) => o.outcome === 'upcoming');
  const missed = calendar
    .filter((d) => d.date < today)
    .flatMap((d) => d.occurrences)
    .filter((o) => o.outcome === 'missed_unconfirmed');

  const weekStart = startOfWeek(today);
  const weekCal = await getCalendar(db, weekStart, addDays(weekStart, 6), today);

  let campaignInfo: Dashboard['campaign'] = null;
  if (campaign) {
    const ms = await listMilestones(db, campaign.id);
    const next = ms.find((m) => m.status === 'open') ?? null;
    const daysLeft = campaign.target_date
      ? Math.max(0, Math.round((Date.parse(campaign.target_date) - Date.parse(today)) / 86_400_000))
      : null;
    campaignInfo = { campaign, nextMilestone: next, daysLeft };
  }

  return {
    today,
    active,
    activeSession,
    todayPlan,
    next: upcoming ? await resolveDay(db, upcoming) : null,
    needsCheckIn: await Promise.all(missed.map((o) => resolveDay(db, o))),
    week: weekAdherence(weekCal),
    streak: { current: streak.current, best: streak.best },
    level: levelFor(xp),
    campaign: campaignInfo,
  };
}
