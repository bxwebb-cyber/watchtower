import { describe, it, expect } from 'vitest';
import { jobsStartDate, createdSinceStart } from './startDate';

describe('jobsStartDate', () => {
  it('is off when unset', () => {
    expect(jobsStartDate({})).toBeNull();
    expect(createdSinceStart({})).toEqual({});
  });
  it('reads a date', () => {
    expect(createdSinceStart({ SCHEDULER_START: '2026-10-01' })).toEqual({ createdAt: { gte: new Date('2026-10-01T00:00:00Z') } });
  });
  it('refuses a typo instead of silently emailing everything', () => {
    expect(() => jobsStartDate({ SCHEDULER_START: 'Oct 1' })).toThrow(/2026-10-01/);
  });
});
