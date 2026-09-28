import { describe, it, expect } from 'vitest';
import {
  dayOffset,
  computeNextStep,
  shouldSkipPreDue,
  addDays,
  isPastFeeDeadline,
  isStaleFeeWarning,
  SCHEDULE,
} from './reminderEngine';

describe('isPastFeeDeadline', () => {
  const due = new Date('2026-09-18');

  it('is not past on the deadline day itself (due + grace)', () => {
    expect(isPastFeeDeadline(addDays(due, 7), due, 7)).toBe(false);
  });

  it('is past the morning after the deadline', () => {
    expect(isPastFeeDeadline(addDays(due, 8), due, 7)).toBe(true);
  });

  it('respects a custom grace period', () => {
    expect(isPastFeeDeadline(addDays(due, 3), due, 3)).toBe(false);
    expect(isPastFeeDeadline(addDays(due, 4), due, 3)).toBe(true);
  });
});

describe('isStaleFeeWarning', () => {
  const fee = { hasLateFee: true, feeApplied: false, graceDays: 7 };

  it('sends the t+7 warning on the deadline day ("pay today to avoid the fee")', () => {
    expect(isStaleFeeWarning('t+7', { ...fee, offset: 7 })).toBe(false);
  });

  it('skips the t+7 warning once the deadline has passed', () => {
    expect(isStaleFeeWarning('t+7', { ...fee, offset: 8 })).toBe(true);
  });

  it('skips the t+7 warning once the fee is applied', () => {
    expect(isStaleFeeWarning('t+7', { ...fee, feeApplied: true, offset: 7 })).toBe(true);
  });

  it('skips the t+3 warning when a short grace period has already run out', () => {
    expect(isStaleFeeWarning('t+3', { ...fee, graceDays: 2, offset: 3 })).toBe(true);
  });

  it('never skips when the invoice has no late fee', () => {
    expect(isStaleFeeWarning('t+7', { ...fee, hasLateFee: false, offset: 10 })).toBe(false);
  });

  it('never skips the t+14 notice (it shows the balance with the fee)', () => {
    expect(isStaleFeeWarning('t+14', { ...fee, feeApplied: true, offset: 14 })).toBe(false);
  });
});

// The schedule constant mirrors the one in reminderEngine.ts

describe('dayOffset', () => {
  it('returns 0 on the due date', () => {
    const d = new Date('2026-10-01');
    expect(dayOffset(d, d)).toBe(0);
  });

  it('returns negative before the due date', () => {
    const due = new Date('2026-10-08');
    const today = new Date('2026-10-01');
    expect(dayOffset(today, due)).toBe(-7);
  });

  it('returns positive after the due date', () => {
    const due = new Date('2026-10-01');
    const today = new Date('2026-10-08');
    expect(dayOffset(today, due)).toBe(7);
  });

  it('handles same-day different time', () => {
    const due = new Date('2026-10-01T23:00:00');
    const today = new Date('2026-10-01T01:00:00');
    expect(dayOffset(today, due)).toBe(0);
  });

  it('returns 1 for one day after due', () => {
    const due = new Date('2026-10-01');
    const today = new Date('2026-10-02');
    expect(dayOffset(today, due)).toBe(1);
  });

  it('returns -1 for one day before due', () => {
    const due = new Date('2026-10-02');
    const today = new Date('2026-10-01');
    expect(dayOffset(today, due)).toBe(-1);
  });
});

