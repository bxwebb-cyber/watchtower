import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { Resend } from 'resend';
import { Webhook } from 'svix';
import { notifyOwner } from '../services/notify';

const prisma = new PrismaClient();
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export const inboundRouter = Router();

// Resend inbound webhook: a customer replied to a reminder email.
//
// Every reminder goes out with reply-to = reply-<invoiceId>@<SENDING_DOMAIN>,
// so the `to` address here tells us EXACTLY which invoice the reply is about.
// No subject parsing, no guessing.
//
// Flow: verify signature -> match invoice -> fetch the full body (the webhook
// carries metadata only) -> store the reply -> pause reminders -> forward the
// gist to the owner's inbox.
inboundRouter.post('/', async (req, res) => {
  // Verify Resend/Svix webhook signature.
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (secret) {
    try {
      const wh = new Webhook(secret);
      const payload = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      wh.verify(payload, {
        'svix-id': Array.isArray(req.headers['svix-id'])
          ? req.headers['svix-id'][0] : (req.headers['svix-id'] ?? ''),
        'svix-timestamp': Array.isArray(req.headers['svix-timestamp'])
          ? req.headers['svix-timestamp'][0] : (req.headers['svix-timestamp'] ?? ''),
        'svix-signature': Array.isArray(req.headers['svix-signature'])
          ? req.headers['svix-signature'][0] : (req.headers['svix-signature'] ?? ''),
      });
    } catch (err) {
      console.error('[inbound] signature verification failed', (err as Error).message);
      return res.status(401).json({ error: 'invalid webhook signature' });
    }
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const event = body ?? {};

  // Resend inbound sends the email object directly (not wrapped); tolerate
  // both the bare shape and a {type, data} wrapper.
  const type = event.type;
  const data = event.data ?? event;

  if (type && type !== 'email.received') {
    return res.json({ received: true });
  }

  const toAddrs: string[] = Array.isArray(data.to) ? data.to : [];
  const from: string = data.from ?? '';
  const subject: string = data.subject ?? '';

  // Which invoice is this reply for?
  const toLine = toAddrs.join(' ');
  const match = /reply-([a-z0-9]+)@/i.exec(toLine);
  if (!match) {
    return res.json({ received: true });
  }
  const invoiceId = match[1];

  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) {
    return res.json({ received: true });
  }

  // The webhook carries metadata only — fetch the full body so the owner
  // sees what the client actually said.
  let emailBody = '';
  const emailId = data.email_id;
  if (resend && emailId) {
    try {
      const full = await resend.emails.get(emailId);
      emailBody = (full?.data as { text?: string; html?: string } | undefined)?.text ?? '';
      if (!emailBody) {
        emailBody = (full?.data as { html?: string } | undefined)?.html ?? '';
      }
    } catch (err) {
      console.error('[inbound] failed to fetch email body', (err as Error).message);
    }
  }

  // Record the reply + pause reminders.
  await prisma.reply.create({ data: { invoiceId, from, subject, body: emailBody } });
  await prisma.invoice.update({ where: { id: invoiceId }, data: { repliedAt: new Date() } });
  await prisma.auditEvent.create({
    data: { invoiceId, event: 'client_replied', detail: `from ${from}: ${subject}` },
  });

  // Forward the gist to the owner.
  const bodyPreview = emailBody ? `\n\n"${emailBody.slice(0, 500)}"` : '';
  await notifyOwner(
    invoice.accountId,
    `Client replied: ${subject || 'Re: your invoice'}`,
    `${from} replied about invoice ${invoice.stripeInvoiceId}.${bodyPreview}` +
      `\n\nReminders for this invoice are paused. To respond, reply to this email thread from your inbox.`
  );

  res.json({ received: true });
});