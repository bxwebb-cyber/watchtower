import { describe, it, expect } from 'vitest';
import { feeStep } from './feeEngine';

// The morning run is 9am New York = 13:00 UTC; due dates are stored as UTC midnight.
const run = (day: string) => new Date(`${day}T13:00:00Z`);
const due = new Date('2026-10-03T00:00:00Z');

describe('feeStep (fee added automatically, owner warned the day before)', () => {
  it('0 grace days: due Oct 3 → heads-up Oct 3, fee Oct 4', () => {
    expect(feeStep({ now: run('2026-10-02'), due, graceDays: 0, headsUpAt: null })).toBe('wait');
    expect(feeStep({ now: run('2026-10-03'), due, graceDays: 0, headsUpAt: null })).toBe('heads_up');
    expect(feeStep({ now: run('2026-10-04'), due, graceDays: 0, headsUpAt: run('2026-10-03') })).toBe('apply');
  });
  it('7 grace days: heads-up Oct 10, fee Oct 11', () => {
    expect(feeStep({ now: run('2026-10-09'), due, graceDays: 7, headsUpAt: null })).toBe('wait');
    expect(feeStep({ now: run('2026-10-10'), due, graceDays: 7, headsUpAt: null })).toBe('heads_up');
    expect(feeStep({ now: run('2026-10-10'), due, graceDays: 7, headsUpAt: run('2026-10-10') })).toBe('hold');
    expect(feeStep({ now: run('2026-10-11'), due, graceDays: 7, headsUpAt: run('2026-10-10') })).toBe('apply');
  });
  it('a missed heads-up (catch-up run after the deadline) still gives the owner a day', () => {
    expect(feeStep({ now: run('2026-10-06'), due, graceDays: 0, headsUpAt: null })).toBe('heads_up');
    expect(feeStep({ now: run('2026-10-06'), due, graceDays: 0, headsUpAt: run('2026-10-06') })).toBe('hold');
    expect(feeStep({ now: run('2026-10-07'), due, graceDays: 0, headsUpAt: run('2026-10-06') })).toBe('apply');
  });
  it('a heads-up sent late in the evening (New York) still counts as that day', () => {
    const lateEvening = new Date('2026-10-04T02:30:00Z'); // Oct 3, 10:30pm EDT
    expect(feeStep({ now: run('2026-10-04'), due, graceDays: 0, headsUpAt: lateEvening })).toBe('apply');
  });
});
