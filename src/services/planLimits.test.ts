import { describe, it, expect } from 'vitest';
import { soloLimitMessage, monthStart } from './planLimits';

const weekly = (email: string, n: number) => Array.from({ length: n }, () => email);

describe('soloLimitMessage', () => {
  it('allows the first invoice of the month', () => {
    expect(soloLimitMessage([], 'a@x.com')).toBeNull();
  });

  it('allows five weekly clients (5 invoices each)', () => {
    const month = ['a', 'b', 'c', 'd'].flatMap((c) => weekly(`${c}@x.com`, 5)).concat(weekly('e@x.com', 4));
    expect(soloLimitMessage(month, 'e@x.com')).toBeNull();
  });

  it('blocks a sixth client', () => {
    const month = ['a', 'b', 'c', 'd', 'e'].map((c) => `${c}@x.com`);
    expect(soloLimitMessage(month, 'f@x.com')).toMatch(/5 clients a month/);
  });

  it('still lets an existing client be invoiced when 5 clients are in use', () => {
    const month = ['a', 'b', 'c', 'd', 'e'].map((c) => `${c}@x.com`);
    expect(soloLimitMessage(month, 'c@x.com')).toBeNull();
  });

  it('allows the 10th invoice for a client and blocks the 11th', () => {
    expect(soloLimitMessage(weekly('a@x.com', 9), 'a@x.com')).toBeNull();
    expect(soloLimitMessage(weekly('a@x.com', 10), 'a@x.com')).toMatch(/10 invoices per client/);
  });

  it('treats email case and spaces as the same client', () => {
    const month = ['a', 'b', 'c', 'd'].map((c) => `${c}@x.com`).concat(' E@X.com ');
    expect(soloLimitMessage(month, 'e@x.com')).toBeNull();
  });
});

describe('monthStart', () => {
  it('is the 1st of the month, UTC', () => {
    expect(monthStart(new Date('2026-09-29T15:00:00Z')).toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });
});
