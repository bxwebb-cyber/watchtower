import { describe, it, expect } from 'vitest';
import { waiverReport, WaiverInvoice } from './waivers';

const inv = (o: Partial<WaiverInvoice>): WaiverInvoice => ({
  amount: 100000, dueDate: new Date('2026-08-01'), paidAt: null, createdAt: new Date('2026-07-15'),
  feeStatus: null, feeAmountCents: null, waiveNote: null, feePolicy: { kind: 'flat', amount: 25 },
  client: { name: 'Kestrel Foods', email: 'ap@kestrel.com' }, waivedAt: null, ...o,
});
const NOW = new Date('2026-10-01T12:00:00Z');

describe('waiverReport', () => {
  it('counts waived fees in the month they were waived', () => {
    const r = waiverReport([
      inv({ feeStatus: 'waived', waivedAt: new Date('2026-09-10'), feeAmountCents: 2500 }),
      inv({ feeStatus: 'waived', waivedAt: new Date('2026-09-20') }),
      inv({ feeStatus: 'paid', feeAmountCents: 2500 }),
    ], NOW);
    expect(r.months).toHaveLength(12);
    expect(r.months.at(-2)).toEqual({ month: '2026-09', count: 2, cents: 5000 });
    expect(r.months.at(-1)).toEqual({ month: '2026-10', count: 0, cents: 0 });
  });

  it('ranks clients by waivers, with their lateness and the owner\'s notes', () => {
    const r = waiverReport([
      inv({ feeStatus: 'waived', waiveNote: 'Sends me referrals', paidAt: new Date('2026-08-05') }),
      inv({ feeStatus: 'waived', waiveNote: 'Rough month', paidAt: new Date('2026-08-09') }),
      inv({ feeStatus: 'open', paidAt: new Date('2026-07-30') }),
      inv({ client: { name: 'Harbor & Vine', email: 'hv@x.com' }, feeStatus: 'waived' }),
      inv({ client: { name: 'Northline', email: 'n@x.com' }, feeStatus: 'paid' }),
    ], NOW);
    expect(r.clients.map((c) => c.name)).toEqual(['Kestrel Foods', 'Harbor & Vine']);
    expect(r.clients[0]).toMatchObject({ waivedCount: 2, waivedCents: 5000, feesDue: 3, paidCount: 3, paidLateCount: 2, notes: ['Rough month', 'Sends me referrals'] });
  });

  it('uses the fee in the terms when no amount was stored', () => {
    const r = waiverReport([inv({ feeStatus: 'waived', feePolicy: { kind: 'percent', amount: 5 } })], NOW);
    expect(r.clients[0].waivedCents).toBe(5000);
  });
});

import { feeOpportunity } from './waivers';

describe('feeOpportunity', () => {
  const NOW2 = new Date('2026-10-15T12:00:00Z');
  const base = (o: Partial<WaiverInvoice>) => inv({ createdAt: new Date('2026-08-01'), ...o });

  it('adds waived fees and late no-fee invoices priced at the owner\'s usual rate for that size', () => {
    const r = feeOpportunity([
      base({ feeStatus: 'waived', feeAmountCents: 2500, waivedAt: new Date('2026-09-01') }), // $1,000 + $25 flat → 2.5%
      base({ feeStatus: 'paid', feeAmountCents: 2500 }),
      base({ feePolicy: null, paidAt: new Date('2026-09-10'), dueDate: new Date('2026-09-01') }), // late, no fee → est. 2.5% of $1,000 = $25
      base({ feePolicy: null, paidAt: new Date('2026-08-20'), dueDate: new Date('2026-09-01') }), // on time → nothing
    ], NOW2, null);
    expect(r).toMatchObject({ waivedCount: 1, waivedCents: 2500, lateNoFeeCount: 1, noFeeCents: 2500, monthsSeen: 3 });
    expect(r.perMonthCents).toBe(Math.round(5000 / 3));
    expect(r.perYearCents).toBe(Math.round((5000 / 3) * 12));
  });

  it('falls back to the default fee when the owner has never charged one', () => {
    const r = feeOpportunity([
      base({ feePolicy: null, amount: 200000, paidAt: new Date('2026-09-10'), dueDate: new Date('2026-09-01') }),
    ], NOW2, { kind: 'percent', amount: 2 });
    expect(r.noFeeCents).toBe(4000);
  });

  it('estimates nothing without any basis', () => {
    const r = feeOpportunity([base({ feePolicy: null, paidAt: new Date('2026-09-10'), dueDate: new Date('2026-09-01') })], NOW2, null);
    expect(r.noFeeCents).toBe(0);
  });
});
