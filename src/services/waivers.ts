// "Who do I always waive a fee for" — the third data view (product notes).
// Surfaces the pattern: how many fees the owner waived each month, and for
// which clients, next to how often those clients pay late. Never guesses the
// why; it shows the owner's own notes and lets them decide what it means.
import { agreedFeeCents } from './feeRules';
import { daysLateAt } from '../lib/dueDate';

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
    if (i.paidAt) { c.paidCount++; if (daysLateAt(i.paidAt, i.dueDate) > 0) c.paidLateCount++; }
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

// "Up to about $X a month" — late fees the owner didn't collect, to put the
// grace in perspective. An upper bound, never "money lost": some clients would
// simply pay on time if a fee were coming.
//   waived: the exact fees the owner waived.
//   noFee:  invoices paid late that had no late fee at all, priced at what the
//           owner usually charges on invoices of a similar size (by fee rate),
//           else their default fee from Settings. No basis → not estimated.
const SIZE_BUCKETS = [50000, 200000, 1000000]; // <$500, $500–2K, $2K–10K, $10K+
const bucketOf = (cents: number) => SIZE_BUCKETS.filter((b) => cents >= b).length;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};

export function feeOpportunity(
  invoices: WaiverInvoice[],
  now: Date,
  defaultFee: { kind: string; amount: number } | null,
  months = 12,
) {
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
  const inWindow = invoices.filter((i) => (i.waivedAt ?? i.paidAt ?? i.createdAt) >= since);
  const hasFee = (i: WaiverInvoice) => !!i.feePolicy && i.feePolicy.kind !== 'none';

  // The owner's usual fee, as a share of the invoice, overall and per size.
  const rated = invoices.filter((i) => hasFee(i) && i.amount > 0);
  const rate = (i: WaiverInvoice) => agreedFeeCents(i.amount, i.feePolicy!) / i.amount;
  const overall = median(rated.map(rate));
  const byBucket = new Map<number, number | null>();
  for (let b = 0; b <= SIZE_BUCKETS.length; b++) byBucket.set(b, median(rated.filter((i) => bucketOf(i.amount) === b).map(rate)));

  const estimate = (i: WaiverInvoice) => {
    const r = byBucket.get(bucketOf(i.amount)) ?? overall;
    if (r != null) return Math.round(i.amount * r);
    if (defaultFee && defaultFee.kind !== 'none') return agreedFeeCents(i.amount, defaultFee);
    return 0;
  };

  const waived = inWindow.filter((i) => i.feeStatus === 'waived');
  const waivedCents = waived.reduce((s, i) => s + (i.feeAmountCents ?? (i.feePolicy ? agreedFeeCents(i.amount, i.feePolicy) : 0)), 0);
  const lateNoFee = inWindow.filter((i) => !hasFee(i) && i.paidAt && daysLateAt(i.paidAt, i.dueDate) > 0);
  const noFeeCents = lateNoFee.reduce((s, i) => s + estimate(i), 0);

  // Average over the months Dunn has actually seen, not a flat 12.
  const first = invoices.reduce((m, i) => Math.min(m, i.createdAt.getTime()), now.getTime());
  const monthsSeen = Math.max(1, Math.min(months,
    (now.getUTCFullYear() - new Date(first).getUTCFullYear()) * 12 + now.getUTCMonth() - new Date(first).getUTCMonth() + 1));

  const totalCents = waivedCents + noFeeCents;
  return {
    waivedCount: waived.length,
    waivedCents,
    lateNoFeeCount: lateNoFee.length,
    noFeeCents,
    monthsSeen,
    perMonthCents: Math.round(totalCents / monthsSeen),
    perYearCents: Math.round((totalCents / monthsSeen) * 12),
  };
}
