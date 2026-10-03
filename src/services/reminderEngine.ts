import { PrismaClient } from '@prisma/client';
import type { Invoice, Client, Account, FeePolicy } from '@prisma/client';
import { Resend } from 'resend';
import { clientMailFrom, replyToFor, notifyOwner, notifyEscalation } from './notify';
import { renderEmail, EMAIL_TEMPLATES, EmailData } from './emailRenderer';
import { agreedFeeCents, feeWhen } from './feeRules';
import { usd, usdDollars } from '../lib/money';
import { createdSinceStart } from '../jobs/startDate';
import { reportProblem } from './problems';

const prisma = new PrismaClient();
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// The agent's clock: offsets relative to the invoice due date, in days
// (negative = before due). Deliberately few emails, so the owner's clients
// never feel nagged (Bashira's call 9/28, after the research):
//   · the invoice itself, sent the moment it's created (invoiceCreator)
//   · ONE friendly reminder 4 days before the due date
//   · ONE warning 3 days before the late fee lands ("pay by <deadline>"), or,
//     with no late fee, ONE "past due" nudge at 3 days late
//   · the "late fee added" email the morning after the deadline (fee job)
//   · at 14 days late the OWNER decides — final notice, or they'll call.
// No due-today email. With no grace period (0) the fee lands the day after
// the due date, so the invoice and the reminder already carry the warning.
export type ScheduleStep = { step: string; offsetDays: number };
export const PRE_DUE_DAYS = 4;

export function scheduleFor(o: { hasLateFee: boolean; graceDays: number }): ScheduleStep[] {
  const steps: ScheduleStep[] = [{ step: 't-4', offsetDays: -PRE_DUE_DAYS }];
  if (!o.hasLateFee) {
    steps.push({ step: 't+3', offsetDays: 3 });
  } else if (o.graceDays >= 1) {
    // The fee lands on day grace+1; warn 3 days before that, but never
    // before the due date has actually passed.
    steps.push({ step: 'fee_warning', offsetDays: Math.max(1, o.graceDays - 2) });
  }
  steps.push({ step: 't+14', offsetDays: 14 });
  return steps.sort((a, b) => a.offsetDays - b.offsetDays);
}

const MIN_DAYS_AFTER_CREATE = 2;

interface BodyCtx {
  number: string;
  amount: string;
  due: string;
  greeting: string;
  feeClause?: string;
  signature: string;
  footer?: string;
}

const BODY: Record<string, (i: BodyCtx) => string> = {
  't-7': (i) =>
    `${i.greeting}\n\nJust a friendly heads up that invoice ${i.number} for ${i.amount} is scheduled to be paid on ${i.due}.\n\nIf everything's already handled, great — no need to reply. Otherwise, here's the payment link: [pay]\n\n${i.signature}\n`,
  't-3': (i) =>
    `${i.greeting}\n\nA quick reminder that invoice ${i.number} for ${i.amount} is due in 3 days (${i.due}).\n\nPay here: [pay]\n\n${i.signature}\n`,
  due: (i) =>
    `${i.greeting}\n\nInvoice ${i.number} for ${i.amount} is due today (${i.due}).\n\nYou can pay here: [pay]\n\nIf it's already paid, please disregard this note.\n\n${i.signature}\n`,
  't+3': (i) =>
    `${i.greeting}\n\nI wanted to follow up on invoice ${i.number} for ${i.amount}, which was due on ${i.due}.\n\nIf it's already on its way, thank you! If not, here's the payment link: [pay]\n\nJust let me know if there's anything I can help with.\n\n${i.signature}\n`,
  't+7': (i) =>
    `${i.greeting}\n\nInvoice ${i.number} for ${i.amount} is now past due (originally due ${i.due}).${i.feeClause ? ` ${i.feeClause}` : ''}\n\nPlease settle this at your earliest convenience:\n\n[pay]\n\nIf you have questions or need to make arrangements, just reply to this email.\n\n${i.signature}\n`,
  't+14': (i) =>
    `${i.greeting}\n\nThis is a final notice regarding invoice ${i.number} for ${i.amount} (due ${i.due}).${i.feeClause ? ` ${i.feeClause}` : ''}\n\nPlease pay at your earliest convenience:\n\n[pay]\n\nIf there's an issue, please reply — we'd rather sort it out than let it sit.\n\n${i.signature}\n`,
};

