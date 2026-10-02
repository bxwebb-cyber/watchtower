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