describe('computeNextStep', () => {
  const due = new Date('2026-10-15');

  it("returns t-7 when 7 days before due and nothing sent", () => {
    const today = addDays(due, -7);
    const offset = dayOffset(today, due);
    expect(offset).toBe(-7);
    const step = computeNextStep(offset, new Set(), { schedule: SCHEDULE });
    expect(step?.step).toBe('t-7');
  });

  it("returns t-3 when 3 days before due and t-7 already sent", () => {
    const today = addDays(due, -3);
    const offset = dayOffset(today, due);
    const sent = new Set(['t-7']);
    const step = computeNextStep(offset, sent, { schedule: SCHEDULE });
    expect(step?.step).toBe('t-3');
  });

  it("returns due on the due date with pre-due steps sent", () => {
    const today = due;
    const offset = dayOffset(today, due);
    const sent = new Set(['t-7', 't-3']);
    const step = computeNextStep(offset, sent, { schedule: SCHEDULE });
    expect(step?.step).toBe('due');
  });

  it("returns t+3 when 3 days past due", () => {
    const today = addDays(due, 3);
    const offset = dayOffset(today, due);
    const sent = new Set(['t-7', 't-3', 'due']);
    const step = computeNextStep(offset, sent, { schedule: SCHEDULE });
    expect(step?.step).toBe('t+3');
  });

  it("returns t+14 when 14+ days past due and all earlier sent", () => {
    const today = addDays(due, 20);
    const offset = dayOffset(today, due);
    const sent = new Set(['t-7', 't-3', 'due', 't+3', 't+7']);
    const step = computeNextStep(offset, sent, { schedule: SCHEDULE });
    expect(step?.step).toBe('t+14');
  });

  it("returns undefined when all steps are already sent", () => {
    const today = addDays(due, 20);
    const offset = dayOffset(today, due);
    const sent = new Set(['t-7', 't-3', 'due', 't+3', 't+7', 't+14']);
    const step = computeNextStep(offset, sent, { schedule: SCHEDULE });
    expect(step).toBeUndefined();
  });

  it("catches up: returns t+7 when at day 13 (between t+7 and t+14) and t+7 was missed", () => {
    const today = addDays(due, 13);
    const offset = dayOffset(today, due);
    const sent = new Set(['t-7', 't-3', 'due', 't+3']);
    const step = computeNextStep(offset, sent, { schedule: SCHEDULE });
    expect(step?.step).toBe('t+7');
  });

  it("returns undefined when offset is before the earliest step", () => {
    const today = addDays(due, -14);
    const offset = dayOffset(today, due);
    const step = computeNextStep(offset, new Set(), { schedule: SCHEDULE });
    expect(step).toBeUndefined();
  });

  it("never back-fills: a missed t-7 is not sent once t-3 has gone out", () => {
    const today = addDays(due, -3);
    const offset = dayOffset(today, due);
    const sent = new Set(['t-3']);
    const step = computeNextStep(offset, sent, { schedule: SCHEDULE });
    expect(step).toBeUndefined();
  });

  it("never back-fills: after 'due' is sent, a second run the same day sends nothing", () => {
    const offset = dayOffset(due, due);
    const sent = new Set(['due']); // t-7 / t-3 were missed (e.g. no scheduler yet)
    const step = computeNextStep(offset, sent, { schedule: SCHEDULE });
    expect(step).toBeUndefined();
  });

  it("never back-fills: the day after 'due', a missed t-3 ('due in 3 days') is not sent", () => {
    const offset = dayOffset(addDays(due, 1), due);
    const sent = new Set(['due']);
    const step = computeNextStep(offset, sent, { schedule: SCHEDULE });
    expect(step).toBeUndefined();
  });

  it("returns undefined for empty schedule", () => {
    const step = computeNextStep(5, new Set(), { schedule: [] });
    expect(step).toBeUndefined();
  });

  it("handles offset=exactly boundary for t+7", () => {
    const today = addDays(due, 7);
    const offset = dayOffset(today, due);
    const sent = new Set(['t-7', 't-3', 'due', 't+3']);
    const step = computeNextStep(offset, sent, { schedule: SCHEDULE });
    expect(step?.step).toBe('t+7');
  });
});

describe('shouldSkipPreDue', () => {
  it("does NOT skip t-7 when invoice was created 10 days before due", () => {
    const dueDay = new Date('2026-10-15');
    const createdAt = new Date('2026-10-05');
    expect(shouldSkipPreDue(-7, dueDay, createdAt, 2)).toBe(false);
  });

  it("skips t-7 when invoice was created only 3 days before due", () => {
    const dueDay = new Date('2026-10-15');
    const createdAt = new Date('2026-10-12');
    expect(shouldSkipPreDue(-7, dueDay, createdAt, 2)).toBe(true);
  });

  it("skips t-3 when invoice was created 1 day before due", () => {
    const dueDay = new Date('2026-10-15');
    const createdAt = new Date('2026-10-14');
    expect(shouldSkipPreDue(-3, dueDay, createdAt, 2)).toBe(true);
  });

  it("does NOT skip t-3 when invoice was created 7 days before due", () => {
    const dueDay = new Date('2026-10-15');
    const createdAt = new Date('2026-10-08');
    expect(shouldSkipPreDue(-3, dueDay, createdAt, 2)).toBe(false);
  });

  it("skips t-3 when invoice was created only 5 days before due (scheduled day 2 days after creation)", () => {
    const dueDay = new Date('2026-10-15');
    const createdAt = new Date('2026-10-10');
    expect(shouldSkipPreDue(-3, dueDay, createdAt, 2)).toBe(true);
  });

  it("never skips past-due steps (offset >= 0)", () => {
    const dueDay = new Date('2026-10-15');
    const createdAt = new Date('2026-10-20'); // created after due
    expect(shouldSkipPreDue(0, dueDay, createdAt, 2)).toBe(false);
    expect(shouldSkipPreDue(3, dueDay, createdAt, 2)).toBe(false);
    expect(shouldSkipPreDue(7, dueDay, createdAt, 2)).toBe(false);
  });

  it("respects custom minDaysAfterCreate", () => {
    const dueDay = new Date('2026-10-15');
    const createdAt = new Date('2026-10-07');
    // t-7 lands on Oct 8, which is 1 day after creation
    expect(shouldSkipPreDue(-7, dueDay, createdAt, 0)).toBe(false);
    // min=1 means 1 <= 1 → skip
    expect(shouldSkipPreDue(-7, dueDay, createdAt, 1)).toBe(true);
  });
});

describe('addDays', () => {
  it('adds positive days', () => {
    const d = new Date('2026-10-01');
    expect(addDays(d, 3).toISOString().slice(0, 10)).toBe('2026-10-04');
  });

  it('subtracts days with negative argument', () => {
    const d = new Date('2026-10-15');
    expect(addDays(d, -7).toISOString().slice(0, 10)).toBe('2026-10-08');
  });

  it('does not mutate the original date', () => {
    const d = new Date('2026-10-01');
    const copy = addDays(d, 5);
    expect(d.toISOString().slice(0, 10)).toBe('2026-10-01');
    expect(copy.toISOString().slice(0, 10)).toBe('2026-10-06');
  });
});