export async function runReminderJob(now = new Date()) {
  if (!resend) {
    console.warn('[job] RESEND_API_KEY not set — reminders dry-run (not sent)');
  }

  const openInvoices = await prisma.invoice.findMany({
    where: { status: 'open', repliedAt: null, ...createdSinceStart() },
    include: { client: true, account: true, feePolicy: true },
  });

  let sent = 0;
  for (const invoice of openInvoices) {
    // Required: the reminder must be recognizable as coming from the business.
    // If the owner never set a business name, don't send from a generic sender
    // (it gets ignored) — skip and flag the owner once.
    if (!invoice.account?.businessName?.trim()) {
      const alreadyFlagged = await prisma.auditEvent.findFirst({
        where: { invoiceId: invoice.id, event: 'missing_business_name' },
      });
      if (!alreadyFlagged) {
        await prisma.auditEvent.create({
          data: {
            invoiceId: invoice.id,
            event: 'missing_business_name',
            detail: 'Reminder skipped — no business name set on the account',
          },
        });
        await notifyOwner(
          invoice.accountId,
          'Reminder skipped — add your business name',
          `A reminder for ${invoice.client?.name ?? 'a client'} was skipped because no business name is set. Set it in Settings so reminders come from your business, not Watchtower.`
        );
      }
      continue;
    }

    // The owner answered the T+14 escalation with "send the final notice".
    // The escalation already recorded t+14, so the schedule would never pick
    // it again — send it here, once.
    if (invoice.escalateAction === 'send_reminder') {
      await prisma.invoice.update({ where: { id: invoice.id }, data: { escalateAction: null } });
      if (await sendClientEmail(invoice, 't+14')) sent++;
      continue;
    }

    const dueDay = dueDayStart(invoice.dueDate);
    const offset = dayOffset(now, invoice.dueDate);

    const sentSteps = new Set(
      (await prisma.reminder.findMany({ where: { invoiceId: invoice.id } })).map((r) => r.step)
    );

    const hasLateFee = invoice.feePolicy != null && invoice.feePolicy.kind !== 'none';
    const graceDays = invoice.feePolicy?.graceDays ?? 0;
    const step = computeNextStep(offset, sentSteps, scheduleFor({ hasLateFee, graceDays }));
    if (!step) continue;

    const createdAtDay = nyDayStart(invoice.createdAt);
    if (step.offsetDays < 0) {
      const scheduledDay = addDays(dueDay, step.offsetDays);
      const daysAfterCreation = Math.round(
        (scheduledDay.getTime() - createdAtDay.getTime()) / 86_400_000
      );
      if (daysAfterCreation <= MIN_DAYS_AFTER_CREATE) continue;
    }

    const alreadyPaid = await prisma.invoice.findUnique({
      where: { id: invoice.id },
    });
    if (alreadyPaid?.status === 'paid') continue;

    const number = invoice.stripeNumber || invoice.stripeInvoiceId;
    // "A late fee is added if unpaid after X" is false once X has passed —
    // the fee job's "late fee added" email replaces the warning.
    if (isStaleFeeWarning(step.step, { hasLateFee, feeApplied: invoice.feeApplied, offset, graceDays })) {
      continue;
    }

    // ESCALATION: at T+14, instead of auto-sending a client email, ask the owner.
    if (step.step === 't+14') {
      if (invoice.escalateAction == null) {
        // First hit — ask the owner what to do.
        await notifyEscalation(
          invoice.accountId,
          invoice.id,
          number,
          invoice.client?.name ?? 'Unknown',
          `${usd(invoice.amount)}`,
          offset,
          process.env.APP_URL ?? 'http://localhost:4000'
        );
        await prisma.reminder.create({
          data: { invoiceId: invoice.id, step: step.step, subject: 'Escalation — owner decision needed' },
        });
        await prisma.auditEvent.create({
          data: { invoiceId: invoice.id, event: 'escalation_notified', detail: 't+14 — owner asked: send or call?' },
        });
        sent++;
        continue;
      }
      if (invoice.escalateAction === 'owner_calling') {
        continue;
      }
    }

    if (await sendClientEmail(invoice, step.step)) sent++;

    // Owner alert on past-due reminders.
    if (offset >= 7) {
      await notifyOwner(
        invoice.accountId,
        `Invoice ${number} is past due`,
        `${invoice.client?.name ?? invoice.client?.email} is ${offset} days late on invoice ${number} for ${usd(invoice.amount)}. Watchtower reminded them today (${step.step}). No action needed unless you want to step in.`
      );
    }
  }

  console.log(`[job] reminder run: ${sent} sent/recorded`);
  return sent;
}

type EmailInvoice = Invoice & { client: Client | null; account: Account; feePolicy: FeePolicy | null };

