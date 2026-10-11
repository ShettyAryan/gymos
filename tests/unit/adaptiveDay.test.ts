import { ALL_EQUIPMENT } from '@/domain/models/constants';
import type { DaySnapshot, PlannedExercise } from '@/domain/models/types';
import {
  proposeAdaptation,
  type AdaptiveInput,
  type ExerciseMeta,
} from '@/domain/rules/adaptiveDay';
import { SEED_EXERCISES } from '@/data/local/seed/exercises';

const catalog = new Map<string, ExerciseMeta>(SEED_EXERCISES.map((e) => [e.id, { ...e }]));

const pe = (
  exerciseId: string,
  order: number,
  priority: PlannedExercise['priority'],
  sets = 3,
  rest = 120,
): PlannedExercise => ({
  programmeExerciseId: `pe_${exerciseId}`,
  exerciseId,
  exerciseName: catalog.get(exerciseId)!.name,
  order,
  sets,
  repMin: 6,
  repMax: 10,
  restSeconds: rest,
  targetRir: 2,
  priority,
  alternativeIds: catalog.get(exerciseId)!.alternatives,
  notes: null,
});

/** ~60-minute leg day (the PRD's illustrative example). */
const legDay = (): DaySnapshot => ({
  id: 'day_legs',
  title: 'Leg Day',
  dayOrder: 0,
  weekday: 1,
  intendedMinutes: 60,
  focus: null,
  exercises: [
    pe('back_squat', 0, 'primary', 4, 180),
    pe('romanian_deadlift', 1, 'primary', 3, 150),
    pe('bulgarian_split_squat', 2, 'secondary', 3, 90),
    pe('leg_curl', 3, 'accessory', 3, 60),
    pe('machine_calf_raise', 4, 'accessory', 3, 60),
  ],
});

const input = (over: Partial<AdaptiveInput> = {}): AdaptiveInput => ({
  day: legDay(),
  availableMinutes: 120,
  equipment: [...ALL_EQUIPMENT],
  energy: 'normal',
  avoidPatterns: [],
  excludedExerciseIds: [],
  exercises: catalog,
  ...over,
});

const byDisposition = (p: ReturnType<typeof proposeAdaptation>, d: string) =>
  p.items.filter((i) => i.disposition === d).map((i) => i.plannedExerciseId);

