import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { getAccount } from '../lib/account';
import { waiverReport, feeOpportunity } from '../services/waivers';

const prisma = new PrismaClient();

export const reportsRouter = Router();

// ── Helpers ──

function parseMonth(s: string | undefined): Date {
  if (s) {
    const m = parseInt(s.split('-')[1], 10) - 1;
    const y = parseInt(s.split('-')[0], 10);
    return new Date(y, m, 1);
  }
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function parseTrendMonths(s: string | undefined): number {
  const n = parseInt(s ?? '', 10);
  return n > 0 && n <= 60 ? n : 12;
}

function averageDays(msDeltas: number[]): number | null {
  if (!msDeltas.length) return null;
  const totalDays = msDeltas.reduce((s, d) => s + d / 86_400_000, 0);
  return Math.round((totalDays / msDeltas.length) * 10) / 10;
}

// Invoices whose late fee was waived, dated by the day it was waived. Most
// waived invoices aren't paid yet, so these can't come from the paid list.
async function waivedFees(accountId: string) {
  const rows = await prisma.invoice.findMany({
    where: { accountId, feeStatus: 'waived' },
    include: { client: true, auditLog: { where: { event: 'fee_waived' }, orderBy: { createdAt: 'desc' }, take: 1 } },
  });
  return rows.map((i) => ({ ...i, waivedAt: i.auditLog[0]?.createdAt ?? i.createdAt }));
}

// ── GET /reports/waivers — "who do I waive a fee for" ──
// Fees waived per month (by the day they were waived), and per client with
// how often that client pays late and the owner's own notes on why.
reportsRouter.get('/waivers', async (req, res) => {
  const account = await getAccount(req);
  if (!account) return res.status(401).json({ error: 'Not authenticated' });
  const months = parseTrendMonths(req.query.months as string | undefined);
  const now = new Date();
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));

  const invoices = await prisma.invoice.findMany({
    where: { accountId: account.id, createdAt: { gte: new Date(since.getTime() - 92 * 86_400_000) } },
    include: {
      client: true,
      feePolicy: true,
      auditLog: { where: { event: 'fee_waived' }, orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });
  const rows = invoices.map((i) => ({ ...i, waivedAt: i.auditLog[0]?.createdAt ?? null }));
  const settings = await prisma.settings.findUnique({ where: { accountId: account.id } });
  const defaultFee = settings?.defaultFeeKind ? { kind: settings.defaultFeeKind, amount: settings.defaultFeeAmount ?? 0 } : null;
  res.json({ ...waiverReport(rows, now, months), opportunity: feeOpportunity(rows, now, defaultFee, months) });
});

// ── GET /reports/revenue — monthly report data ──

reportsRouter.get('/revenue', async (req, res) => {
  const account = await getAccount(req);
  if (!account) return res.status(401).json({ error: 'Not authenticated' });
  const month = parseMonth(req.query.month as string | undefined);
  const start = new Date(month.getFullYear(), month.getMonth(), 1);
  const end = new Date(month.getFullYear(), month.getMonth() + 1, 1);
  const trendMonths = parseTrendMonths(req.query.months as string | undefined);

  const invoices = await prisma.invoice.findMany({
    where: { accountId: account.id, status: 'paid' },
    include: { client: true },
  });
  const waived = await waivedFees(account.id);

  // ── Current month ──
  const paidThisMonth = invoices.filter(inv => inv.paidAt && inv.paidAt >= start && inv.paidAt < end);
  const feesThisMonth = invoices.filter(inv => inv.feeStatus === 'paid' && inv.feePaidAt && inv.feePaidAt >= start && inv.feePaidAt < end);
  const waivedThisMonth = waived.filter(inv => inv.waivedAt >= start && inv.waivedAt < end);

  const moneyIn = paidThisMonth.reduce((s, i) => s + i.amount, 0);
  const feeRevenue = feesThisMonth.reduce((s, i) => s + (i.feeAmountCents ?? 0), 0);
  const feesWaivedAmount = waivedThisMonth.reduce((s, i) => s + (i.feeAmountCents ?? 0), 0);

  const avgDaysToPaid = averageDays(
    paidThisMonth.filter(i => i.paidAt && i.createdAt).map(i => i.paidAt!.getTime() - i.createdAt.getTime())
  );

  // Per-client current month
  const perClientMap = new Map<string, { invoicesPaid: number; moneyInCents: number; feeRevenueCents: number; feesWaivedCents: number; totalCents: number }>();
  const pc = (name: string) => {
    let e = perClientMap.get(name);
    if (!e) { e = { invoicesPaid: 0, moneyInCents: 0, feeRevenueCents: 0, feesWaivedCents: 0, totalCents: 0 }; perClientMap.set(name, e); }
    return e;
  };
  for (const i of paidThisMonth) { const c = pc(i.client?.name ?? 'Unknown'); c.invoicesPaid += 1; c.moneyInCents += i.amount; c.totalCents += i.amount; }
  for (const i of feesThisMonth) { const c = pc(i.client?.name ?? 'Unknown'); c.feeRevenueCents += i.feeAmountCents ?? 0; c.totalCents += i.feeAmountCents ?? 0; }
  for (const i of waivedThisMonth) { pc(i.client?.name ?? 'Unknown').feesWaivedCents += i.feeAmountCents ?? 0; }

  const perClient = Array.from(perClientMap.entries()).map(([clientName, d]) => ({ clientName, ...d }));

  // ── Trend (month-by-month) ──
  const trend: Array<{
    month: string; label: string;
    moneyInCents: number; feeRevenueCents: number; feesWaivedCents: number; totalCents: number;
    invoiceCount: number; feeCount: number;
    perClient: Record<string, { invoicesPaid: number; moneyInCents: number; feeRevenueCents: number; feesWaivedCents: number; totalCents: number }>;
  }> = [];

  for (let i = 0; i < trendMonths; i++) {
    const ms = new Date(month.getFullYear(), month.getMonth() - (trendMonths - 1 - i), 1);
    const me = new Date(ms.getFullYear(), ms.getMonth() + 1, 1);
    const label = ms.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

    const mInv = invoices.filter(x => x.paidAt && x.paidAt >= ms && x.paidAt < me);
    const mFee = invoices.filter(x => x.feeStatus === 'paid' && x.feePaidAt && x.feePaidAt >= ms && x.feePaidAt < me);
    const mWv = waived.filter(x => x.waivedAt >= ms && x.waivedAt < me);

    const tm = `${ms.getFullYear()}-${String(ms.getMonth() + 1).padStart(2, '0')}`;
    const mIn = mInv.reduce((s, i) => s + i.amount, 0);
    const mFe = mFee.reduce((s, i) => s + (i.feeAmountCents ?? 0), 0);
    const mW = mWv.reduce((s, i) => s + (i.feeAmountCents ?? 0), 0);

    const mPc: Record<string, any> = {};
    for (const i of mInv) {
      const n = i.client?.name ?? 'Unknown';
      if (!mPc[n]) mPc[n] = { invoicesPaid: 0, moneyInCents: 0, feeRevenueCents: 0, feesWaivedCents: 0, totalCents: 0 };
      mPc[n].invoicesPaid += 1; mPc[n].moneyInCents += i.amount; mPc[n].totalCents += i.amount;
    }
    for (const i of mFee) {
      const n = i.client?.name ?? 'Unknown';
      if (!mPc[n]) mPc[n] = { invoicesPaid: 0, moneyInCents: 0, feeRevenueCents: 0, feesWaivedCents: 0, totalCents: 0 };
      mPc[n].feeRevenueCents += i.feeAmountCents ?? 0; mPc[n].totalCents += i.feeAmountCents ?? 0;
    }
    for (const i of mWv) {
      const n = i.client?.name ?? 'Unknown';
      if (!mPc[n]) mPc[n] = { invoicesPaid: 0, moneyInCents: 0, feeRevenueCents: 0, feesWaivedCents: 0, totalCents: 0 };
      mPc[n].feesWaivedCents += i.feeAmountCents ?? 0;
    }

    trend.push({ month: tm, label, moneyInCents: mIn, feeRevenueCents: mFe, feesWaivedCents: mW, totalCents: mIn + mFe, invoiceCount: mInv.length, feeCount: mFee.length, perClient: mPc });
  }

  // ── CSV string ──
  const csvLines: string[] = [];
  for (const t of trend) {
    csvLines.push(`"${t.label}",---TOTAL---,,,${t.invoiceCount},${(t.moneyInCents / 100).toFixed(2)},${t.feeCount},${(t.feeRevenueCents / 100).toFixed(2)},${(t.feesWaivedCents / 100).toFixed(2)},${(t.totalCents / 100).toFixed(2)}`);
    for (const [name, d] of Object.entries(t.perClient)) {
      csvLines.push(`"${t.label}","${name}",${d.invoicesPaid},${(d.moneyInCents / 100).toFixed(2)},,${d.feeRevenueCents > 0 ? 1 : 0},${(d.feeRevenueCents / 100).toFixed(2)},${(d.feesWaivedCents / 100).toFixed(2)},${(d.totalCents / 100).toFixed(2)}`);
    }
    csvLines.push('');
  }

  const csvHeader = 'Month,Client,Invoices Paid,Invoice Revenue,,Late Fee Count,Late Fee Revenue,Fees Waived,Total';
  const csv = csvHeader + '\n' + csvLines.join('\n');

  // ── Response ──
  res.json({
    month: { year: month.getFullYear(), month: month.getMonth() + 1, label: month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) },
    summary: {
      invoicesPaid: paidThisMonth.length,
      moneyInCents: moneyIn,
      feeRevenueCents: feeRevenue,
      feesWaivedCount: waivedThisMonth.length,
      feesWaivedCents: feesWaivedAmount,
      totalCollectedCents: moneyIn + feeRevenue,
    },
    avgDaysToPaid,
    perClient,
    trend,
    csv,
  });
});

