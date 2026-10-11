import { detectPersonalRecords, estimateOneRepMax, type SetForRecords } from '@/domain/rules/prs';
import { assertTransition, canTransition, classifyCompletion } from '@/domain/rules/sessionState';

describe('session state machine', () => {
  it('allows only the documented transitions', () => {
    expect(canTransition('planned', 'in_progress')).toBe(true);
    expect(canTransition('planned', 'rescheduled')).toBe(true);
    expect(canTransition('in_progress', 'completed_adapted')).toBe(true);
    expect(canTransition('in_progress', 'missed')).toBe(false);
    expect(canTransition('completed_as_planned', 'in_progress')).toBe(false);
    expect(canTransition('cancelled', 'in_progress')).toBe(false);
    expect(() => assertTransition('completed_adapted', 'completed_as_planned')).toThrow();
  });

  it('classifies completion from logged sets, not from prescriptions', () => {
    const full = [
      { disposition: 'included' as const, targetSets: 3, loggedWorkingSets: 3 },
      { disposition: 'included' as const, targetSets: 2, loggedWorkingSets: 2 },
    ];
    expect(classifyCompletion('planned', full)).toBe('completed_as_planned');
    expect(classifyCompletion('planned', [{ ...full[0]!, loggedWorkingSets: 2 }, full[1]!])).toBe(
      'partially_completed',
    );
    expect(
      classifyCompletion(
        'planned',
        full.map((i) => ({ ...i, loggedWorkingSets: 0 })),
      ),
    ).toBeNull();
  });

  it('an adapted session that is fully done is completed_adapted, never completed_as_planned', () => {
    const items = [
      { disposition: 'included' as const, targetSets: 2, loggedWorkingSets: 2 },
      { disposition: 'deferred' as const, targetSets: 3, loggedWorkingSets: 0 },
    ];
    expect(classifyCompletion('adapted', items)).toBe('completed_adapted');
    // a planned session where the user deferred something mid-session is also an adapted completion
    expect(classifyCompletion('planned', items)).toBe('completed_adapted');
  });

  it('a partial adapted session is partially_completed', () => {
    expect(
      classifyCompletion('adapted', [
        { disposition: 'included', targetSets: 3, loggedWorkingSets: 1 },
      ]),
    ).toBe('partially_completed');
  });

  it('exercises added mid-session (no target) do not affect completion', () => {
    expect(
      classifyCompletion('planned', [
        { disposition: 'included', targetSets: 3, loggedWorkingSets: 3 },
        { disposition: 'included', targetSets: null, loggedWorkingSets: 1 },
      ]),
    ).toBe('completed_as_planned');
  });

  it('freeform sessions with sets are completed_as_planned', () => {
    expect(
      classifyCompletion('freeform', [
        { disposition: 'included', targetSets: null, loggedWorkingSets: 4 },
      ]),
    ).toBe('completed_as_planned');
  });
});

const set = (
  id: string,
  load: number | null,
  reps: number | null,
  extra: Partial<SetForRecords> = {},
): SetForRecords => ({
  id,
  load_kg: load,
  reps,
  duration_seconds: null,
  distance_m: null,
  is_warmup: false,
  ...extra,
});

describe('personal records', () => {
  it('first-ever performance is a baseline, not a PR', () => {
    expect(detectPersonalRecords('weight_reps', [set('a', 100, 5)], [])).toEqual([]);
  });

  it('detects heaviest load and e1RM improvements, one per type', () => {
    const prs = detectPersonalRecords(
      'weight_reps',
      [set('a', 102.5, 3), set('b', 100, 6)],
      [set('p', 100, 5)],
    );
    const types = prs.map((p) => p.recordType).sort();
    expect(types).toEqual(['e1rm', 'max_load']);
    expect(prs.find((p) => p.recordType === 'max_load')).toMatchObject({
      value: 102.5,
      previousValue: 100,
      setId: 'a',
    });
  });

  it('ignores warm-up sets and ties', () => {
    expect(
      detectPersonalRecords(
        'weight_reps',
        [set('w', 120, 1, { is_warmup: true }), set('a', 100, 5)],
        [set('p', 100, 5)],
      ),
    ).toEqual([]);
  });

  it('bodyweight tracks reps; holds track duration', () => {
    expect(
      detectPersonalRecords('bodyweight_reps', [set('a', null, 15)], [set('p', null, 12)])[0]
        ?.recordType,
    ).toBe('max_reps');
    const h = (id: string, d: number) => set(id, null, null, { duration_seconds: d });
    expect(detectPersonalRecords('hold', [h('a', 65)], [h('p', 60)])[0]?.recordType).toBe(
      'max_duration',
    );
  });

  it('e1RM estimate is only computed for 1–12 reps', () => {
    expect(estimateOneRepMax(100, 1)).toBe(100);
    expect(estimateOneRepMax(100, 10)).toBeCloseTo(133.33, 1);
    expect(estimateOneRepMax(100, 15)).toBeNull();
  });
});
