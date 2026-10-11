import { useQuery } from '@/data/DatabaseProvider';
import { getProfile } from '@/data/local/repositories/profile';
import type { UnitSystem } from '@/utils/units';

/** The user's display unit system (defaults to metric until the profile loads). */
export function useUnits(): UnitSystem {
  const q = useQuery((db) => getProfile(db));
  return q.data?.unit_system ?? 'metric';
}