describe('Adaptive Day', () => {
  it('returns the plan unchanged when it fits and equipment is available', () => {
    const p = proposeAdaptation(input());
    expect(p.feasible).toBe(true);
    expect(p.label).toBe('as_planned');
    expect(
      p.items.every((i) => i.disposition === 'included' && i.proposedSets === i.plannedSets),
    ).toBe(true);
  });

  it('PRD example: 20 minutes on a 60-minute leg day → shortened session prioritising primary work', () => {
    const p = proposeAdaptation(input({ availableMinutes: 20 }));
    expect(p.feasible).toBe(true);
    expect(p.label).toBe('shortened');
    expect(p.title).toBe('Shortened Leg Day');
    expect(p.estimatedMinutes).toBeLessThanOrEqual(20);
    expect(byDisposition(p, 'included')).toContain('back_squat');
    expect(byDisposition(p, 'deferred')).toEqual(
      expect.arrayContaining(['leg_curl', 'machine_calf_raise', 'bulgarian_split_squat']),
    );
    // deferred work is reported with a reason, not silently dropped
    for (const i of p.items.filter((x) => x.disposition === 'deferred'))
      expect(i.reasons.length).toBeGreaterThan(0);
  });

  it('never reduces rest periods to fit time', () => {
    const p = proposeAdaptation(input({ availableMinutes: 25 }));
    for (const item of p.items) {
      const planned = legDay().exercises.find((e) => e.exerciseId === item.plannedExerciseId)!;
      expect(item.target.restSeconds).toBe(planned.restSeconds);
    }
  });

  it('drops accessories before reducing sets, and never below the minimum sets', () => {
    const p = proposeAdaptation(input({ availableMinutes: 40 }));
    const accessoriesActive = p.items.filter(
      (i) => i.target.priority === 'accessory' && i.disposition === 'included',
    );
    const reduced = p.items.filter(
      (i) => i.disposition === 'included' && i.proposedSets < i.plannedSets,
    );
    if (reduced.length > 0) expect(accessoriesActive).toHaveLength(0);
    for (const i of p.items.filter((x) => x.disposition === 'included'))
      expect(i.proposedSets).toBeGreaterThanOrEqual(2);
  });

  it('does not mutate the original programme-day snapshot', () => {
    const day = legDay();
    const before = JSON.stringify(day);
    proposeAdaptation(input({ day, availableMinutes: 15, equipment: [] }));
    expect(JSON.stringify(day)).toBe(before);
  });

  it('substitutes exercises when equipment is missing, using planned alternatives first', () => {
    const p = proposeAdaptation(input({ equipment: ['dumbbell', 'bench'] }));
    const squat = p.items.find((i) => i.plannedExerciseId === 'back_squat')!;
    expect(squat.disposition).toBe('substituted');
    expect(squat.exerciseId).toBe('goblet_squat');
    expect(squat.reasons[0]).toMatch(/needs/);
    expect(p.label).not.toBe('as_planned');
  });

  it('defers (not removes) work when no equipment-compatible alternative exists', () => {
    const day: DaySnapshot = {
      ...legDay(),
      exercises: [pe('leg_press', 0, 'primary'), pe('machine_calf_raise', 1, 'accessory')],
    };
    const p = proposeAdaptation(input({ day, equipment: [] }));
    const calf = p.items.find((i) => i.plannedExerciseId === 'machine_calf_raise')!;
    expect(calf.disposition).toBe('substituted'); // bodyweight calf raise
    const press = p.items.find((i) => i.plannedExerciseId === 'leg_press')!;
    expect(['substituted', 'deferred']).toContain(press.disposition);
  });

  it('respects avoided movement patterns (removes or substitutes, never includes)', () => {
    const p = proposeAdaptation(input({ avoidPatterns: ['hinge'] }));
    const rdl = p.items.find((i) => i.plannedExerciseId === 'romanian_deadlift')!;
    expect(rdl.disposition).toBe('removed');
    expect(
      p.items.filter(
        (i) => i.exerciseId && catalog.get(i.exerciseId)!.movement_pattern === 'hinge',
      ),
    ).toHaveLength(0);
  });

  it('low energy reduces volume slightly; high energy adds nothing', () => {
    const low = proposeAdaptation(input({ energy: 'low' }));
    const squat = low.items.find((i) => i.plannedExerciseId === 'back_squat')!;
    expect(squat.proposedSets).toBe(3);
    const high = proposeAdaptation(input({ energy: 'high' }));
    expect(high.items.every((i) => i.proposedSets <= i.plannedSets)).toBe(true);
  });

  it('returns an honest infeasible result with alternatives instead of fabricating a plan', () => {
    const p = proposeAdaptation(input({ availableMinutes: 5 }));
    expect(p.feasible).toBe(false);
    expect(p.infeasibleReason).toBeTruthy();
    expect(p.items.every((i) => i.disposition === 'deferred' || i.disposition === 'removed')).toBe(
      true,
    );
    expect(p.alternatives.map((a) => a.kind)).toEqual(
      expect.arrayContaining(['reschedule', 'habit_action']),
    );
  });

  it('infeasible when the single most important exercise cannot fit', () => {
    const day: DaySnapshot = { ...legDay(), exercises: [pe('back_squat', 0, 'primary', 5, 300)] };
    const p = proposeAdaptation(input({ day, availableMinutes: 12 }));
    expect(p.feasible).toBe(false);
    expect(p.infeasibleReason).toMatch(/not rush sets or cut rest/);
  });

  it('is deterministic', () => {
    const a = proposeAdaptation(input({ availableMinutes: 30, equipment: ['dumbbell'] }));
    const b = proposeAdaptation(input({ availableMinutes: 30, equipment: ['dumbbell'] }));
    expect(a).toEqual(b);
  });

  it('labels estimates as approximate', () => {
    const p = proposeAdaptation(input({ availableMinutes: 30 }));
    expect(p.confidence).toBe('approximate');
    expect(p.warnings.join(' ')).toMatch(/approximate/);
  });
});
