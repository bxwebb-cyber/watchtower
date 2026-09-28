import { describe, it, expect } from 'vitest';
import { agreedFeeCents, checkFeeChange } from './feeRules';

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
