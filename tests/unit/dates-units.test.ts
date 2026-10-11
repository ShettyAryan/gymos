import {
  addDays,
  dateRange,
  diffDays,
  isDateKey,
  startOfWeek,
  toDateKey,
  weekdayOf,
} from '@/utils/dates';
import { displayLoad, kgToLb, lbToKg, parseDecimal, parseLoad } from '@/utils/units';

describe('date keys', () => {
  it('adds days across month/year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('is unaffected by daylight-saving transitions', () => {
    // US DST starts 2026-03-08, EU 2026-03-29 and ends 2026-10-25.
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
    expect(diffDays('2026-03-07', '2026-03-09')).toBe(2);
    expect(diffDays('2026-10-24', '2026-10-26')).toBe(2);
  });

  it('derives the local calendar date in a given time zone around midnight', () => {
    const instant = new Date('2026-10-11T23:30:00Z');
    expect(toDateKey(instant, 'UTC')).toBe('2026-10-11');
    expect(toDateKey(instant, 'Asia/Kolkata')).toBe('2026-10-12'); // UTC+5:30
    expect(toDateKey(instant, 'America/Los_Angeles')).toBe('2026-10-11');
  });

  it('weekday and ISO week start', () => {
    expect(weekdayOf('2026-10-11')).toBe(0); // Sunday
    expect(startOfWeek('2026-10-11')).toBe('2026-10-05');
    expect(startOfWeek('2026-10-05')).toBe('2026-10-05');
    expect(dateRange('2026-10-05', '2026-10-11')).toHaveLength(7);
  });

  it('validates keys', () => {
    expect(isDateKey('2026-02-29')).toBe(false);
    expect(isDateKey('2028-02-29')).toBe(true);
    expect(isDateKey('2026-1-1')).toBe(false);
  });
});

describe('units', () => {
  it('converts kg/lb round-trip', () => {
    expect(lbToKg(kgToLb(100))).toBeCloseTo(100, 10);
    expect(displayLoad(100, 'imperial')).toBe(220.5);
    expect(displayLoad(62.5, 'metric')).toBe(62.5);
  });

  it('parses user input to canonical kg', () => {
    expect(parseLoad('62,5', 'metric')).toBe(62.5);
    expect(parseLoad('225', 'imperial')).toBeCloseTo(102.058, 3);
    expect(parseLoad('', 'metric')).toBeNull();
    expect(parseDecimal('-3')).toBeNull();
    expect(parseDecimal('abc')).toBeNull();
  });
});
