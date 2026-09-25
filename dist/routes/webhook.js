"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.webhookRouter = void 0;
const express_1 = require("express");
const stripe_1 = __importDefault(require("stripe"));
const client_1 = require("@prisma/client");
const notify_1 = require("../services/notify");
const prisma = new client_1.PrismaClient();
const stripe = new stripe_1.default(process.env.STRIPE_SECRET_KEY);
exports.webhookRouter = (0, express_1.Router)();
// Stripe sends the raw body; verify signature, then dispatch on event type.
exports.webhookRouter.post('/', async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    }
    catch (err) {
        console.error('[webhook] signature verification failed', err);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }
    try {
        switch (event.type) {
            case 'invoice.created':
                await onInvoiceCreated(event.data.object);
                break;
            case 'invoice.finalized':
                await onInvoiceFinalized(event.data.object);
                break;
            case 'invoice.paid':
                await onInvoicePaid(event.data.object);
                break;
            case 'invoice.payment_failed':
                await onInvoicePaymentFailed(event.data.object);
                break;
            case 'invoice.voided':
                await onInvoiceVoided(event.data.object);
                break;
            case 'invoice.marked_uncollectible':
                await onInvoiceMarkedUncollectible(event.data.object);
                break;
            case 'invoice.deleted':
                await onInvoiceDeleted(event.data.object);
                break;
            case 'invoice.updated':
                await onInvoiceUpdated(event.data.object);
                break;
            default:
                // other events we don't act on yet
                break;
        }
        res.json({ received: true });
    }
    catch (err) {
        console.error('[webhook] handler failed', err);
        // Still 200 so Stripe doesn't retry forever on our bugs;
        // we log and can replay from the audit trail.
        res.json({ received: true, error: err.message });
    }
});
// ---- handlers ----
async function onInvoiceCreated(inv) {
    if (inv.metadata?.watchtower === 'true') {
        // An invoice created BY us (e.g. the late-fee invoice) — we don't
        // re-watch our own fee invoices to avoid loops.
        return;
    }
    // Find the connected account + mirror the invoice into our DB.
    // Invoices created on connected accounts arrive via webhook with the
    // connected account id in `account` only when the event is fetched with
    // the account context. As a robust fallback, we match on the customer's
    // metadata — but v1 single-account assumption: look up by the first
    // connected account we know. (Multi-account routing is a later pass.)
    const account = await prisma.account.findFirst();
    if (!account || !inv.customer_email)
        return;
    const customerId = inv.customer;
    let client = await prisma.client.findUnique({
        where: { stripeCustomerId: customerId },
    });
    if (!client) {
        client = await prisma.client.create({
            data: {
                accountId: account.id,
                stripeCustomerId: customerId,
                name: inv.customer_name ?? 'Unknown',
                email: inv.customer_email,
            },
        });
    }
    const invoice = await prisma.invoice.upsert({
        where: { stripeInvoiceId: inv.id },
        update: { status: inv.status ?? 'open' },
        create: {
            accountId: account.id,
            clientId: client.id,
            stripeInvoiceId: inv.id,
            amount: inv.amount_due,
            currency: inv.currency,
            dueDate: new Date((inv.due_date ?? Date.now()) * 1000),
            status: inv.status ?? 'open',
        },
    });
    await prisma.auditEvent.create({
        data: {
            invoiceId: invoice.id,
            event: 'invoice_created',
            detail: `${inv.amount_due / 100} ${inv.currency.toUpperCase()} due ${new Date((inv.due_date ?? Date.now()) * 1000).toISOString().slice(0, 10)}`,
        },
    });
}
async function onInvoiceFinalized(inv) {
    // Late-fee invoices (metadata.parent_invoice) are never mirrored as their
    // own rows — the fee state lives on the parent Invoice.
    if (inv.metadata?.parent_invoice)
        return;
    await prisma.invoice.update({
        where: { stripeInvoiceId: inv.id },
        data: { status: inv.status ?? 'open' },
    });
}
async function onInvoicePaid(inv) {
    // A late-fee invoice is identified by metadata.parent_invoice. Record the
    // payment on the PARENT invoice — fee invoices are never mirrored as their
    // own rows, so a plain lookup by stripeInvoiceId would miss (and throw).
    const parentId = inv.metadata?.parent_invoice;
    if (parentId) {
        const parent = await prisma.invoice.findUnique({
            where: { stripeInvoiceId: parentId },
            include: { client: true },
        });
        if (parent) {
            await prisma.invoice.update({
                where: { id: parent.id },
                data: { feeStatus: 'paid', feePaidAt: new Date() },
            });
            await prisma.auditEvent.create({
                data: {
                    invoiceId: parent.id,
                    event: 'fee_paid',
                    detail: `${(inv.amount_paid / 100).toFixed(2)} ${inv.currency ?? 'usd'}`,
                },
            });
            const clientName = parent.client?.name ?? 'A client';
            await (0, notify_1.notifyOwner)(parent.accountId, `Late fee paid — invoice ${parent.stripeInvoiceId}`, `${clientName} paid the late fee (${(inv.amount_paid / 100).toFixed(2)} ${inv.currency ?? 'usd'}) on invoice ${parent.stripeInvoiceId}.`);
        }
        return;
    }
    const invoice = await prisma.invoice.update({
        where: { stripeInvoiceId: inv.id },
        data: { status: 'paid', paidAt: new Date() },
    });
    await prisma.auditEvent.create({
        data: { invoiceId: invoice.id, event: 'invoice_paid', detail: `${inv.amount_paid / 100} ${inv.currency}` },
    });
    await (0, notify_1.notifyOwner)(invoice.accountId, `Invoice paid — ${inv.amount_paid / 100} ${inv.currency}`, `Invoice ${inv.id} was paid (${inv.amount_paid / 100} ${inv.currency}). Watchtower has stopped the reminders.`);
    // Paid = stop all reminders. The daily job skips paid invoices.
}
async function onInvoicePaymentFailed(inv) {
    const invoice = await prisma.invoice.findUnique({
        where: { stripeInvoiceId: inv.id },
    });
    if (!invoice)
        return;
    await prisma.auditEvent.create({
        data: { invoiceId: invoice.id, event: 'payment_failed', detail: 'auto-charge failed; reminder schedule continues' },
    });
}
async function onInvoiceVoided(inv) {
    // Fee invoices live on the parent row, not their own — skip them here.
    if (inv.metadata?.parent_invoice)
        return;
    const invoice = await prisma.invoice.findUnique({
        where: { stripeInvoiceId: inv.id },
    });
    if (!invoice || invoice.status === 'void')
        return;
    await prisma.invoice.update({ where: { id: invoice.id }, data: { status: 'void' } });
    await prisma.auditEvent.create({
        data: { invoiceId: invoice.id, event: 'invoice_voided', detail: 'voided in Stripe; reminders stopped' },
    });
}
async function onInvoiceMarkedUncollectible(inv) {
    if (inv.metadata?.parent_invoice)
        return;
    const invoice = await prisma.invoice.findUnique({
        where: { stripeInvoiceId: inv.id },
    });
    if (!invoice || invoice.status === 'uncollectible')
        return;
    await prisma.invoice.update({ where: { id: invoice.id }, data: { status: 'uncollectible' } });
    await prisma.auditEvent.create({
        data: { invoiceId: invoice.id, event: 'invoice_uncollectible', detail: 'marked uncollectible in Stripe; reminders stopped' },
    });
}
async function onInvoiceDeleted(inv) {
    if (inv.metadata?.parent_invoice)
        return;
    const invoice = await prisma.invoice.findUnique({
        where: { stripeInvoiceId: inv.id },
    });
    if (!invoice || invoice.status === 'deleted')
        return;
    await prisma.invoice.update({ where: { id: invoice.id }, data: { status: 'deleted' } });
    await prisma.auditEvent.create({
        data: { invoiceId: invoice.id, event: 'invoice_deleted', detail: 'deleted in Stripe; reminders stopped' },
    });
}
async function onInvoiceUpdated(inv) {
    if (inv.metadata?.parent_invoice)
        return;
    const invoice = await prisma.invoice.findUnique({
        where: { stripeInvoiceId: inv.id },
    });
    if (!invoice)
        return;
    // Sync the due date — the field the owner can edit after the fact (an
    // extension granted verbally, a re-issued invoice) — so the reminder clock
    // re-anchors. We deliberately do NOT sync `status` here: status changes have
    // their own dedicated events (paid / voided / uncollectible), and `updated`
    // also fires on partial payments, where setting status without `paidAt`
    // would corrupt the lateness math.
    const dueDate = inv.due_date ? new Date(inv.due_date * 1000) : undefined;
    if (!dueDate)
        return;
    await prisma.invoice.update({
        where: { id: invoice.id },
        data: { dueDate },
    });
    await prisma.auditEvent.create({
        data: { invoiceId: invoice.id, event: 'invoice_updated', detail: `due date changed to ${dueDate.toISOString().slice(0, 10)}` },
    });
}
//# sourceMappingURL=webhook.js.map