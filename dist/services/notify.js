"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mailFrom = mailFrom;
exports.clientMailFrom = clientMailFrom;
exports.replyToFor = replyToFor;
exports.notifyOwner = notifyOwner;
const resend_1 = require("resend");
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const resend = process.env.RESEND_API_KEY ? new resend_1.Resend(process.env.RESEND_API_KEY) : null;
// The single "from" address for every email the agent sends.
// (Reminders, owner alerts, and forwarded replies all use this.)
function mailFrom() {
    return process.env.MAIL_FROM || 'Watchtower <reminders@watchtower.app>';
}
// The client-facing sender: display name = the business's actual name, footer
// still carries Dunn. The client has never heard of Dunn, so the From name
// must be the business they do know — "Hudson & Co. via Dunn <reminders@…>".
function clientMailFrom(businessName) {
    const base = mailFrom();
    const addr = base.match(/<[^>]+>/)?.[0] ?? '<reminders@watchtower.app>';
    const label = businessName?.trim();
    if (!label)
        return base;
    return `${label} via Dunn ${addr}`;
}
// The per-invoice reply-to address. Inbound email arrives at
// reply-<invoiceId>@<SENDING_DOMAIN>, which lets the webhook match a
// customer's reply to exactly one invoice without parsing subjects.
function replyToFor(invoiceId) {
    const domain = process.env.SENDING_DOMAIN || 'watchtower.app';
    return `reply-${invoiceId}@${domain}`;
}
// Notify the owner about something that happened. Owner email resolution:
// Settings.ownerEmail -> Account.email (from Stripe OAuth) -> nothing.
// This is the "always in the loop" channel — the owner sees it without
// logging into anything.
async function notifyOwner(accountId, subject, text) {
    const account = await prisma.account.findUnique({ where: { id: accountId } });
    const settings = await prisma.settings.findUnique({ where: { accountId } });
    const to = settings?.ownerEmail || account?.email;
    if (!to) {
        console.log(`[notify-owner] no owner email for account ${accountId}; skipped: ${subject}`);
        return;
    }
    if (!resend) {
        console.log(`[notify-owner] (dry-run, no RESEND_API_KEY) -> ${to}: ${subject}`);
        return;
    }
    try {
        await resend.emails.send({ from: mailFrom(), to, subject, text });
        console.log(`[notify-owner] -> ${to}: ${subject}`);
    }
    catch (err) {
        console.error('[notify-owner] send failed', err.message);
    }
}
//# sourceMappingURL=notify.js.map