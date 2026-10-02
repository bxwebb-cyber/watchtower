// "Who do I always waive a fee for" — the third data view (product notes).
// Surfaces the pattern: how many fees the owner waived each month, and for
// which clients, next to how often those clients pay late. Never guesses the
// why; it shows the owner's own notes and lets them decide what it means.
import { agreedFeeCents } from './feeRules';

export type WaiverInvoice = {
  amount: number;
  dueDate: Date;
  paidAt: Date | null;
  createdAt: Date;
  feeStatus: string | null;
  feeAmountCents: number | null;
  waiveNote: string | null;
  feePolicy: { kind: string; amount: number } | null;
  client: { name: string | null; email: string | null } | null;
  waivedAt: Date | null; // when the owner waived it (audit log), if they did
};

export type WaiverClient = {
  name: string;
  email: string | null;
  waivedCount: number;
  waivedCents: number;
  feesDue: number; // times a late fee came due for this client
  paidCount: number;
  paidLateCount: number;
  notes: string[]; // the owner's own reasons, newest first
};

const ym = (d: Date) => d.toISOString().slice(0, 7);

export function waiverReport(invoices: WaiverInvoice[], now: Date, months = 12) {
  const isWaived = (i: WaiverInvoice) => i.feeStatus === 'waived';
  const cents = (i: WaiverInvoice) => i.feeAmountCents ?? (i.feePolicy ? agreedFeeCents(i.amount, i.feePolicy) : 0);
  const when = (i: WaiverInvoice) => i.waivedAt ?? i.createdAt;

  const monthKeys: string[] = [];
  for (let k = months - 1; k >= 0; k--) monthKeys.push(ym(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1))));
  const byMonth = new Map(monthKeys.map((m) => [m, { month: m, count: 0, cents: 0 }]));
  for (const i of invoices.filter(isWaived)) {
    const m = byMonth.get(ym(when(i)));
    if (m) { m.count++; m.cents += cents(i); }
  }

  const clients = new Map<string, WaiverClient & { last: number }>();
  for (const i of invoices) {
    const key = (i.client?.email ?? i.client?.name ?? 'unknown').toLowerCase();
    let c = clients.get(key);
    if (!c) {
      c = { name: i.client?.name ?? i.client?.email ?? 'Unknown client', email: i.client?.email ?? null, waivedCount: 0, waivedCents: 0, feesDue: 0, paidCount: 0, paidLateCount: 0, notes: [], last: 0 };
      clients.set(key, c);
    }
    if (i.feeStatus) c.feesDue++;
    if (i.paidAt) { c.paidCount++; if (i.paidAt > i.dueDate) c.paidLateCount++; }
    if (isWaived(i)) {
      c.waivedCount++;
      c.waivedCents += cents(i);
      c.last = Math.max(c.last, when(i).getTime());
      if (i.waiveNote?.trim()) c.notes.push(i.waiveNote.trim());
    }
  }

  const waived = [...clients.values()]
    .filter((c) => c.waivedCount > 0)
    .sort((a, b) => b.waivedCount - a.waivedCount || b.waivedCents - a.waivedCents || b.last - a.last)
    .map(({ last: _last, ...c }) => ({ ...c, notes: c.notes.slice(-3).reverse() }));

  return { months: [...byMonth.values()], clients: waived };
}