// Render one of the designer's client emails for this invoice, send it from
// the business ("Hudson & Co. via Dunn"), and record it. Dry-run (no
// RESEND_API_KEY) records without sending. Returns false when nothing went
// out — no client email, or the send failed (not recorded, so it retries).
// Plain names for the emails Dunn sends, for problem reports.
const STEP_LABEL: Record<string, string> = {
  new_invoice: 'invoice email', 't-4': 'reminder', fee_warning: 'late-fee warning', 't+3': 'past-due notice',
  't+14': 'final notice', fee_applied: 'late-fee notice', fee_updated: 'late-fee update', cancelled: 'cancellation notice',
};

export async function sendClientEmail(
  invoice: EmailInvoice,
  step: string,
  extra: Partial<EmailData> = {}
): Promise<boolean> {
  const to = invoice.client?.email;
  if (!to) return false;
  const data = { ...emailDataFor(invoice), ...extra };
  const { html, subject } = renderEmail(EMAIL_TEMPLATES[step], data);

  if (!resend) {
    await prisma.reminder.create({ data: { invoiceId: invoice.id, step, subject } });
    await prisma.auditEvent.create({
      data: { invoiceId: invoice.id, event: 'reminder_sent (dry-run)', detail: step },
    });
    return true;
  }

  const msg = await resend.emails.send({
    from: clientMailFrom(invoice.account.businessName),
    to,
    subject,
    html,
    text: step === 'cancelled'
      ? `Invoice ${data.invoiceId} for ${data.amountDue} has been cancelled. You don't need to pay it.`
      : `Invoice ${data.invoiceId}: ${data.feeApplied ? data.balanceDue : data.amountDue} due. Pay here: ${data.payUrl}`,
    replyTo: replyToFor(invoice.id),
  });
  if (msg.error) {
    console.error(`[email] ${step} for invoice ${invoice.id} failed:`, msg.error.message);
    await prisma.auditEvent.create({
      data: { invoiceId: invoice.id, event: 'email_failed', detail: `${step}: ${msg.error.message}` },
    });
    const number = invoice.stripeNumber ?? invoice.stripeInvoiceId;
    await reportProblem({
      kind: 'Client email not sent',
      key: `email_failed:${invoice.id}:${step}`,
      accountId: invoice.accountId,
      detail: `Invoice ${number}, step ${step}, to ${to}: ${msg.error.message}`,
      owner: {
        subject: `An email to ${invoice.client?.name ?? to} couldn't be sent`,
        text: `Dunn couldn't send the ${STEP_LABEL[step] ?? 'email'} for invoice ${number} to ${to}.\n\nReason: ${msg.error.message}\n\nCheck that the client's email address is right. Dunn keeps watching the invoice and sends its next scheduled email as usual.`,
      },
    });
    return false;
  }
  await prisma.reminder.create({
    data: { invoiceId: invoice.id, step, subject, messageId: msg.data?.id },
  });
  await prisma.auditEvent.create({
    data: { invoiceId: invoice.id, event: 'reminder_sent', detail: `${step} (${subject}) → ${to}` },
  });
  return true;
}

function emailDataFor(invoice: EmailInvoice): EmailData {
  const due = new Date(invoice.dueDate);
  const hasLateFee = invoice.feePolicy != null && invoice.feePolicy.kind !== 'none';
  const graceDays = invoice.feePolicy?.graceDays ?? 0;
  const termsCents = hasLateFee ? agreedFeeCents(invoice.amount, invoice.feePolicy!) : 0;
  // feeAmountCents is the fee actually billed (the owner may have lowered it).
  const feeCents = invoice.feeAmountCents ?? termsCents;
  // A waived fee is shown as waived but is no longer part of the balance.
  const feeWaived = invoice.feeStatus === 'waived';
  // The deadline is part of the fee terms, so it's known before the fee is
  // applied — that's exactly when the t+7 email needs it ("applies after X").
  const feeDeadline = hasLateFee ? addDays(due, graceDays) : null;
  // Sign off as the owner ("Reply to reach Marta"). Accounts from before the
  // "Your name" field fall back to the full business name, never its first
  // word ("Reply to reach Hudson" for Hudson Creative).
  const businessName = invoice.account.businessName ?? 'Your Business';
  const ownerName = invoice.account.ownerName?.trim() || null;
  return {
    businessName,
    businessEmail: invoice.account.email ?? '',
    businessAddress: '',
    ownerName: ownerName ?? businessName,
    ownerFirstName: ownerName ? ownerName.split(/\s+/)[0] : businessName,
    clientFirstName: invoice.client?.name?.split(/\s+/)[0] ?? 'there',
    invoiceId: invoice.stripeNumber || invoice.stripeInvoiceId,
    amountDue: `${usd(invoice.amount)}`,
    feeAmount: feeCents > 0 ? `${usd(feeCents)}` : null,
    balanceDue: `${usd(invoice.amount + (feeWaived ? 0 : feeCents))}`,
    graceDays,
    dueDateLong: formatDate(due),
    dueWeekday: due.toLocaleDateString('en-US', { weekday: 'long' }),
    feeDeadlineLong: feeDeadline ? formatDate(feeDeadline) : null,
    feeDeadlineShort: feeDeadline
      ? feeDeadline.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : null,
    paidAmount: null,
    paidDateLong: null,
    paymentMethod: null,
    payUrl: paymentLink(invoice),
    receiptUrl: null,
    hasLateFee,
    feeApplied: invoice.feeApplied,
    feeWaived,
    termsFeeAmount: termsCents > 0 ? `${usd(termsCents)}` : null,
    feeWhen: feeWhen(graceDays),
    mascotUrl:
      process.env.MASCOT_URL ??
      `${process.env.APP_URL ?? 'http://localhost:4000'}/lighthouse-transparent.png`,
  };
}

