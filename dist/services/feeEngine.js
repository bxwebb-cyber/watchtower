"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runFeeJob = runFeeJob;
const client_1 = require("@prisma/client");
const stripe_1 = __importDefault(require("stripe"));
const notify_1 = require("./notify");
const prisma = new client_1.PrismaClient();
const stripe = new stripe_1.default(process.env.STRIPE_SECRET_KEY);
// Pattern B (v1): when an invoice passes its fee grace period unpaid,
// create a SEPARATE invoice for the late fee on the same customer.
// The fee terms were set by the owner at invoice creation, so this is
// enforcement of an agreed-upon term, not a surprise.
async function runFeeJob(now = new Date()) {
    const openInvoices = await prisma.invoice.findMany({
        where: { status: 'open', feeApplied: false, feePolicy: { isNot: null } },
        include: { feePolicy: true, client: true, account: true },
    });
    let applied = 0;
    for (const invoice of openInvoices) {
        const fee = invoice.feePolicy;
        if (fee.kind === 'none')
            continue;
        const due = new Date(invoice.dueDate);
        const graceMs = fee.graceDays * 86_400_000;
        const feeDate = new Date(due.getTime() + graceMs);
        if (now < feeDate)
            continue; // not late enough yet
        // owner approval gate: only auto-apply if the account has opted in,
        // otherwise mark as pending approval (v1: flag it; approval flow ships
        // with the dashboard)
        const settings = await prisma.settings.findUnique({
            where: { accountId: invoice.accountId },
        });
        if (!settings?.autoApplyFees) {
            // not auto-approved — record intent, don't charge yet
            await prisma.auditEvent.create({
                data: {
                    invoiceId: invoice.id,
                    event: 'fee_pending_approval',
                    detail: `${feeLabel(fee)} after ${fee.graceDays}d grace (auto-apply off)`,
                },
            });
            // Owner's call — flag it so they can decide whether to waive the fee.
            await (0, notify_1.notifyOwner)(invoice.accountId, `Late fee ready for your approval — invoice ${invoice.stripeInvoiceId}`, `${invoice.client?.name ?? invoice.client?.email} is ${Math.round((now.getTime() - due.getTime()) / 86_400_000)} days late. The ${feeLabel(fee)} late fee is ready to apply but auto-apply is off. Approve or waive it in the dashboard.`);
            continue;
        }
        const feeAmount = fee.kind === 'percent'
            ? Math.round(invoice.amount * (fee.amount / 100))
            : Math.round(fee.amount * 100);
        if (feeAmount <= 0)
            continue;
        try {
            const feeInvoice = await stripe.invoices.create({
                customer: invoice.client.stripeCustomerId,
                collection_method: 'send_invoice',
                days_until_due: 14,
                metadata: { watchtower: 'true', parent_invoice: invoice.stripeInvoiceId },
                auto_advance: true,
                description: `Late payment fee per invoice terms`,
            }, { stripeAccount: invoice.account.stripeAccountId });
            await stripe.invoiceItems.create({
                customer: invoice.client.stripeCustomerId,
                invoice: feeInvoice.id,
                amount: feeAmount,
                currency: invoice.currency,
                description: `Late fee (${feeLabel(fee)}) — invoice ${invoice.stripeInvoiceId}`,
            }, { stripeAccount: invoice.account.stripeAccountId });
            // finalize + send so the client actually gets it
            const finalized = await stripe.invoices.finalizeInvoice(feeInvoice.id, undefined, { stripeAccount: invoice.account.stripeAccountId });
            await stripe.invoices.sendInvoice(finalized.id, undefined, {
                stripeAccount: invoice.account.stripeAccountId,
            });
            const feeDueDate = finalized.due_date
                ? new Date(finalized.due_date * 1000)
                : new Date(now.getTime() + 14 * 86_400_000);
            await prisma.invoice.update({
                where: { id: invoice.id },
                data: {
                    feeApplied: true,
                    feeInvoiceId: feeInvoice.id,
                    feeAmountCents: feeAmount,
                    feeIssuedAt: now,
                    feeDueDate,
                    feeStatus: 'open',
                },
            });
            await prisma.auditEvent.create({
                data: {
                    invoiceId: invoice.id,
                    event: 'fee_applied',
                    detail: `${feeLabel(fee)} = $${(feeAmount / 100).toFixed(2)} (invoice ${feeInvoice.id})`,
                },
            });
            await (0, notify_1.notifyOwner)(invoice.accountId, `Late fee applied — invoice ${invoice.stripeInvoiceId}`, `A ${feeLabel(fee)} late fee of $${(feeAmount / 100).toFixed(2)} was applied to ${invoice.client?.name ?? invoice.client?.email}'s invoice ${invoice.stripeInvoiceId} and sent to them as a separate invoice.`);
            applied++;
        }
        catch (err) {
            console.error('[fee] failed for invoice', invoice.id, err);
            await prisma.auditEvent.create({
                data: {
                    invoiceId: invoice.id,
                    event: 'fee_error',
                    detail: err.message,
                },
            });
        }
    }
    console.log(`[job] fee run: ${applied} fee invoices created`);
    return applied;
}
function feeLabel(p) {
    return p.kind === 'percent' ? `${p.amount}%` : `$${p.amount.toFixed(2)}`;
}
//# sourceMappingURL=feeEngine.js.map