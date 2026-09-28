import { describe, it, expect } from 'vitest';
import { agreedFeeCents, checkFeeChange, feeWhen, parseGraceDays } from './feeRules';

describe('parseGraceDays (the owner chooses — no default)', () => {
  it('accepts 0: the fee applies the day after the due date', () => {
    expect(parseGraceDays(0)).toBe(0);
    expect(parseGraceDays('0')).toBe(0);
  });

  it('accepts whole days up to 90', () => {
    expect(parseGraceDays('7')).toBe(7);
    expect(parseGraceDays(90)).toBe(90);
  });

  it('never fills in a default when the owner left it blank', () => {
    expect(parseGraceDays(undefined)).toBeNull();
    expect(parseGraceDays('')).toBeNull();
    expect(parseGraceDays(null)).toBeNull();
  });

  it('rejects negatives, fractions, too-long and non-numbers', () => {
    expect(parseGraceDays(-1)).toBeNull();
    expect(parseGraceDays(2.5)).toBeNull();
    expect(parseGraceDays(91)).toBeNull();
    expect(parseGraceDays('soon')).toBeNull();
  });
});

describe('feeWhen (wording the client sees)', () => {
  it('0 days → "if it\'s not paid by the due date" (never "0 days after")', () => {
    expect(feeWhen(0)).toBe("if it's not paid by the due date");
  });

  it('1 day is singular', () => {
    expect(feeWhen(1)).toBe('if unpaid 1 day after the due date');
  });

  it('several days', () => {
    expect(feeWhen(7)).toBe('if unpaid 7 days after the due date');
  });
});

describe('agreedFeeCents', () => {
  it('flat fee: dollars → cents', () => {
    expect(agreedFeeCents(25000, { kind: 'flat', amount: 25 })).toBe(2500);
  });

  it('percent fee: a share of the invoice amount, rounded to the cent', () => {
    expect(agreedFeeCents(25000, { kind: 'percent', amount: 10 })).toBe(2500);
    expect(agreedFeeCents(12345, { kind: 'percent', amount: 5 })).toBe(617);
  });

  it('no fee', () => {
    expect(agreedFeeCents(25000, { kind: 'none', amount: 0 })).toBe(0);
  });
});

describe('checkFeeChange', () => {
  it('allows any amount up to the fee in the invoice terms', () => {
    expect(checkFeeChange(1000, 2500)).toBeNull();
    expect(checkFeeChange(2500, 2500)).toBeNull();
  });

  it('never allows more than the invoice terms', () => {
    expect(checkFeeChange(2501, 2500)).toMatch(/can't be more than \$25\.00/);
  });

  it('sends $0 to waive instead', () => {
    expect(checkFeeChange(0, 2500)).toMatch(/waive/i);
    expect(checkFeeChange(-5, 2500)).toMatch(/waive/i);
  });

  it('rejects a missing or non-numeric amount', () => {
    expect(checkFeeChange(NaN, 2500)).toMatch(/amount/i);
  });
});
