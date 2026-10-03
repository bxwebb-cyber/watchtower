import { describe, it, expect } from 'vitest';
import { dueTimestamp } from './invoiceCreator';

const nyDate = (sec: number) =>
  new Date(sec * 1000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const laDate = (sec: number) =>
  new Date(sec * 1000).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

describe('dueTimestamp', () => {
  it('is still in the future on the evening before, in New York (the Oct 2, 11:45pm bug)', () => {
    const now = Date.UTC(2026, 9, 3, 3, 45) / 1000; // Oct 2, 11:45pm EDT
    expect(dueTimestamp(new Date('2026-10-03T00:00:00Z'))).toBeGreaterThan(now);
  });
  it('lands on the same calendar date in New York and Los Angeles, summer and winter', () => {
    for (const d of ['2026-10-03', '2026-12-15', '2027-03-01', '2027-07-04']) {
      const sec = dueTimestamp(new Date(`${d}T00:00:00Z`));
      expect(nyDate(sec)).toBe(d);
      expect(laDate(sec)).toBe(d);
    }
  });
  it('ignores the time of day (recurring runs pass "now + N days")', () => {
    expect(dueTimestamp(new Date('2026-10-10T13:00:00Z'))).toBe(dueTimestamp(new Date('2026-10-10T00:00:00Z')));
  });
});
