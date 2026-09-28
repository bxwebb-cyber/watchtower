import { PrismaClient } from '@prisma/client';
import type { Invoice, Client, Account, FeePolicy } from '@prisma/client';
import Stripe from 'stripe';
import { notifyOwner } from './notify';
import { isPastFeeDeadline, sendClientEmail } from './reminderEngine';

const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// One bill: when an invoice is still unpaid the day after its fee deadline
// (due date + grace days), replace it with a single invoice for the original
// balance + the late fee, and email the client "a late fee has been added —
// pay $X". The fee terms were set by the owner at invoice creation, so this
// is enforcement of an agreed-upon term, not a surprise.
export async function runFeeJob(now = new Date()) {
  const openInvoices = await prisma.invoice.findMany({
    where: { status: 'open', feeApplied: false, feePolicy: { isNot: null } },
    include: { feePolicy: true, client: true, account: true },
  });

  let applied = 0;
  for (const invoice of openInvoices) {
    const fee = invoice.feePolicy!;
    if (fee.kind === 'none') continue;

    // The terms (and the t+7 email) say the fee applies if unpaid AFTER the
    // deadline, so it lands the morning after — never on the deadline itself.
    const due = new Date(invoice.dueDate);
    if (!isPastFeeDeadline(now, due, fee.graceDays)) continue;

    // The job runs daily on a scheduler, so everything below must be safe to
    // repeat: a waived fee is never re-charged, and the owner is asked once.
    const priorEvents = new Set(
      (
        await prisma.auditEvent.findMany({
          where: { invoiceId: invoice.id, event: { in: ['fee_waived', 'fee_pending_approval'] } },
          select: { event: true },
        })
      ).map((e) => e.event)
    );
    if (priorEvents.has('fee_waived')) continue;

    // owner approval gate: only auto-apply if the account has opted in,
    // otherwise mark as pending approval (v1: flag it; approval flow ships
    // with the dashboard)
    const settings = await prisma.settings.findUnique({
      where: { accountId: invoice.accountId },
    });
    if (!settings?.autoApplyFees) {
      if (priorEvents.has('fee_pending_approval')) continue; // already asked
      // not auto-approved — record intent, don't charge yet
      await prisma.auditEvent.create({
        data: {
          invoiceId: invoice.id,
          event: 'fee_pending_approval',
          detail: `${feeLabel(fee)} after ${fee.graceDays}d grace (auto-apply off)`,
        },
      });
      // Owner's call — flag it so they can decide whether to waive the fee.
      await notifyOwner(
        invoice.accountId,
        `Late fee ready for your approval — invoice ${invoice.stripeNumber ?? invoice.stripeInvoiceId}`,
        `${invoice.client?.name ?? invoice.client?.email} is ${Math.round((now.getTime() - due.getTime()) / 86_400_000)} days late. The ${feeLabel(fee)} late fee is ready to apply but auto-apply is off. Approve or waive it in the dashboard.`
      );
      continue;
    }

    const feeAmount = fee.kind === 'percent'
      ? Math.round(invoice.amount * (fee.amount / 100))
      : Math.round(fee.amount * 100);

    if (feeAmount <= 0) continue;

    try {
      if (await replaceWithFeeInvoice(invoice, fee, feeAmount, now)) applied++;
    } catch (err) {
      console.error('[fee] failed for invoice', invoice.id, err);
      await prisma.auditEvent.create({
        data: {
          invoiceId: invoice.id,
          event: 'fee_error',
          detail: (err as Error).message,
        },
      });
    }
  }

  console.log(`[job] fee run: ${applied} fees applied`);
  return applied;
}

type FeeInvoice = Invoice & { client: Client | null; account: Account; feePolicy: FeePolicy | null };

