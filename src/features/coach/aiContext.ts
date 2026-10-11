import type { SqlDb } from '@/data/local/db';
import { getActiveCampaign } from '@/data/local/repositories/campaign';
import { getProfile } from '@/data/local/repositories/profile';
import { getActiveProgramme } from '@/data/local/repositories/programmes';
import { getWeeklyFacts } from '@/data/local/repositories/reviews';
import { getSessionDetail, listSessionHistory } from '@/data/local/repositories/workouts';
import type { Exercise, Profile } from '@/domain/models/types';
import { STATUS_LABEL } from '@/domain/rules/sessionState';
import { formatPrescription } from '@/features/programme/format';
import { formatSetList } from '@/features/workout/formatSet';
import { startOfWeek, toDateKey } from '@/utils/dates';
import { now } from '@/utils/clock';

/**
 * Deterministic, minimal context builders for AI requests (FR-12). The model never queries the
 * database; it only sees these compact summaries. Deliberately excluded: name, email, age, height,
 * body weight, measurements, photos, notes, IDs other than exercise catalogue IDs.
 */
export type ProfileContext = {
  goals: string[];
  customGoal: string | null;
  experience: string | null;
  sessionsPerWeek: number | null;
  preferredWeekdays: number[];
  sessionMinutes: number | null;
  equipment: string[];
  avoidPatterns: string[];
  limitationsNote: string | null;
  units: 'metric' | 'imperial';
};

export function profileContext(p: Profile | null): ProfileContext {
  return {
    goals: p?.goals ?? [],
    customGoal: p?.custom_goal ?? null,
    experience: p?.experience ?? null,
    sessionsPerWeek: p?.weekly_target ?? null,
    preferredWeekdays: p?.preferred_days ?? [],
    sessionMinutes: p?.session_minutes ?? null,
    equipment: p?.equipment ?? [],
    avoidPatterns: p?.avoid_patterns ?? [],
    limitationsNote: p?.limitations_note ? p.limitations_note.slice(0, 300) : null,
    units: p?.unit_system ?? 'metric',
  };
}

/** Exercise catalogue the model may choose from: only exercises usable with the user's equipment and preferences. */
export function catalogueFor(exercises: Map<string, Exercise>, p: Profile | null, limit = 70) {
  const equip = p?.equipment ?? [];
  const avoid = p?.avoid_patterns ?? [];
  return [...exercises.values()]
    .filter(
      (e) =>
        !e.deleted_at &&
        e.equipment.every((q) => equip.includes(q)) &&
        !avoid.includes(e.movement_pattern) &&
        !(p?.excluded_exercise_ids ?? []).includes(e.id),
    )
    .slice(0, limit)
    .map((e) => ({
      id: e.id,
      name: e.name,
      pattern: e.movement_pattern,
      muscles: e.primary_muscles.slice(0, 4),
      equipment: e.equipment,
    }));
}

export async function coachContext(db: SqlDb) {
  const [profile, active, history, campaign] = await Promise.all([
    getProfile(db),
    getActiveProgramme(db),
    listSessionHistory(db, 6),
    getActiveCampaign(db),
  ]);
  const units = profile?.unit_system ?? 'metric';
  const programmeSummary = active
    ? `${active.programme.name} (v${active.version.version_number}): ` +
      active.version.snapshot.days
        .map(
          (d) =>
            `${d.title}${d.weekday !== null ? ` [weekday ${d.weekday}]` : ''}: ${d.exercises.map((e) => `${e.exerciseName} ${formatPrescription(e)}`).join('; ')}`,
        )
        .join(' | ')
    : null;
  const recentSessions: string[] = [];
  for (const h of history.filter((x) => x.status !== 'cancelled').slice(0, 6)) {
    const d = await getSessionDetail(db, h.id);
    if (!d) continue;
    const work = d.items
      .filter((i) => i.sets.some((s) => !s.is_warmup))
      .map(
        (i) =>
          `${i.exercise?.name ?? 'exercise'} ${formatSetList(
            i.sets.filter((s) => !s.is_warmup),
            i.exercise?.logging_type ?? 'weight_reps',
            units,
          )}`,
      )
      .join('; ');
    recentSessions.push(
      `${h.session_date} ${h.title} — ${STATUS_LABEL[h.status]}${work ? `: ${work}` : ''}`.slice(
        0,
        300,
      ),
    );
  }
  const week = await getWeeklyFacts(db, startOfWeek(toDateKey(now())));
  const a = week.adherence;
  const weekSummary = `This week: ${a.attended}/${a.planned} planned sessions attended (${a.adapted} adapted, ${a.partial} partial, ${a.missed} missed), ${week.prs.length} PRs, streak ${week.streak.current}.`;
  return {
    profile: profileContext(profile),
    programmeSummary: programmeSummary ? programmeSummary.slice(0, 2500) : null,
    recentSessions,
    weekSummary,
    campaign: campaign
      ? `${campaign.name}${campaign.target_date ? ` (target ${campaign.target_date})` : ''}`.slice(
          0,
          300,
        )
      : null,
  };
}
