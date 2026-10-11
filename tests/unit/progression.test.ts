import { recommendProgression, type ProgressionSet } from '@/domain/rules/progression';

const s = (
  load: number | null,
  reps: number | null,
  extra: Partial<ProgressionSet> = {},
): ProgressionSet => ({
  load_kg: load,
  reps,
  duration_seconds: null,
  distance_m: null,
  rpe: null,
  rir: null,
  ...extra,
});
const target = { sets: 3, repMin: 8, repMax: 12 };
const run = (
  sets: ProgressionSet[],
  over: Partial<Parameters<typeof recommendProgression>[0]> = {},
) =>
  recommendProgression({
    loggingType: 'weight_reps',
    target,
    sets,
    issueFlagged: false,
    incrementKg: 2.5,
    ...over,
  });

describe('progression engine v1', () => {
  it('suggests a small load increase only when every set hits the top of the range', () => {
    const r = run([s(60, 12), s(60, 12), s(60, 12)]);
    expect(r.decision).toBe('increase_load');
    expect(r.suggestion.loadKg).toBe(62.5);
    expect(r.suggestion.reps).toBe(8);
    expect(r.ruleVersion).toBe('progression-v1');
    expect(r.rationale).toMatch(/no effort rating/);
  });

  it('does not increase load when one set misses the top of the range (never blindly increases)', () => {
    const r = run([s(60, 12), s(60, 12), s(60, 11)]);
    expect(r.decision).toBe('increase_reps');
    expect(r.suggestion).toEqual({ loadKg: 60, reps: 12, durationSeconds: null });
  });

  it('within range → add reps at the same load', () => {
    const r = run([s(60, 9), s(60, 8), s(60, 8)]);
    expect(r.decision).toBe('increase_reps');
    expect(r.suggestion.reps).toBe(9);
  });

  it('top of range but effort too high (RIR 0 / RPE 10) → repeat, do not add load', () => {
    expect(run([s(60, 12, { rir: 0 }), s(60, 12), s(60, 12)]).decision).toBe('repeat_target');
    expect(run([s(60, 12, { rpe: 10 }), s(60, 12), s(60, 12)]).decision).toBe('repeat_target');
  });

  it('acceptable effort at the boundary (RIR 1, RPE 9) still allows progression', () => {
    expect(run([s(60, 12, { rir: 1 }), s(60, 12, { rpe: 9 }), s(60, 12)]).decision).toBe(
      'increase_load',
    );
  });

  it('some sets below range → repeat target', () => {
    expect(run([s(60, 9), s(60, 8), s(60, 7)]).decision).toBe('repeat_target');
  });

  it('most sets below range → reduce or review with a rounded lighter load', () => {
    const r = run([s(60, 6), s(60, 5), s(60, 9)]);
    expect(r.decision).toBe('reduce_or_review');
    expect(r.suggestion.loadKg).toBe(55);
  });

  it('fewer sets than prescribed → repeat target', () => {
    expect(run([s(60, 12), s(60, 12)]).decision).toBe('repeat_target');
  });

  it('uses only the heaviest-load sets as working sets', () => {
    const r = run([s(60, 12), s(60, 12), s(60, 12), s(40, 15)]);
    expect(r.decision).toBe('increase_load');
  });

  it('issue flagged → reduce or review, never progress, no diagnosis', () => {
    const r = run([s(60, 12), s(60, 12), s(60, 12)], { issueFlagged: true });
    expect(r.decision).toBe('reduce_or_review');
    expect(r.rationale).toMatch(/qualified professional/);
  });

  it('missing data → insufficient_data', () => {
    expect(run([]).decision).toBe('insufficient_data');
    expect(run([s(null, 10), s(60, 10), s(60, 10)]).decision).toBe('insufficient_data');
    expect(run([s(60, null), s(60, 10), s(60, 10)]).decision).toBe('insufficient_data');
  });

  it('uses the exercise increment when known, default otherwise', () => {
    expect(run([s(20, 12), s(20, 12), s(20, 12)], { incrementKg: 1 }).suggestion.loadKg).toBe(21);
    expect(run([s(20, 12), s(20, 12), s(20, 12)], { incrementKg: null }).suggestion.loadKg).toBe(
      22.5,
    );
  });

  it('assisted bodyweight progresses by reducing assistance', () => {
    const r = recommendProgression({
      loggingType: 'assisted_bodyweight',
      target,
      sets: [s(30, 12), s(30, 12), s(30, 12)],
      issueFlagged: false,
      incrementKg: 5,
    });
    expect(r.decision).toBe('increase_load');
    expect(r.suggestion.loadKg).toBe(25);
  });

  it('pure bodyweight at top of range → repeat with variation advice (no fake load)', () => {
    const r = recommendProgression({
      loggingType: 'bodyweight_reps',
      target,
      sets: [s(null, 12), s(null, 13), s(null, 12)],
      issueFlagged: false,
      incrementKg: null,
    });
    expect(r.decision).toBe('repeat_target');
    expect(r.suggestion.loadKg).toBeNull();
  });

  it('timed holds progress by small time steps within range', () => {
    const hold = (d: number) => ({ ...s(null, null), duration_seconds: d });
    const r = recommendProgression({
      loggingType: 'hold',
      target: { sets: 3, repMin: 30, repMax: 60 },
      sets: [hold(40), hold(45), hold(42)],
      issueFlagged: false,
      incrementKg: null,
    });
    expect(r.decision).toBe('increase_reps');
    expect(r.suggestion.durationSeconds).toBe(45);
  });

  it('distance is not auto-progressed', () => {
    const r = recommendProgression({
      loggingType: 'distance',
      target,
      sets: [{ ...s(null, null), distance_m: 400 }],
      issueFlagged: false,
      incrementKg: null,
    });
    expect(r.decision).toBe('insufficient_data');
  });

  it('records which sets were used', () => {
    const r = run([s(60, 12, { id: 'a' }), s(60, 12, { id: 'b' }), s(60, 12, { id: 'c' })]);
    expect(r.basedOnSetIds).toEqual(['a', 'b', 'c']);
  });
});