// Stripe can't change a finalized invoice, so the fee is applied by swapping
// the bill: create + finalize a new invoice (original balance + fee), repoint
// our row to it, then void the original. Our row keeps its due date, number,
// reminder history and fee terms — only the Stripe invoice behind it changes.
// Repointing BEFORE voiding means the original's `invoice.voided` webhook
// finds no row, so it can't stop the reminders.
async function replaceWithFeeInvoice(
  invoice: FeeInvoice,
  fee: FeePolicy,
  feeAmount: number,
  now: Date
): Promise<boolean> {
  const opts = { stripeAccount: invoice.account.stripeAccountId };
  const number = invoice.stripeNumber || invoice.stripeInvoiceId;
  const customer = invoice.client!.stripeCustomerId;

  // Only an open invoice gets a fee. If Stripe says otherwise (e.g. a paid
  // webhook we missed), mirror that instead.
  const original = await stripe.invoices.retrieve(invoice.stripeInvoiceId, {}, opts);
  if (original.status !== 'open') {
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        status: original.status ?? invoice.status,
        ...(original.status === 'paid' ? { paidAt: now } : {}),
      },
    });
    await prisma.auditEvent.create({
      data: {
        invoiceId: invoice.id,
        event: 'fee_skipped',
        detail: `Stripe shows the invoice as ${original.status} — no late fee`,
      },
    });
    return false;
  }

  // Dunn emails the client itself (below), so Stripe must not also send its
  // own generic invoice email: auto_advance off, finalize without sending.
  const replacement = await stripe.invoices.create(
    {
      customer,
      collection_method: 'send_invoice',
      days_until_due: 14,
      auto_advance: false,
      description: `Replaces invoice ${number}, now void. Includes the late fee agreed in the invoice terms.`,
      metadata: { watchtower: 'true', replaces_invoice: invoice.stripeInvoiceId, original_number: number },
    },
    opts
  );
  await stripe.invoiceItems.create(
    {
      customer,
      invoice: replacement.id,
      amount: original.amount_remaining,
      currency: invoice.currency,
      description: `Invoice ${number}`,
    },
    opts
  );
  await stripe.invoiceItems.create(
    {
      customer,
      invoice: replacement.id,
      amount: feeAmount,
      currency: invoice.currency,
      description: `Late fee (${feeLabel(fee)}) per the invoice terms`,
    },
    opts
  );
  const finalized = await stripe.invoices.finalizeInvoice(replacement.id, { auto_advance: false }, opts);

  await prisma.invoice.update({
    where: { id: invoice.id },
    data: {
      stripeInvoiceId: finalized.id,
      hostedInvoiceUrl: finalized.hosted_invoice_url ?? invoice.hostedInvoiceUrl,
      stripeNumber: number, // keep the number the client already knows
      feeApplied: true,
      feeInvoiceId: finalized.id,
      feeAmountCents: feeAmount,
      feeIssuedAt: now,
      feeDueDate: finalized.due_date
        ? new Date(finalized.due_date * 1000)
        : new Date(now.getTime() + 14 * 86_400_000),
      feeStatus: 'open',
    },
  });

  try {
    await stripe.invoices.voidInvoice(original.id, {}, opts);
  } catch (err) {
    // Couldn't void (e.g. the client paid the original moments ago): undo —
    // void the replacement and point our row back at the original.
    await stripe.invoices.voidInvoice(finalized.id, {}, opts).catch(() => {});
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        stripeInvoiceId: invoice.stripeInvoiceId,
        hostedInvoiceUrl: invoice.hostedInvoiceUrl,
        stripeNumber: invoice.stripeNumber,
        feeApplied: false,
        feeInvoiceId: null,
        feeAmountCents: null,
        feeIssuedAt: null,
        feeDueDate: null,
        feeStatus: null,
      },
    });
    throw err;
  }

  const total = `$${((original.amount_remaining + feeAmount) / 100).toFixed(2)}`;
  await prisma.auditEvent.create({
    data: {
      invoiceId: invoice.id,
      event: 'fee_applied',
      detail: `${feeLabel(fee)} = $${(feeAmount / 100).toFixed(2)} — ${original.id} voided, replaced by ${finalized.id} for ${total}`,
    },
  });

  // Tell the client: "a late fee has been added — pay $X" (designer template).
  const updated = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoice.id },
    include: { client: true, account: true, feePolicy: true },
  });
  let emailed = false;
  try {
    emailed = await sendClientEmail(updated, 'fee_applied');
  } catch (err) {
    console.error('[fee] fee email failed for invoice', invoice.id, err);
  }
  if (!emailed) {
    // Dunn couldn't email it — have Stripe send the bill so the client still gets it.
    await stripe.invoices.sendInvoice(finalized.id, {}, opts).catch((err) =>
      console.error('[fee] Stripe fallback send failed for invoice', invoice.id, err)
    );
  }

  await notifyOwner(
    invoice.accountId,
    `Late fee applied — invoice ${number}`,
    `${invoice.client?.name ?? invoice.client?.email} hadn't paid invoice ${number} by the fee deadline, so Dunn added the ${feeLabel(fee)} late fee ($${(feeAmount / 100).toFixed(2)}). The original invoice was replaced with one bill for ${total}, and ${emailed ? 'Dunn emailed it to them' : 'Stripe sent it to them'}.`
  );
  return true;
}

function feeLabel(p: { kind: string; amount: number }): string {
  return p.kind === 'percent' ? `${p.amount}%` : `$${p.amount.toFixed(2)}`;
}
