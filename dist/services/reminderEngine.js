"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runReminderJob = runReminderJob;
const client_1 = require("@prisma/client");
const resend_1 = require("resend");
const notify_1 = require("./notify");
const prisma = new client_1.PrismaClient();
const resend = process.env.RESEND_API_KEY ? new resend_1.Resend(process.env.RESEND_API_KEY) : null;
// The schedule offsets (relative to the invoice due date), in days.
// Negative = before due. This is the agent's clock.
const SCHEDULE = [
    { step: 't-7', offsetDays: -7, subject: 'Heads up — invoice {NUMBER} is coming due' },
    { step: 't-3', offsetDays: -3, subject: 'Invoice {NUMBER} is due in 3 days' },
    { step: 'due', offsetDays: 0, subject: 'Invoice {NUMBER} is due today' },
    { step: 't+3', offsetDays: 3, subject: 'Invoice {NUMBER} — payment reminder' },
    { step: 't+7', offsetDays: 7, subject: 'Invoice {NUMBER} — now past due' },
    { step: 't+14', offsetDays: 14, subject: 'Invoice {NUMBER} — final notice' },
];
// A pre-due reminder scheduled to land this many days (or fewer) after the
// invoice was created is skipped — no "due in 3 days" note the morning after
// the client first receives the bill.
const MIN_DAYS_AFTER_CREATE = 2;
// Body templates — the product's voice. Warm, professional, never threatening.
// The fee clause is injected from ACTUAL state (see buildFeeClause), never
// hard-coded, so we don't tell a client a fee was applied when it wasn't.
const BODY = {
    't-7': (i) => `${i.greeting}\n\nJust a friendly heads up that invoice ${i.number} for ${i.amount} is scheduled to be paid on ${i.due}.\n\nIf everything's already handled, great — no need to reply. Otherwise, here's the payment link: [pay]\n\n${i.signature}\n`,
    't-3': (i) => `${i.greeting}\n\nA quick reminder that invoice ${i.number} for ${i.amount} is due in 3 days (${i.due}).\n\nPay here: [pay]\n\n${i.signature}\n`,
    due: (i) => `${i.greeting}\n\nInvoice ${i.number} for ${i.amount} is due today (${i.due}).\n\nYou can pay here: [pay]\n\nIf it's already paid, please disregard this note.\n\n${i.signature}\n`,
    't+3': (i) => `${i.greeting}\n\nI wanted to follow up on invoice ${i.number} for ${i.amount}, which was due on ${i.due}.\n\nIf it's already on its way, thank you! If not, here's the payment link: [pay]\n\nJust let me know if there's anything I can help with.\n\n${i.signature}\n`,
    't+7': (i) => `${i.greeting}\n\nInvoice ${i.number} for ${i.amount} is now past due (originally due ${i.due}).${i.feeClause ? ` ${i.feeClause}` : ''}\n\nPlease settle this at your earliest convenience:\n\n[pay]\n\nIf you have questions or need to make arrangements, just reply to this email.\n\n${i.signature}\n`,
    't+14': (i) => `${i.greeting}\n\nThis is a final notice regarding invoice ${i.number} for ${i.amount} (due ${i.due}).${i.feeClause ? ` ${i.feeClause}` : ''}\n\nPlease pay at your earliest convenience:\n\n[pay]\n\nIf there's an issue, please reply — we'd rather sort it out than let it sit.\n\n${i.signature}\n`,
};
// Run daily: find every open invoice whose due date matches today's offset,
// send the reminder if it hasn't been sent for that step, log it to the trail.
async function runReminderJob(now = new Date()) {
    if (!resend) {
        console.warn('[job] RESEND_API_KEY not set — reminders dry-run (not sent)');
    }
    const openInvoices = await prisma.invoice.findMany({
        where: { status: 'open', repliedAt: null },
        include: { client: true, account: true, feePolicy: true },
    });
    let sent = 0;
    for (const invoice of openInvoices) {
        const due = new Date(invoice.dueDate);
        // normalize to start-of-day for offset math
        const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        // Days relative to due: NEGATIVE = before due, POSITIVE = after due.
        // (This matches the SCHEDULE comment. The prior code used
        // `dueDay - today`, which inverts the sign and fired pre-due reminders
        // after the due date and vice-versa.)
        const offset = Math.round((today.getTime() - dueDay.getTime()) / 86_400_000);
        // Steps already sent for this invoice (drives the catch-up logic below).
        const sentSteps = new Set((await prisma.reminder.findMany({ where: { invoiceId: invoice.id } })).map((r) => r.step));
        // Catch-up: find the latest scheduled step whose day has arrived AND which
        // hasn't been sent. SCHEDULE is ascending, so walking it backwards finds
        // the most recent due step first. Send exactly one step per invoice per
        // run — never two — even if cron misses a day or two.
        const step = [...SCHEDULE].reverse().find((s) => s.offsetDays <= offset && !sentSteps.has(s.step));
        if (!step)
            continue;
        // Don't fire a pre-due reminder right after the client received the
        // invoice. (E.g. an invoice created 5 days before due would otherwise get
        // a T-3 "due in 3 days" note 2 days after the client first saw the bill.)
        const createdAtDay = new Date(invoice.createdAt.getFullYear(), invoice.createdAt.getMonth(), invoice.createdAt.getDate());
        if (step.offsetDays < 0) {
            const scheduledDay = addDays(dueDay, step.offsetDays);
            const daysAfterCreation = Math.round((scheduledDay.getTime() - createdAtDay.getTime()) / 86_400_000);
            if (daysAfterCreation <= MIN_DAYS_AFTER_CREATE)
                continue;
        }
        const alreadyPaid = await prisma.invoice.findUnique({
            where: { id: invoice.id },
        });
        if (alreadyPaid?.status === 'paid')
            continue;
        // Human-facing invoice number (fall back to the raw Stripe id for older rows
        // that predate the stripeNumber column).
        const number = invoice.stripeNumber || invoice.stripeInvoiceId;
        const subject = step.subject.replace('{NUMBER}', number);
        const body = BODY[step.step]({
            number,
            amount: `$${(invoice.amount / 100).toFixed(2)}`,
            due: formatDate(due),
            greeting: greetingFor(invoice.client?.name),
            feeClause: buildFeeClause(invoice),
            signature: signatureFor(invoice.account?.businessName),
        })
            .replace('[pay]', paymentLink(invoice))
            .replace(/\n\n$/, '')
            .trimEnd();
        const footer = invoice.account?.businessName
            ? `Sent on behalf of ${invoice.account.businessName} by Dunn.`
            : undefined;
        if (resend && invoice.client?.email) {
            const msg = await resend.emails.send({
                from: (0, notify_1.clientMailFrom)(invoice.account?.businessName),
                to: invoice.client.email,
                subject,
                text: footer ? `${body}\n\n${footer}` : body,
                replyTo: (0, notify_1.replyToFor)(invoice.id),
            });
            await prisma.reminder.create({
                data: {
                    invoiceId: invoice.id,
                    step: step.step,
                    subject,
                    messageId: msg.data?.id,
                },
            });
            await prisma.auditEvent.create({
                data: {
                    invoiceId: invoice.id,
                    event: 'reminder_sent',
                    detail: `${step.step} (${subject}) → ${invoice.client.email}`,
                },
            });
            sent++;
        }
        else if (invoice.client?.email) {
            // dry run: still record the step so the schedule is testable
            await prisma.reminder.create({
                data: { invoiceId: invoice.id, step: step.step, subject },
            });
            await prisma.auditEvent.create({
                data: { invoiceId: invoice.id, event: 'reminder_sent (dry-run)', detail: step.step },
            });
            sent++;
        }
        // Owner alert on past-due reminders — money is now at risk and the
        // owner should know, even though the agent is handling the chasing.
        if (offset >= 7) {
            await (0, notify_1.notifyOwner)(invoice.accountId, `Invoice ${number} is past due`, `${invoice.client?.name ?? invoice.client?.email} is ${offset} days late on invoice ${number} for ${`$${(invoice.amount / 100).toFixed(2)}`}. Watchtower reminded them today (${step.step}). No action needed unless you want to step in.`);
        }
    }
    console.log(`[job] reminder run: ${sent} sent/recorded`);
    return sent;
}
// The payment link the client clicks. Use the real hosted invoice URL when we
// have it; fall back to a best-effort guess only as a last resort.
function paymentLink(invoice) {
    if (invoice.hostedInvoiceUrl)
        return invoice.hostedInvoiceUrl;
    return `https://pay.stripe.com/invoice/${invoice.stripeInvoiceId}`;
}
// The fee sentence, driven by ACTUAL state so we never tell a client a fee was
// applied when it wasn't:
//   - applied  → "A late fee of $X has been applied."
//   - pending  → "Per the invoice terms, a late fee of $X may be added."
//   - none     → omitted entirely.
function buildFeeClause(invoice) {
    if (invoice.feeApplied && invoice.feeAmountCents != null) {
        return `A late fee of $${(invoice.feeAmountCents / 100).toFixed(2)} has been applied.`;
    }
    if (invoice.feePolicy && invoice.feePolicy.kind !== 'none') {
        return `Per the invoice terms, a late fee of ${feePolicyLabel(invoice.feePolicy)} may be added.`;
    }
    return undefined;
}
function greetingFor(name) {
    const first = name?.trim().split(/\s+/)[0];
    return first ? `Hi ${first},` : 'Hi there,';
}
function signatureFor(businessName) {
    return businessName ? `Thanks,\n${businessName}` : 'Thanks,';
}
function formatDate(d) {
    return d.toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
    });
}
function addDays(d, days) {
    const copy = new Date(d);
    copy.setDate(copy.getDate() + days);
    return copy;
}
function feePolicyLabel(p) {
    return p.kind === 'percent' ? `${p.amount}%` : `$${p.amount.toFixed(2)}`;
}
//# sourceMappingURL=reminderEngine.js.map