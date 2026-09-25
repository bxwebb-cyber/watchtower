"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.invoicesRouter = void 0;
const express_1 = require("express");
const client_1 = require("@prisma/client");
const stripe_1 = __importDefault(require("stripe"));
const invoiceCreator_1 = require("../services/invoiceCreator");
const prisma = new client_1.PrismaClient();
const stripe = new stripe_1.default(process.env.STRIPE_SECRET_KEY);
exports.invoicesRouter = (0, express_1.Router)();
// The form checks this on load so it can say plainly what's missing
// (Stripe key vs. connected account) instead of failing mysteriously.
exports.invoicesRouter.get('/status', async (_req, res) => {
    const account = await prisma.account.findFirst();
    res.json({
        stripeConfigured: (0, invoiceCreator_1.stripeConfigured)(),
        accountConnected: !!account,
        businessName: account?.businessName ?? null,
        connectUrl: '/auth/stripe/start',
    });
});
// The invoice CREATOR — the form posts here, we create the Stripe invoice
// under the connected account, mirror it, and start watching.
exports.invoicesRouter.post('/', async (req, res) => {
    const body = req.body ?? {};
    const clientName = String(body.clientName ?? '').trim();
    const clientEmail = String(body.clientEmail ?? '').trim().toLowerCase();
    const amountDollars = Number(body.amount);
    const dueDateStr = String(body.dueDate ?? '');
    if (!clientName) {
        return res.status(400).json({ error: 'Client name is required.' });
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clientEmail)) {
        return res.status(400).json({ error: 'A valid client email is required.' });
    }
    if (!Number.isFinite(amountDollars) || amountDollars <= 0) {
        return res.status(400).json({ error: 'Amount must be a positive number.' });
    }
    const dueDate = new Date(`${dueDateStr}T00:00:00`);
    if (Number.isNaN(dueDate.getTime())) {
        return res.status(400).json({ error: 'A due date is required.' });
    }
    // The fee prompt — the heart of the product. Per invoice, per client.
    const kindRaw = String(body.fee?.kind ?? 'none');
    const kind = kindRaw === 'flat' || kindRaw === 'percent' ? kindRaw : 'none';
    let feeAmount;
    if (kind === 'flat') {
        feeAmount = Number(body.fee?.amount);
        if (!Number.isFinite(feeAmount) || feeAmount < 0) {
            return res.status(400).json({ error: 'Late fee amount must be $0 or more.' });
        }
    }
    else if (kind === 'percent') {
        feeAmount = Number(body.fee?.amount);
        if (!Number.isFinite(feeAmount) || feeAmount <= 0 || feeAmount > 100) {
            return res.status(400).json({ error: 'Percent fee must be between 0 and 100.' });
        }
    }
    const graceDays = Math.max(1, Math.round(Number(body.fee?.graceDays ?? 7)));
    const result = await (0, invoiceCreator_1.createInvoice)({
        clientName,
        clientEmail,
        amountCents: Math.round(amountDollars * 100),
        dueDate,
        fee: kind === 'none' ? { kind: 'none' } : { kind, amount: feeAmount, graceDays },
    });
    if (!result.ok) {
        const status = result.code === 'not_configured' ? 503 : result.code === 'no_account' ? 409 : 502;
        return res.status(status).json({ error: result.message, code: result.code });
    }
    res.status(201).json(result.invoice);
});
// The form calls this on email blur: returns the client's last-used fee terms
// so the fee prompt is pre-filled and the owner never retypes the same fee
// for the same client month after month. (The "take the headache away" feature.)
exports.invoicesRouter.get('/fee-default', async (req, res) => {
    const email = String(req.query.email ?? '').trim().toLowerCase();
    if (!email)
        return res.json({ found: false });
    const account = await prisma.account.findFirst();
    if (!account)
        return res.json({ found: false });
    const client = await prisma.client.findFirst({
        where: { accountId: account.id, email },
    });
    if (!client)
        return res.json({ found: false });
    // Most recent invoice for this client that carries a fee policy.
    const latest = await prisma.invoice.findFirst({
        where: { clientId: client.id, feePolicy: { isNot: null } },
        include: { feePolicy: true },
        orderBy: { createdAt: 'desc' },
    });
    if (!latest?.feePolicy)
        return res.json({ found: false });
    res.json({
        found: true,
        kind: latest.feePolicy.kind,
        amount: latest.feePolicy.amount,
        graceDays: latest.feePolicy.graceDays,
    });
});
// The dashboard's core view: every invoice, its status, what the agent has
// done, and per-client lateness history. The "who's always late" screen.
exports.invoicesRouter.get('/', async (_req, res) => {
    const invoices = await prisma.invoice.findMany({
        include: {
            client: true,
            reminders: { orderBy: { sentAt: 'asc' } },
            feePolicy: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
    });
    // Per-client lateness: how often + how late each client pays.
    const clientLateness = new Map();
    for (const inv of invoices) {
        if (!inv.client)
            continue;
        const entry = clientLateness.get(inv.client.id) ?? { total: 0, lateCount: 0, avgDaysLate: 0 };
        entry.total++;
        if (inv.paidAt && inv.dueDate && inv.paidAt > inv.dueDate) {
            entry.lateCount++;
            const daysLate = Math.round((inv.paidAt.getTime() - inv.dueDate.getTime()) / 86_400_000);
            entry.avgDaysLate = (entry.avgDaysLate * (entry.lateCount - 1) + daysLate) / entry.lateCount;
        }
        clientLateness.set(inv.client.id, entry);
    }
    res.json({
        invoices: invoices.map((inv) => ({
            id: inv.id,
            stripeInvoiceId: inv.stripeInvoiceId,
            client: inv.client?.name,
            amount: `$${(inv.amount / 100).toFixed(2)}`,
            due: inv.dueDate.toISOString().slice(0, 10),
            status: inv.status,
            fee: inv.feePolicy ? feeLabel(inv.feePolicy) : null,
            reminders: inv.reminders.map((r) => ({ step: r.step, sentAt: r.sentAt })),
        })),
        clientLateness: Object.fromEntries(clientLateness),
    });
});
function feeLabel(p) {
    return p.kind === 'percent' ? `${p.amount}%` : `$${p.amount.toFixed(2)}`;
}
//# sourceMappingURL=invoices.js.map