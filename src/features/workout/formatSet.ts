import type { LoggingType } from '@/domain/models/constants';
import type { WorkoutSet } from '@/domain/models/types';
import { formatClock } from '@/utils/dates';
import {
  displayDistance,
  displayLoad,
  distanceUnit,
  loadUnit,
  type UnitSystem,
} from '@/utils/units';

export function formatSet(
  s: Pick<WorkoutSet, 'load_kg' | 'reps' | 'duration_seconds' | 'distance_m' | 'rpe' | 'rir'>,
  t: LoggingType,
  u: UnitSystem,
): string {
  const load = displayLoad(s.load_kg, u);
  let main: string;
  switch (t) {
    case 'weight_reps':
      main = `${load ?? '—'} ${loadUnit(u)} × ${s.reps ?? '—'}`;
      break;
    case 'bodyweight_reps':
      main = load ? `BW+${load} ${loadUnit(u)} × ${s.reps ?? '—'}` : `${s.reps ?? '—'} reps`;
      break;
    case 'assisted_bodyweight':
      main = `−${load ?? 0} ${loadUnit(u)} assist × ${s.reps ?? '—'}`;
      break;
    case 'duration':
    case 'hold':
      main = formatClock(s.duration_seconds ?? 0);
      break;
    case 'distance':
      main = `${displayDistance(s.distance_m, u) ?? '—'} ${distanceUnit(u)}${s.duration_seconds ? ` in ${formatClock(s.duration_seconds)}` : ''}`;
      break;
  }
  const effort = s.rir !== null ? ` · RIR ${s.rir}` : s.rpe !== null ? ` · RPE ${s.rpe}` : '';
  return main + effort;
}

export function formatSetList(sets: WorkoutSet[], t: LoggingType, u: UnitSystem): string {
  if (t === 'weight_reps' && sets.length > 0 && sets.every((s) => s.load_kg === sets[0]!.load_kg)) {
    return `${displayLoad(sets[0]!.load_kg, u)} ${loadUnit(u)} × ${sets.map((s) => s.reps).join(', ')}`;
  }
  return sets.map((s) => formatSet({ ...s, rpe: null, rir: null }, t, u)).join(' · ');
}
