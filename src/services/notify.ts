import { Resend } from 'resend';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// The single "from" address for every email the agent sends.
export function mailFrom(): string {
  return process.env.MAIL_FROM || 'Dunn <reminders@getdunn.org>';
}

// The client-facing sender: display name = the business's actual name.
export function clientMailFrom(businessName?: string | null): string {
  const base = mailFrom();
  const addr = base.match(/<[^>]+>/)?.[0] ?? '<reminders@getdunn.org>';
  const label = businessName?.trim();
  if (!label) return base;
  return `${label} via Dunn ${addr}`;
}

// The per-invoice reply-to address for client email replies.
export function replyToFor(invoiceId: string): string {
  const domain = process.env.SENDING_DOMAIN || 'getdunn.org';
  return `reply-${invoiceId}@${domain}`;
}

// Notify the owner about something that happened. Plain-text fallback.
// replyTo: where the owner's Reply goes (e.g. the client, on a reply alert).
export async function notifyOwner(accountId: string, subject: string, text: string, replyTo?: string): Promise<void> {
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
    await resend.emails.send({ from: mailFrom(), to, subject, text, ...(replyTo ? { replyTo } : {}) });
    console.log(`[notify-owner] -> ${to}: ${subject}`);
  } catch (err) {
    console.error('[notify-owner] send failed', (err as Error).message);
  }
}

// Escalation notification — sent when an invoice has been overdue for 14+ days
// and the owner needs to decide: let Dunn send another reminder, or call the client.
// Links point to the dashboard so the owner can act from there.
export async function notifyEscalation(
  accountId: string,
  invoiceId: string,
  invoiceNumber: string,
  clientName: string,
  amount: string,
  daysLate: number,
  appUrl: string
): Promise<void> {
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  const settings = await prisma.settings.findUnique({ where: { accountId } });
  const to = settings?.ownerEmail || account?.email;
  if (!to) {
    console.log(`[notify-escalation] no owner email for account ${accountId}; skipped`);
    return;
  }

  const subject = `Invoice ${invoiceNumber} is ${daysLate} days overdue — what now?`;
  const text = [
    `Invoice ${invoiceNumber} for ${amount} from ${clientName} is ${daysLate} days overdue.`,
    ``,
    `An email reminder was already sent. What would you like to do?`,
    ``,
    `  → Send another reminder: ${appUrl}/invoices/${invoiceId}/escalate?action=send`,
    `  → I'll call them: ${appUrl}/invoices/${invoiceId}/escalate?action=call`,
    ``,
    `Or log into your dashboard to review: ${appUrl}/dashboard.html`,
  ].join('\n');

  if (!resend) {
    console.log(`[notify-escalation] (dry-run) -> ${to}: ${subject}`);
    return;
  }

  try {
    await resend.emails.send({ from: mailFrom(), to, subject, text });
    console.log(`[notify-escalation] -> ${to}: ${subject}`);
    await prisma.auditEvent.create({
      data: {
        invoiceId,
        event: 'escalation_notified',
        detail: `Owner asked: send another reminder or call? (invoice ${invoiceNumber}, ${daysLate} days late)`,
      },
    });
  } catch (err) {
    console.error('[notify-escalation] send failed', (err as Error).message);
  }
}
// Bashira's own heads-up when someone signs up, subscribes or cancels. Goes
// to FOUNDER_EMAIL, else the hello@ forward address (FORWARD_INBOX_TO). Never
// blocks the customer's action if it fails.
export async function notifyFounder(subject: string, text: string): Promise<void> {
  const to = process.env.FOUNDER_EMAIL || process.env.FORWARD_INBOX_TO;
  if (!to) return;
  if (!resend) {
    console.log(`[notify-founder] (dry-run) ${subject}`);
    return;
  }
  try {
    // The time keeps Gmail from stacking a repeat alert (same subject) into an
    // old thread, where it's easy to miss.
    const at = new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
    await resend.emails.send({ from: mailFrom(), to, subject: `Dunn: ${subject} · ${at}`, text });
    console.log(`[notify-founder] ${subject}`);
  } catch (err) {
    console.error('[notify-founder] send failed', (err as Error).message);
  }
}