// The fee terms: "a late fee applies if unpaid after <due + grace days>".
// Past the deadline = the day after it, never the deadline day itself.
export function isPastFeeDeadline(now: Date, dueDate: Date, graceDays: number): boolean {
  return dayOffset(now, dueDate) > graceDays;
}

// The fee warning says "a late fee is added if unpaid after X". Once X has
// passed (a missed run catching up), or the fee is on the bill, it's false.
// ('t+3'/'t+7' are the older schedule's steps, still on some invoices.)
export function isStaleFeeWarning(
  step: string,
  o: { hasLateFee: boolean; feeApplied: boolean; offset: number; graceDays: number }
): boolean {
  if (step !== 'fee_warning' && step !== 't+3' && step !== 't+7') return false;
  return o.hasLateFee && (o.feeApplied || o.offset > o.graceDays);
}

function paymentLink(invoice: { hostedInvoiceUrl?: string | null; stripeInvoiceId: string }): string {
  if (invoice.hostedInvoiceUrl) return invoice.hostedInvoiceUrl;
  return `https://pay.stripe.com/invoice/${invoice.stripeInvoiceId}`;
}

function buildFeeClause(invoice: {
  feeApplied: boolean;
  feeAmountCents: number | null;
  feePolicy: { kind: string; amount: number } | null;
}): string | undefined {
  if (invoice.feeApplied && invoice.feeAmountCents != null) {
    return `A late fee of ${usd(invoice.feeAmountCents)} has been applied.`;
  }
  if (invoice.feePolicy && invoice.feePolicy.kind !== 'none') {
    return `Per the invoice terms, a late fee of ${feePolicyLabel(invoice.feePolicy)} may be added.`;
  }
  return undefined;
}

function greetingFor(name?: string | null): string {
  const first = name?.trim().split(/\s+/)[0];
  return first ? `Hi ${first},` : 'Hi there,';
}

function signatureFor(businessName?: string | null): string {
  return businessName ? `Thanks,\n${businessName}` : 'Thanks,';
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

// Calendar days, independent of the server's time zone. A due date is stored
// as midnight UTC of that date; "today" is the date in New York (the business
// day the 9am run belongs to), so an evening catch-up run doesn't jump ahead.
export function dueDayStart(dueDate: Date): Date {
  return new Date(Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate()));
}
export function nyDayStart(moment: Date): Date {
  const [y, m, d] = moment.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function dayOffset(today: Date, dueDate: Date): number {
  return Math.round((nyDayStart(today).getTime() - dueDayStart(dueDate).getTime()) / 86_400_000);
}

export function computeNextStep(
  offset: number,
  sentSteps: Set<string>,
  schedule: ScheduleStep[]
): ScheduleStep | undefined {
  // Only the latest step whose day has arrived. A missed run still catches up
  // to it, but older missed steps are never back-filled ("due in 3 days" after
  // the due date would be wrong).
  const current = [...schedule].reverse().find((s) => s.offsetDays <= offset);
  return current && !sentSteps.has(current.step) ? current : undefined;
}

export function shouldSkipPreDue(
  stepOffset: number,
  dueDay: Date,
  createdAt: Date,
  minDaysAfterCreate = MIN_DAYS_AFTER_CREATE
): boolean {
  if (stepOffset >= 0) return false;
  const scheduledDay = addDays(dueDay, stepOffset);
  const daysAfterCreation = Math.round(
    (scheduledDay.getTime() - createdAt.getTime()) / 86_400_000
  );
  return daysAfterCreation <= minDaysAfterCreate;
}

function feePolicyLabel(p: { kind: string; amount: number }): string {
  return p.kind === 'percent' ? `${p.amount}%` : `${usdDollars(p.amount)}`;
}