import { describe, it, expect } from 'vitest';
import {
  dayOffset,
  computeNextStep,
  shouldSkipPreDue,
  addDays,
  isPastFeeDeadline,
  isStaleFeeWarning,
  scheduleFor,
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

  it('sends the fee warning while the deadline is still ahead', () => {
    expect(isStaleFeeWarning('fee_warning', { ...fee, offset: 5 })).toBe(false);
  });

  it('skips the fee warning once the deadline has passed (catch-up after a missed run)', () => {
    expect(isStaleFeeWarning('fee_warning', { ...fee, offset: 8 })).toBe(true);
  });

  it('skips the fee warning once the fee is on the bill', () => {
    expect(isStaleFeeWarning('fee_warning', { ...fee, feeApplied: true, offset: 5 })).toBe(true);
  });

  it('never skips the "past due" nudge on an invoice with no fee', () => {
    expect(isStaleFeeWarning('t+3', { ...fee, hasLateFee: false, offset: 3 })).toBe(false);
  });

  it('never skips the 14-day step (the owner decides)', () => {
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

describe('scheduleFor (at most one reminder before, one after)', () => {
  const steps = (o: { hasLateFee: boolean; graceDays: number }) =>
    scheduleFor(o).map((s) => `${s.step}@${s.offsetDays}`);

  it('7-day grace: reminder 4 days before, fee warning 3 days before the fee lands, owner at 14', () => {
    // due Oct 1 → reminder Sep 27, warning Oct 6 ("pay by Oct 8"), fee Oct 9.
    expect(steps({ hasLateFee: true, graceDays: 7 })).toEqual(['t-4@-4', 'fee_warning@5', 't+14@14']);
  });

  it('no grace (fee the day after the due date): no separate warning — the reminder already states it', () => {
    expect(steps({ hasLateFee: true, graceDays: 0 })).toEqual(['t-4@-4', 't+14@14']);
  });

  it('short grace: the warning still comes before the fee', () => {
    expect(steps({ hasLateFee: true, graceDays: 1 })).toEqual(['t-4@-4', 'fee_warning@1', 't+14@14']);
    expect(steps({ hasLateFee: true, graceDays: 3 })).toEqual(['t-4@-4', 'fee_warning@1', 't+14@14']);
  });

  it('no late fee: one "past due" nudge at 3 days late', () => {
    expect(steps({ hasLateFee: false, graceDays: 0 })).toEqual(['t-4@-4', 't+3@3', 't+14@14']);
  });

  it('never schedules the old 7-days-before, 3-days-before or due-date emails', () => {
    const all = [0, 1, 7, 30].flatMap((g) => steps({ hasLateFee: true, graceDays: g }));
    expect(all.some((s) => /^(t-7|t-3|due)@/.test(s))).toBe(false);
  });
});

describe('computeNextStep', () => {
  const schedule = scheduleFor({ hasLateFee: true, graceDays: 7 });
  const due = new Date('2026-10-01');
  const at = (d: number) => dayOffset(addDays(due, d), due);

  it('nothing before 4 days out', () => {
    expect(computeNextStep(at(-10), new Set(), schedule)).toBeUndefined();
  });

  it('the reminder 4 days before', () => {
    expect(computeNextStep(at(-4), new Set(), schedule)?.step).toBe('t-4');
  });

  it('nothing on the due date or right after (no due-today email)', () => {
    expect(computeNextStep(at(0), new Set(['t-4']), schedule)).toBeUndefined();
    expect(computeNextStep(at(3), new Set(['t-4']), schedule)).toBeUndefined();
  });

  it('the fee warning on day 5', () => {
    expect(computeNextStep(at(5), new Set(['t-4']), schedule)?.step).toBe('fee_warning');
  });

  it('catches up to a missed step, but never back-fills older ones', () => {
    expect(computeNextStep(at(6), new Set(['t-4']), schedule)?.step).toBe('fee_warning');
    expect(computeNextStep(at(6), new Set(), schedule)?.step).toBe('fee_warning');
    expect(computeNextStep(at(14), new Set(), schedule)?.step).toBe('t+14');
  });

  it('nothing once a step is sent', () => {
    expect(computeNextStep(at(20), new Set(['t+14']), schedule)).toBeUndefined();
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