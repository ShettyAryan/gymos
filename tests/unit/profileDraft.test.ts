import {
  draftFromProfile,
  profileInputFromDraft,
  switchUnits,
  validateDraft,
} from '@/features/onboarding/profileDraft';

describe('profile draft', () => {
  it('requires only goals, experience and location', () => {
    const d = draftFromProfile(null);
    expect(Object.keys(validateDraft(d)).sort()).toEqual(['experience', 'goals', 'location']);
    const ok = {
      ...d,
      goals: ['strength' as const],
      experience: 'beginner' as const,
      location: 'minimal' as const,
    };
    expect(validateDraft(ok)).toEqual({});
  });

  it('leaves optional fields null instead of inventing values', () => {
    const d = {
      ...draftFromProfile(null),
      goals: ['strength' as const],
      experience: 'new' as const,
      location: 'full_gym' as const,
    };
    const input = profileInputFromDraft(d, null);
    expect(input.height_cm).toBeNull();
    expect(input.body_weight_kg).toBeNull();
    expect(input.age).toBeNull();
    expect(input.training_history).toBeNull();
  });

  it('stores canonical units regardless of display units', () => {
    const d = {
      ...draftFromProfile(null),
      unit_system: 'imperial' as const,
      body_weight: '180',
      height: '70',
      goals: ['strength' as const],
      experience: 'new' as const,
      location: 'custom' as const,
      equipment: ['dumbbell' as const],
    };
    const input = profileInputFromDraft(d, null);
    expect(input.body_weight_kg).toBeCloseTo(81.65, 2);
    expect(input.height_cm).toBeCloseTo(177.8, 1);
    expect(input.equipment).toEqual(['dumbbell']);
  });

  it('converts entered values when switching units', () => {
    const d = { ...draftFromProfile(null), body_weight: '100', height: '180' };
    const imp = switchUnits(d, 'imperial');
    expect(imp.body_weight).toBe('220.5');
    expect(imp.height).toBe('70.9');
  });

  it('rejects implausible optional values', () => {
    const d = { ...draftFromProfile(null), age: '7', body_weight: '5' };
    const e = validateDraft(d, 'body');
    expect(e.age).toBeDefined();
    expect(e.body_weight).toBeDefined();
  });

  it('applies location equipment presets', () => {
    const d = {
      ...draftFromProfile(null),
      location: 'minimal' as const,
      equipment: ['barbell' as const],
    };
    expect(profileInputFromDraft(d, null).equipment).toEqual(['bands', 'pullup_bar']);
  });
});
