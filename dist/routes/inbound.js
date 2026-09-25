"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inboundRouter = void 0;
const express_1 = require("express");
const client_1 = require("@prisma/client");
const resend_1 = require("resend");
const notify_1 = require("../services/notify");
const prisma = new client_1.PrismaClient();
const resend = process.env.RESEND_API_KEY ? new resend_1.Resend(process.env.RESEND_API_KEY) : null;
exports.inboundRouter = (0, express_1.Router)();
// Resend inbound webhook: a customer replied to a reminder email.
//
// Every reminder goes out with reply-to = reply-<invoiceId>@<SENDING_DOMAIN>,
// so the `to` address here tells us EXACTLY which invoice the reply is about.
// No subject parsing, no guessing.
//
// Flow: match invoice -> fetch the full body (the webhook carries metadata
// only) -> store the reply -> pause reminders for that invoice -> forward the
// gist to the owner's inbox.
exports.inboundRouter.post('/', async (req, res) => {
    // TODO(prod): verify the Resend/Svix webhook signature (svix-id +
    // svix-signature headers). Skipped for now — inbound isn't wired to a real
    // domain yet, so this endpoint is behind a placeholder and can't be hit.
    const event = req.body ?? {};
    // Resend inbound sends the email object directly (not wrapped); tolerate
    // both the bare shape and a {type, data} wrapper.
    const type = event.type;
    const data = event.data ?? event;
    if (type && type !== 'email.received') {
        return res.json({ received: true });
    }
    const toAddrs = Array.isArray(data.to) ? data.to : [];
    const from = data.from ?? '';
    const subject = data.subject ?? '';
    // Which invoice is this reply for?
    const toLine = toAddrs.join(' ');
    const match = /reply-([a-z0-9]+)@/i.exec(toLine);
    if (!match) {
        // Not a reply to a reminder we can match (direct email, etc.). Ignore.
        return res.json({ received: true });
    }
    const invoiceId = match[1];
    const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) {
        return res.json({ received: true });
    }
    // The webhook carries metadata only — fetch the full body so the owner
    // sees what the client actually said.
    let body = '';
    const emailId = data.email_id;
    if (resend && emailId) {
        try {
            const full = await resend.emails.get(emailId);
            body = full?.data?.text ?? '';
            if (!body) {
                body = full?.data?.html ?? '';
            }
        }
        catch (err) {
            console.error('[inbound] failed to fetch email body', err.message);
        }
    }
    // Record the reply + pause reminders (the "stop the nag" feature).
    await prisma.reply.create({ data: { invoiceId, from, subject, body } });
    await prisma.invoice.update({ where: { id: invoiceId }, data: { repliedAt: new Date() } });
    await prisma.auditEvent.create({
        data: { invoiceId, event: 'client_replied', detail: `from ${from}: ${subject}` },
    });
    // The owner is always in the loop — forward the gist to their inbox.
    const bodyPreview = body ? `\n\n"${body.slice(0, 500)}"` : '';
    await (0, notify_1.notifyOwner)(invoice.accountId, `Client replied: ${subject || 'Re: your invoice'}`, `${from} replied about invoice ${invoice.stripeInvoiceId}.${bodyPreview}` +
        `\n\nReminders for this invoice are paused. To respond, reply to this email thread from your inbox.`);
    res.json({ received: true });
});
//# sourceMappingURL=inbound.js.map