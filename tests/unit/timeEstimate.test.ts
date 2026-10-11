import {
  estimateExerciseSeconds,
  estimateSessionMinutes,
  TIME_MODEL,
} from '@/domain/rules/timeEstimate';

describe('time estimate model', () => {
  it('counts every set, full planned rest between sets, and a transition', () => {
    const s = estimateExerciseSeconds({
      sets: 3,
      repMax: 10,
      restSeconds: 120,
      loggingType: 'weight_reps',
    });
    const perSet = 10 * TIME_MODEL.secondsPerRep + TIME_MODEL.setSetupSeconds;
    expect(s).toBe(3 * perSet + 2 * 120 + TIME_MODEL.transitionSeconds);
  });

  it('adds warm-up and rounds up to 5 minutes (conservative)', () => {
    const m = estimateSessionMinutes([
      { sets: 1, repMax: 5, restSeconds: 0, loggingType: 'weight_reps' },
    ]);
    expect(m % 5).toBe(0);
    expect(m * 60).toBeGreaterThanOrEqual(TIME_MODEL.warmupSeconds);
  });

  it('uses the rep range as seconds for timed holds', () => {
    const hold = estimateExerciseSeconds({
      sets: 2,
      repMax: 60,
      restSeconds: 60,
      loggingType: 'hold',
    });
    expect(hold).toBe(2 * (60 + TIME_MODEL.setSetupSeconds) + 60 + TIME_MODEL.transitionSeconds);
  });

  it('empty session is zero', () => {
    expect(estimateSessionMinutes([])).toBe(0);
  });
});
