import type { SqlDb } from '@/data/local/db';
import { addExerciseToDay, updateProgrammeExercise } from '@/data/local/repositories/programmes';
import { addExerciseToSession, substituteExercise } from '@/data/local/repositories/workouts';
import { getEntity } from '@/data/local/store';
import type { ProgrammeExercise } from '@/domain/models/types';

/** What the exercise picker was opened for. Passed as route params so the picker stays generic. */
export type PickAction =
  | 'add_to_day'
  | 'replace_programme_exercise'
  | 'add_alternative'
  | 'add_to_workout'
  | 'substitute_workout_exercise';

export const PICK_TITLES: Record<PickAction, string> = {
  add_to_day: 'Add exercise',
  replace_programme_exercise: 'Replace exercise',
  add_alternative: 'Add alternative',
  add_to_workout: 'Add to workout',
  substitute_workout_exercise: 'Substitute exercise',
};

export async function runPickAction(
  db: SqlDb,
  action: PickAction,
  target: string,
  exerciseId: string,
): Promise<void> {
  switch (action) {
    case 'add_to_day':
      await addExerciseToDay(db, target, exerciseId);
      return;
    case 'replace_programme_exercise':
      await updateProgrammeExercise(db, target, { exercise_id: exerciseId });
      return;
    case 'add_alternative': {
      const pe = await getEntity<ProgrammeExercise>(db, 'programme_exercise', target);
      if (!pe) throw new Error('Programme exercise not found.');
      if (pe.exercise_id === exerciseId || pe.alternative_ids.includes(exerciseId)) return;
      await updateProgrammeExercise(db, target, {
        alternative_ids: [...pe.alternative_ids, exerciseId],
      });
      return;
    }
    case 'add_to_workout':
      await addExerciseToSession(db, target, exerciseId);
      return;
    case 'substitute_workout_exercise':
      await substituteExercise(db, target, exerciseId, 'Substituted during the workout.');
      return;
  }
}
