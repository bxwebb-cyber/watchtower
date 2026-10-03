import { describe, it, expect } from 'vitest';
import { advanceRunDate, computeInitialNextRun } from './templateEngine';

describe('advanceRunDate', () => {
  it('advances monthly by one month', () => {
    const d = new Date('2026-10-01');
    const next = advanceRunDate(d, 'monthly');
    expect(next.toISOString().slice(0, 10)).toBe('2026-11-01');
  });

  it('advances monthly across year boundary', () => {
    const d = new Date('2026-12-15');
    const next = advanceRunDate(d, 'monthly');
    expect(next.toISOString().slice(0, 10)).toBe('2027-01-15');
  });

  it('handles short month correctly (monthly from Jan 31)', () => {
    const d = new Date('2026-01-31');
    const next = advanceRunDate(d, 'monthly');
    // Feb 28 in 2026 (non-leap year)
    expect(next.toISOString().slice(0, 10)).toBe('2026-02-28');
  });

  it('advances weekly by 7 days', () => {
    const d = new Date('2026-10-01');
    const next = advanceRunDate(d, 'weekly');
    expect(next.toISOString().slice(0, 10)).toBe('2026-10-08');
  });

  it('advances biweekly by 14 days', () => {
    const d = new Date('2026-10-01');
    const next = advanceRunDate(d, 'biweekly');
    expect(next.toISOString().slice(0, 10)).toBe('2026-10-15');
  });

  it('advances custom to next month on the 15th', () => {
    const d = new Date('2026-10-15');
    const next = advanceRunDate(d, 'custom', 15);
    expect(next.toISOString().slice(0, 10)).toBe('2026-11-15');
  });

  it('caps custom day to days in month', () => {
    const d = new Date('2026-01-31');
    const next = advanceRunDate(d, 'custom', 31);
    // Feb has 28 days in 2026
    expect(next.toISOString().slice(0, 10)).toBe('2026-02-28');
  });

  it('does not mutate the original date', () => {
    const d = new Date('2026-10-01');
    const next = advanceRunDate(d, 'monthly');
    expect(d.toISOString().slice(0, 10)).toBe('2026-10-01');
    expect(next.toISOString().slice(0, 10)).toBe('2026-11-01');
  });
});

describe('computeInitialNextRun', () => {
  it('returns start date for monthly frequency', () => {
    const start = new Date('2026-10-15');
    const next = computeInitialNextRun(start, 'monthly');
    expect(next.toISOString().slice(0, 10)).toBe('2026-10-15');
  });

  it('returns start date for weekly frequency', () => {
    const start = new Date('2026-10-01');
    const next = computeInitialNextRun(start, 'weekly');
    expect(next.toISOString().slice(0, 10)).toBe('2026-10-01');
  });

  it('returns custom day on start month when start is before custom day', () => {
    const start = new Date('2026-10-05');
    const next = computeInitialNextRun(start, 'custom', 15);
    expect(next.toISOString().slice(0, 10)).toBe('2026-10-15');
  });

  it('advances to next month when start is after custom day', () => {
    const start = new Date('2026-10-20');
    const next = computeInitialNextRun(start, 'custom', 15);
    expect(next.toISOString().slice(0, 10)).toBe('2026-11-15');
  });

  it('handles custom day on same day as start', () => {
    const start = new Date('2026-10-15');
    const next = computeInitialNextRun(start, 'custom', 15);
    // Should return same day (it fires ON the start date)
    expect(next.toISOString().slice(0, 10)).toBe('2026-10-15');
  });

  it('caps custom day to days in month', () => {
    const start = new Date('2026-01-28');
    const next = computeInitialNextRun(start, 'custom', 31);
    // Jan has 31 days, so Jan 31 is fine
    // But if start was Feb 1 with custom day 31 and Feb has 28 days:
    expect(next.toISOString().slice(0, 10)).toBe('2026-01-31');
  });

  it('handles Feb 28 cap for custom day 31', () => {
    // If we start Feb 15 with custom day 31, Feb has 28 days in 2026
    // So it should cap to Feb 28. Wait — 15 < 28, so Feb 28 is after start
    // Actually: computeInitialNextRun for custom — if start is Feb 15 and customDay is 31,
    // candidate = Feb 28 (capped), which is >= Feb 15, so it returns Feb 28.
    // Good — first run happens on Feb 28.
    const start = new Date('2026-02-15');
    const next = computeInitialNextRun(start, 'custom', 31);
    expect(next.toISOString().slice(0, 10)).toBe('2026-02-28');
  });
});
describe('custom "last day of the month" (customDay 31)', () => {
  it('lands on the last day of short months and back on the 31st', () => {
    expect(computeInitialNextRun(new Date('2026-02-03T00:00:00Z'), 'custom', 31).toISOString().slice(0, 10)).toBe('2026-02-28');
    expect(computeInitialNextRun(new Date('2028-02-03T00:00:00Z'), 'custom', 31).toISOString().slice(0, 10)).toBe('2028-02-29');
    const feb = advanceRunDate(new Date('2026-01-31T00:00:00Z'), 'custom', 31);
    expect(feb.toISOString().slice(0, 10)).toBe('2026-02-28');
    expect(advanceRunDate(feb, 'custom', 31).toISOString().slice(0, 10)).toBe('2026-03-31');
    expect(advanceRunDate(new Date('2026-03-31T00:00:00Z'), 'custom', 31).toISOString().slice(0, 10)).toBe('2026-04-30');
  });
});