// ── GET /reports/revenue.csv — download CSV ──

reportsRouter.get('/revenue.csv', async (req, res) => {
  const account = await getAccount(req);
  if (!account) return res.status(401).json({ error: 'Not authenticated' });
  const month = parseMonth(req.query.month as string | undefined);
  const trendMonths = parseTrendMonths(req.query.months as string | undefined);

  const invoices = await prisma.invoice.findMany({
    where: { accountId: account.id, status: 'paid' },
    include: { client: true },
  });
  const waived = await waivedFees(account.id);

  const rows: string[] = [];
  const header = 'Month,Client,Invoices Paid,Invoice Revenue,,Late Fee Count,Late Fee Revenue,Fees Waived,Total';
  rows.push(header);

  for (let i = 0; i < trendMonths; i++) {
    const ms = new Date(month.getFullYear(), month.getMonth() - (trendMonths - 1 - i), 1);
    const me = new Date(ms.getFullYear(), ms.getMonth() + 1, 1);
    const label = ms.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

    const mInv = invoices.filter(x => x.paidAt && x.paidAt >= ms && x.paidAt < me);
    const mFee = invoices.filter(x => x.feeStatus === 'paid' && x.feePaidAt && x.feePaidAt >= ms && x.feePaidAt < me);
    const mWv = waived.filter(x => x.waivedAt >= ms && x.waivedAt < me);

    const mIn = mInv.reduce((s, i) => s + i.amount, 0);
    const mFe = mFee.reduce((s, i) => s + (i.feeAmountCents ?? 0), 0);
    const mW = mWv.reduce((s, i) => s + (i.feeAmountCents ?? 0), 0);

    // Totals row
    rows.push(`"${label}",---TOTAL---,,,${mInv.length},${(mIn / 100).toFixed(2)},${mFee.length},${(mFe / 100).toFixed(2)},${(mW / 100).toFixed(2)},${((mIn + mFe) / 100).toFixed(2)}`);

    // Per-client rows
    const clients = new Map<string, { paid: number; inv: number; feesN: number; fees: number; waived: number }>();
    const cb = (n: string) => {
      let e = clients.get(n);
      if (!e) { e = { paid: 0, inv: 0, feesN: 0, fees: 0, waived: 0 }; clients.set(n, e); }
      return e;
    };
    for (const x of mInv) { const c = cb(x.client?.name ?? 'Unknown'); c.paid += 1; c.inv += x.amount; }
    for (const x of mFee) { const c = cb(x.client?.name ?? 'Unknown'); c.feesN += 1; c.fees += x.feeAmountCents ?? 0; }
    for (const x of mWv) { const c = cb(x.client?.name ?? 'Unknown'); c.waived += x.feeAmountCents ?? 0; }

    for (const [name, d] of clients) {
      rows.push(`"${label}","${name}",${d.paid},${(d.inv / 100).toFixed(2)},,${d.feesN},${(d.fees / 100).toFixed(2)},${(d.waived / 100).toFixed(2)},${((d.inv + d.fees) / 100).toFixed(2)}`);
    }
    rows.push('');
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="watchtower-revenue.csv"');
  res.send(rows.join('\n'));
});

// ── GET /reports/export.csv — bookkeeper-friendly CSV (legacy) ──

reportsRouter.get('/export.csv', async (req, res) => {
  const account = await getAccount(req);
  if (!account) return res.status(401).json({ error: 'Not authenticated' });
  const month = parseMonth(req.query.month as string | undefined);
  const start = new Date(month.getFullYear(), month.getMonth(), 1);
  const end = new Date(month.getFullYear(), month.getMonth() + 1, 1);

  const invoices = await prisma.invoice.findMany({
    where: { accountId: account.id },
    include: { client: true },
  });
  const waivedAll = await waivedFees(account.id);

  const rows: string[][] = [['Month', 'Invoices paid', 'Invoice revenue', 'Late fees collected', 'Fee revenue', 'Fees waived', 'Total']];
  const add = (m: string, invCount: number, invRevenue: number, feeCount: number, feeRevenue: number, waived: number, total: number) =>
    rows.push([m, String(invCount), (invRevenue / 100).toFixed(2), String(feeCount), (feeRevenue / 100).toFixed(2), (waived / 100).toFixed(2), (total / 100).toFixed(2)]);

  const months: { label: string; start: Date; end: Date }[] = [];
  for (let i = 11; i >= 0; i--) {
    const m = new Date(month.getFullYear(), month.getMonth() - i, 1);
    months.push({ label: `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`, start: new Date(m.getFullYear(), m.getMonth(), 1), end: new Date(m.getFullYear(), m.getMonth() + 1, 1) });
  }

  for (const m of months) {
    const invs = invoices.filter(inv => inv.paidAt && inv.paidAt >= m.start && inv.paidAt < m.end);
    const fees = invoices.filter(inv => inv.feeStatus === 'paid' && inv.feePaidAt && inv.feePaidAt >= m.start && inv.feePaidAt < m.end);
    const waived = waivedAll.filter(inv => inv.waivedAt >= m.start && inv.waivedAt < m.end);
    add(m.label, invs.length, invs.reduce((s, i) => s + i.amount, 0), fees.length, fees.reduce((s, i) => s + (i.feeAmountCents ?? 0), 0), waived.reduce((s, i) => s + (i.feeAmountCents ?? 0), 0), invs.reduce((s, i) => s + i.amount, 0) + fees.reduce((s, i) => s + (i.feeAmountCents ?? 0), 0));
  }

  const csv = rows.map(r => r.join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="watchtower-revenue-${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}.csv"`);
  res.send(csv);
});