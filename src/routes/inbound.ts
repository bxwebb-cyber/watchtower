import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { Resend } from 'resend';
import { Webhook } from 'svix';
import { notifyOwner, mailFrom } from '../services/notify';
import { replyText } from '../lib/replyText';

const prisma = new PrismaClient();
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export const inboundRouter = Router();

type SvixHeaders = Record<'svix-id' | 'svix-timestamp' | 'svix-signature', string | string[] | undefined>;

// Check the Svix signature against the EXACT bytes Resend sent, then parse.
// express.raw() hands us a Buffer; re-serializing a parsed object instead
// changes the bytes and every real webhook would fail the check.
// Throws if the signature doesn't match.
export function verifyInbound(rawBody: unknown, headers: SvixHeaders, secret: string): any {
  const payload = Buffer.isBuffer(rawBody)
    ? rawBody.toString('utf8')
    : typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody ?? {});
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
  new Webhook(secret).verify(payload, {
    'svix-id': first(headers['svix-id']),
    'svix-timestamp': first(headers['svix-timestamp']),
    'svix-signature': first(headers['svix-signature']),
  });
  return JSON.parse(payload);
}

// Mail to any other @getdunn.org address (hello@, support@, billing@ …) is
// Dunn's own inbox: forward it to FORWARD_INBOX_TO (Bashira's Gmail) with
// Reply-To set to the sender, so hitting Reply answers them directly. Never
// forward mail from our own domain — that would loop.
export function isInboxMail(toAddrs: string[], from: string, sendingDomain: string | undefined): boolean {
  if (!sendingDomain) return false;
  const domain = sendingDomain.toLowerCase();
  if (from.toLowerCase().includes('@' + domain)) return false;
  const ours = toAddrs.filter((a) => a.toLowerCase().includes('@' + domain));
  return ours.length > 0 && !ours.some((a) => /(^|[<\s])reply-[a-z0-9]+@/i.test(a));
}

async function forwardInboxMail(emailId: string, from: string, subject: string, toAddrs: string[]) {
  const forwardTo = process.env.FORWARD_INBOX_TO;
  if (!resend || !forwardTo || !emailId) {
    console.error('[inbound] inbox mail not forwarded (FORWARD_INBOX_TO not set?) from', from);
    return;
  }
  const full = await resend.emails.receiving.get(emailId);
  if (full.error || !full.data) {
    console.error('[inbound] could not fetch inbox mail', full.error?.message);
    return;
  }
  const sentTo = toAddrs.join(', ');
  const sent = await resend.emails.send({
    from: mailFrom(),
    to: forwardTo,
    replyTo: from,
    subject: subject || '(no subject)',
    text: `To: ${sentTo}\nFrom: ${from}\n\n${full.data.text ?? ''}`,
    ...(full.data.html ? { html: `<p style="color:#7C8B88;font-size:12px">To: ${sentTo} · From: ${from.replace(/</g, '&lt;')}</p>${full.data.html}` } : {}),
  });
  if (sent.error) console.error('[inbound] inbox forward failed', sent.error.message);
  else console.log(`[inbound] forwarded inbox mail for ${sentTo}`);
}

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
  // Verify Resend/Svix webhook signature — required, not optional.
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[inbound] RESEND_WEBHOOK_SECRET not configured — rejecting webhook');
    return res.status(500).json({ error: 'webhook not configured' });
  }
  let event: any;
  try {
    event = verifyInbound(req.body, req.headers as SvixHeaders, secret) ?? {};
  } catch (err) {
    console.error('[inbound] signature verification failed', (err as Error).message);
    return res.status(401).json({ error: 'invalid webhook signature' });
  }

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

  if (isInboxMail(toAddrs, from, process.env.SENDING_DOMAIN)) {
    await forwardInboxMail(data.email_id, from, subject, toAddrs);
    return res.json({ received: true });
  }

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
  // sees what the client actually said. Received mail lives under
  // emails.receiving; emails.get() only knows mail we SENT.
  let emailBody = '';
  const emailId = data.email_id;
  if (resend && emailId) {
    try {
      const full = await resend.emails.receiving.get(emailId);
      if (full.error) console.error('[inbound] failed to fetch email body', full.error.message);
      // Just the client's new words: no markup, no quoted copy of our email.
      emailBody = replyText(full.data?.text || full.data?.html || '');
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
    `${from} replied about invoice ${invoice.stripeNumber ?? invoice.stripeInvoiceId}.${bodyPreview}` +
      `\n\nReminders for this invoice are paused. Hit Reply to answer them directly.`,
    from
  );

  res.json({ received: true });
});