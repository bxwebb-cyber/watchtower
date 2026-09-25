"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reportsRouter = void 0;
const express_1 = require("express");
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
exports.reportsRouter = (0, express_1.Router)();
// GET /reports/revenue?month=YYYY-MM&months=N  (month: current by default; months: trend window, default 12)
// Money in, late-fee revenue, and how fast fees get paid — overall + per client,
// plus a month-by-month trend with the "are we getting worse?" signals baked in.
exports.reportsRouter.get('/revenue', async (req, res) => {
    const month = parseMonth(req.query.month);
    const start = new Date(month.getFullYear(), month.getMonth(), 1);
    const end = new Date(month.getFullYear(), month.getMonth() + 1, 1);
    const trendMonths = parseTrendMonths(req.query.months);
    const invoices = await prisma.invoice.findMany({
        where: { status: 'paid' },
        include: { client: true },
    });
    // Invoices paid within the month.
    const paidThisMonth = invoices.filter((inv) => inv.paidAt && inv.paidAt >= start && inv.paidAt < end);
    const moneyIn = paidThisMonth.reduce((sum, inv) => sum + inv.amount, 0);
    // Late-fee revenue: fees paid within the month (tracked on the parent invoice).
    const feesThisMonth = invoices.filter((inv) => inv.feeStatus === 'paid' && inv.feePaidAt && inv.feePaidAt >= start && inv.feePaidAt < end);
    const feeRevenue = feesThisMonth.reduce((sum, inv) => sum + (inv.feeAmountCents ?? 0), 0);
    // How fast fees get paid THIS MONTH: days from fee issued to fee paid,
    // over fees paid within the month window.
    const avgDaysToPayFee = averageDays(feesThisMonth
        .filter((inv) => inv.feeIssuedAt)
        .map((inv) => inv.feePaidAt.getTime() - inv.feeIssuedAt.getTime()));
    // How late invoices pay THIS MONTH: days from due to paid, late only,
    // over invoices paid within the month window.
    const avgDaysLate = averageDays(paidThisMonth
        .filter((inv) => inv.paidAt.getTime() > inv.dueDate.getTime())
        .map((inv) => inv.paidAt.getTime() - inv.dueDate.getTime()));
    // Per-client breakdown for this month.
    const perClient = new Map();
    const bucket = (name) => {
        let e = perClient.get(name);
        if (!e) {
            e = { moneyIn: 0, feeRevenue: 0, feeDays: [] };
            perClient.set(name, e);
        }
        return e;
    };
    for (const inv of paidThisMonth) {
        bucket(inv.client?.name ?? 'Unknown').moneyIn += inv.amount;
    }
    for (const inv of feesThisMonth) {
        bucket(inv.client?.name ?? 'Unknown').feeRevenue += inv.feeAmountCents ?? 0;
    }
    for (const inv of feesThisMonth) {
        if (!inv.feeIssuedAt)
            continue;
        bucket(inv.client?.name ?? 'Unknown').feeDays.push((inv.feePaidAt.getTime() - inv.feeIssuedAt.getTime()) / 86_400_000);
    }
    const clientRows = Array.from(perClient.entries()).map(([client, e]) => ({
        client,
        moneyIn: dollars(e.moneyIn),
        feeRevenue: dollars(e.feeRevenue),
        avgDaysToPayFee: e.feeDays.length ? round1(e.feeDays.reduce((s, n) => s + n, 0) / e.feeDays.length) : null,
    }));
    // Month-by-month trend (default last 12 months; `months=N` shortens it).
    // Each month carries moneyIn, feeRevenue, invoice count, and the two
    // "doing worse?" signals: avg days late + avg days to pay a fee.
    const trend = [];
    for (let i = trendMonths - 1; i >= 0; i--) {
        const m = new Date(month.getFullYear(), month.getMonth() - i, 1);
        const ms = new Date(m.getFullYear(), m.getMonth(), 1);
        const me = new Date(m.getFullYear(), m.getMonth() + 1, 1);
        const label = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
        const invs = invoices.filter((x) => x.paidAt && x.paidAt >= ms && x.paidAt < me);
        const fees = invoices.filter((x) => x.feeStatus === 'paid' && x.feePaidAt && x.feePaidAt >= ms && x.feePaidAt < me);
        trend.push({
            month: label,
            moneyIn: invs.reduce((s, x) => s + x.amount, 0),
            feeRevenue: fees.reduce((s, x) => s + (x.feeAmountCents ?? 0), 0),
            invoiceCount: invs.length,
            avgDaysLate: averageDays(invs
                .filter((x) => x.paidAt.getTime() > x.dueDate.getTime())
                .map((x) => x.paidAt.getTime() - x.dueDate.getTime())),
            avgDaysToPayFee: averageDays(fees
                .filter((x) => x.feeIssuedAt)
                .map((x) => x.feePaidAt.getTime() - x.feeIssuedAt.getTime())),
        });
    }
    res.json({
        month: `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`,
        moneyIn: dollars(moneyIn),
        feeRevenue: dollars(feeRevenue),
        totalCollected: dollars(moneyIn + feeRevenue),
        invoiceCount: paidThisMonth.length,
        feeCount: feesThisMonth.length,
        avgDaysToPayFee, // this month: fee issued -> fee paid
        avgDaysLate, // this month: due -> paid (late invoices only)
        perClient: clientRows,
        trend,
    });
});
// GET /reports/export.csv?month=YYYY-MM
// Bookkeeper-friendly CSV: Date, Client, Description, Type, Amount, Status.
// Invoices and late fees are separate rows so income categories stay distinct.
exports.reportsRouter.get('/export.csv', async (req, res) => {
    const month = parseMonth(req.query.month);
    const start = new Date(month.getFullYear(), month.getMonth(), 1);
    const end = new Date(month.getFullYear(), month.getMonth() + 1, 1);
    const invoices = await prisma.invoice.findMany({ include: { client: true } });
    const rows = [['Date', 'Client', 'Description', 'Type', 'Amount', 'Status']];
    const add = (date, client, desc, type, amountCents, status) => rows.push([date.toISOString().slice(0, 10), client, desc, type, (amountCents / 100).toFixed(2), status]);
    // Invoices paid this month.
    for (const inv of invoices) {
        if (inv.paidAt && inv.paidAt >= start && inv.paidAt < end) {
            add(inv.paidAt, inv.client?.name ?? 'Unknown', `Invoice ${inv.stripeInvoiceId}`, 'Invoice', inv.amount, 'Paid');
        }
    }
    // Late fees paid this month — their own line item.
    for (const inv of invoices) {
        if (inv.feeStatus === 'paid' && inv.feePaidAt && inv.feePaidAt >= start && inv.feePaidAt < end) {
            add(inv.feePaidAt, inv.client?.name ?? 'Unknown', `Late fee (invoice ${inv.stripeInvoiceId})`, 'Late fee', inv.feeAmountCents ?? 0, 'Paid');
        }
    }
    const csv = rows.map((r) => r.map(csvCell).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="watchtower-${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}.csv"`);
    res.send(csv);
});
function parseMonth(raw) {
    if (raw && /^\d{4}-\d{2}$/.test(raw)) {
        const [y, m] = raw.split('-').map(Number);
        if (m >= 1 && m <= 12)
            return new Date(y, m - 1, 1);
    }
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
}
// Trend window in months: default 12, clamped to 1..24. A trailing "m"
// (e.g. "3m") is tolerated so the dashboard can pass a friendly value.
function parseTrendMonths(raw) {
    const n = Number(String(raw ?? '').replace(/m$/i, ''));
    if (!Number.isFinite(n) || n <= 0)
        return 12;
    return Math.min(24, Math.round(n));
}
function dollars(cents) {
    return (cents / 100).toFixed(2);
}
function averageDays(ms) {
    if (!ms.length)
        return null;
    return round1(ms.reduce((s, x) => s + x, 0) / ms.length / 86_400_000);
}
function round1(n) {
    return Math.round(n * 10) / 10;
}
function csvCell(s) {
    if (/[",\n\r]/.test(s)) {
        return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
}
//# sourceMappingURL=reports.js.map