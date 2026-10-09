import { describe, it, expect } from 'vitest';
import { parseLines, linesTotalCents, stripeItemFor, reissueItems } from './invoiceLines';
import { usd } from '../lib/money';

describe('parseLines', () => {
  it('cleans and totals lines', () => {
    const r = parseLines([{ description: ' Logo  design ', quantity: 1, price: 500 }, { description: 'Consulting', quantity: 3, price: 90 }]);
    expect(r).toEqual({ lines: [{ description: 'Logo design', quantity: 1, unitCents: 50000 }, { description: 'Consulting', quantity: 3, unitCents: 9000 }] });
    expect('lines' in r && linesTotalCents(r.lines)).toBe(77000);
  });
  it('quantity defaults to 1 and can be fractional', () => {
    const r = parseLines([{ description: 'Hours', quantity: 1.5, price: 90 }, { description: 'Setup', price: 25 }]);
    expect('lines' in r && linesTotalCents(r.lines)).toBe(13500 + 2500);
  });
  it('rejects empty, blank and bad lines with the line number', () => {
    expect(parseLines([])).toHaveProperty('error');
    expect(parseLines([{ description: '', price: 1200 }], 'Invoice for Sam')).toEqual({ lines: [{ description: 'Invoice for Sam', quantity: 1, unitCents: 120000 }] });
    expect(parseLines([{ description: 'A', price: 10 }, { description: '', price: 5 }])).toEqual({ error: 'Line 2: describe the service.' });
    expect(parseLines([{ description: 'A', price: 0 }])).toEqual({ error: 'Line 1: the price must be more than $0.' });
    expect(parseLines([{ description: 'A', quantity: -1, price: 5 }])).toHaveProperty('error');
    expect(parseLines([{ description: 'A', quantity: 1.333, price: 5 }])).toHaveProperty('error');
  });
});

describe('stripeItemFor', () => {
  it('quantity 1: the description as typed', () => {
    expect(stripeItemFor({ description: 'Logo', quantity: 1, unitCents: 50000 }, usd)).toEqual({ description: 'Logo', amount: 50000 });
  });
  it('shows the math otherwise', () => {
    expect(stripeItemFor({ description: 'Consulting', quantity: 1.5, unitCents: 9000 }, usd)).toEqual({ description: 'Consulting (1.5 × $90.00)', amount: 13500 });
  });
});

describe('reissueItems', () => {
  const lines = [{ description: 'Logo', quantity: 1, unitCents: 50000 }, { description: 'Hours', quantity: 2, unitCents: 9000 }];
  it('keeps every line when they still add up to the balance', () => {
    expect(reissueItems(lines, 68000, 'RS-0001', usd)).toEqual([
      { description: 'Logo', amount: 50000 },
      { description: 'Hours (2 × $90.00)', amount: 18000 },
    ]);
  });
  it('one balance line when partly paid or no lines', () => {
    expect(reissueItems(lines, 30000, 'RS-0001', usd)).toEqual([{ description: 'Invoice RS-0001', amount: 30000 }]);
    expect(reissueItems(null, 25000, 'RS-0002', usd)).toEqual([{ description: 'Invoice RS-0002', amount: 25000 }]);
  });
});
