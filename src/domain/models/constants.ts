export const GOALS = [
  { value: 'strength', label: 'Strength' },
  { value: 'hypertrophy', label: 'Muscle gain' },
  { value: 'general_fitness', label: 'General fitness' },
  { value: 'consistency', label: 'Consistency' },
  { value: 'custom', label: 'Custom' },
] as const;
export type Goal = (typeof GOALS)[number]['value'];

export const EXPERIENCE = [
  { value: 'new', label: 'New' },
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
] as const;
export type Experience = (typeof EXPERIENCE)[number]['value'];

export const EQUIPMENT = [
  { value: 'barbell', label: 'Barbell' },
  { value: 'rack', label: 'Squat rack' },
  { value: 'bench', label: 'Bench' },
  { value: 'dumbbell', label: 'Dumbbells' },
  { value: 'kettlebell', label: 'Kettlebell' },
  { value: 'cable', label: 'Cable station' },
  { value: 'machine', label: 'Machines' },
  { value: 'pullup_bar', label: 'Pull-up bar' },
  { value: 'bands', label: 'Resistance bands' },
  { value: 'cardio_machine', label: 'Cardio machine' },
] as const;
export type Equipment = (typeof EQUIPMENT)[number]['value'];
export const ALL_EQUIPMENT: Equipment[] = EQUIPMENT.map((e) => e.value);

export const LOCATIONS = [
  { value: 'full_gym', label: 'Full gym' },
  { value: 'home_gym', label: 'Home gym' },
  { value: 'minimal', label: 'Bodyweight / minimal' },
  { value: 'custom', label: 'Custom' },
] as const;
export type Location = (typeof LOCATIONS)[number]['value'];

/** Equipment presets per location. "custom" uses the user's own list. */
export const LOCATION_EQUIPMENT: Record<Exclude<Location, 'custom'>, Equipment[]> = {
  full_gym: ALL_EQUIPMENT,
  home_gym: ['barbell', 'rack', 'bench', 'dumbbell', 'kettlebell', 'pullup_bar', 'bands'],
  minimal: ['bands', 'pullup_bar'],
};

export const MUSCLES = [
  { value: 'chest', label: 'Chest' },
  { value: 'back', label: 'Back' },
  { value: 'shoulders', label: 'Shoulders' },
  { value: 'biceps', label: 'Biceps' },
  { value: 'triceps', label: 'Triceps' },
  { value: 'forearms', label: 'Forearms' },
  { value: 'quads', label: 'Quads' },
  { value: 'hamstrings', label: 'Hamstrings' },
  { value: 'glutes', label: 'Glutes' },
  { value: 'calves', label: 'Calves' },
  { value: 'core', label: 'Core' },
  { value: 'cardio', label: 'Cardio' },
] as const;
export type Muscle = (typeof MUSCLES)[number]['value'];

export const MOVEMENT_PATTERNS = [
  { value: 'squat', label: 'Squat' },
  { value: 'hinge', label: 'Hinge' },
  { value: 'lunge', label: 'Lunge / single leg' },
  { value: 'horizontal_push', label: 'Horizontal push' },
  { value: 'vertical_push', label: 'Vertical push' },
  { value: 'horizontal_pull', label: 'Horizontal pull' },
  { value: 'vertical_pull', label: 'Vertical pull' },
  { value: 'arm_isolation', label: 'Arm isolation' },
  { value: 'leg_isolation', label: 'Leg isolation' },
  { value: 'core', label: 'Core' },
  { value: 'carry', label: 'Carry' },
  { value: 'conditioning', label: 'Conditioning' },
] as const;
export type MovementPattern = (typeof MOVEMENT_PATTERNS)[number]['value'];

export const LOGGING_TYPES = [
  { value: 'weight_reps', label: 'Weight + reps' },
  { value: 'bodyweight_reps', label: 'Bodyweight + reps' },
  { value: 'assisted_bodyweight', label: 'Assisted bodyweight' },
  { value: 'duration', label: 'Duration' },
  { value: 'distance', label: 'Distance' },
  { value: 'hold', label: 'Timed hold' },
] as const;
export type LoggingType = (typeof LOGGING_TYPES)[number]['value'];

export const PRIORITIES = [
  { value: 'primary', label: 'Primary' },
  { value: 'secondary', label: 'Secondary' },
  { value: 'accessory', label: 'Accessory' },
] as const;
export type Priority = (typeof PRIORITIES)[number]['value'];

export const labelOf = <T extends string>(
  list: readonly { value: T; label: string }[],
  v: T | null | undefined,
) => list.find((x) => x.value === v)?.label ?? v ?? '';
