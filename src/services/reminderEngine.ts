import { PrismaClient } from '@prisma/client';
import { Resend } from 'resend';
import { clientMailFrom, replyToFor, notifyOwner, notifyEscalation } from './notify';
import { renderEmail, EMAIL_TEMPLATES, EmailData } from './emailRenderer';

const prisma = new PrismaClient();
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// The schedule offsets (relative to the invoice due date), in days.
// Negative = before due. This is the agent's clock.
export const SCHEDULE: { step: string; offsetDays: number; subject: string }[] = [
  { step: 't-7', offsetDays: -7, subject: 'Heads up — invoice {NUMBER} is coming due' },
  { step: 't-3', offsetDays: -3, subject: 'Invoice {NUMBER} is due in 3 days' },
  { step: 'due', offsetDays: 0, subject: 'Invoice {NUMBER} is due today' },
  { step: 't+3', offsetDays: 3, subject: 'Invoice {NUMBER} — payment reminder' },
  { step: 't+7', offsetDays: 7, subject: 'Invoice {NUMBER} — now past due' },
  { step: 't+14', offsetDays: 14, subject: 'Invoice {NUMBER} — final notice' },
];

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
    where: { status: 'open', repliedAt: null },
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

    const due = new Date(invoice.dueDate);
    const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const offset = Math.round((today.getTime() - dueDay.getTime()) / 86_400_000);

    const sentSteps = new Set(
      (await prisma.reminder.findMany({ where: { invoiceId: invoice.id } })).map((r) => r.step)
    );

    const step = [...SCHEDULE].reverse().find((s) => s.offsetDays <= offset && !sentSteps.has(s.step));
    if (!step) continue;

    const createdAtDay = new Date(
      invoice.createdAt.getFullYear(),
      invoice.createdAt.getMonth(),
      invoice.createdAt.getDate()
    );
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
    const templateName = EMAIL_TEMPLATES[step.step];
    const mascotUrl =
      process.env.MASCOT_URL ??
      `${process.env.APP_URL ?? 'http://localhost:4000'}/lighthouse-transparent.png`;
    const amountDue = `$${(invoice.amount / 100).toFixed(2)}`;
    const feeCents = invoice.feeAmountCents ??
      (invoice.feePolicy?.kind && invoice.feePolicy.kind !== 'none'
        ? invoice.feePolicy.kind === 'percent'
          ? Math.round(invoice.amount * (invoice.feePolicy.amount / 100))
          : Math.round(invoice.feePolicy.amount * 100)
        : 0);
    const feeAmount = feeCents > 0 ? `$${(feeCents / 100).toFixed(2)}` : null;
    const balanceCents = invoice.amount + feeCents;
    const graceDays = invoice.feePolicy?.graceDays ?? 7;
    const feeDeadline = invoice.feeApplied ? addDays(due, graceDays) : null;
    const clientFirstName = invoice.client?.name?.split(/\s+/)[0] ?? 'there';

    let htmlEmail: string, subject: string;
    if (templateName) {
      const rendered = renderEmail(templateName, {
        businessName: invoice.account?.businessName ?? 'Your Business',
        businessEmail: invoice.account?.email ?? '',
        businessAddress: '',
        ownerName: invoice.account?.businessName ?? 'Your Business',
        ownerFirstName: invoice.account?.businessName?.split(/\s+/)[0] ?? 'Your',
        clientFirstName,
        invoiceId: number,
        amountDue,
        feeAmount,
        balanceDue: `$${(balanceCents / 100).toFixed(2)}`,
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
        hasLateFee: invoice.feePolicy != null && invoice.feePolicy.kind !== 'none',
        feeApplied: invoice.feeApplied,
        mascotUrl,
      });
      htmlEmail = rendered.html;
      subject = rendered.subject;
    } else {
      subject = step.subject.replace('{NUMBER}', number);
      htmlEmail = '';
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
          `$${(invoice.amount / 100).toFixed(2)}`,
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
      // 'send_reminder' — clear it, fall through to send the email.
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { escalateAction: null },
      });
    }

    if (resend && invoice.client?.email) {
      const msg = await resend.emails.send({
        from: clientMailFrom(invoice.account?.businessName),
        to: invoice.client.email,
        subject,
        html: htmlEmail || undefined,
        text: `Invoice ${number} for ${amountDue}. ${paymentLink(invoice)}`,
        replyTo: replyToFor(invoice.id),
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
    } else if (invoice.client?.email) {
      await prisma.reminder.create({
        data: { invoiceId: invoice.id, step: step.step, subject },
      });
      await prisma.auditEvent.create({
        data: { invoiceId: invoice.id, event: 'reminder_sent (dry-run)', detail: step.step },
      });
      sent++;
    }

    // Owner alert on past-due reminders.
    if (offset >= 7) {
      await notifyOwner(
        invoice.accountId,
        `Invoice ${number} is past due`,
        `${invoice.client?.name ?? invoice.client?.email} is ${offset} days late on invoice ${number} for $${(invoice.amount / 100).toFixed(2)}. Watchtower reminded them today (${step.step}). No action needed unless you want to step in.`
      );
    }
  }

  console.log(`[job] reminder run: ${sent} sent/recorded`);
  return sent;
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
    return `A late fee of $${(invoice.feeAmountCents / 100).toFixed(2)} has been applied.`;
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
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function dayOffset(today: Date, dueDate: Date): number {
  const dueDay = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());
  const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((todayDay.getTime() - dueDay.getTime()) / 86_400_000);
}

export function computeNextStep(
  offset: number,
  sentSteps: Set<string>,
  options?: { schedule?: typeof SCHEDULE }
): (typeof SCHEDULE)[number] | undefined {
  const schedule = options?.schedule ?? SCHEDULE;
  return [...schedule].reverse().find((s) => s.offsetDays <= offset && !sentSteps.has(s.step));
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
  return p.kind === 'percent' ? `${p.amount}%` : `$${p.amount.toFixed(2)}`;
}