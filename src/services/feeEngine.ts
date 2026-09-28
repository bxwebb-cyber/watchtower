import { PrismaClient } from '@prisma/client';
import type { Invoice, Client, Account, FeePolicy, Prisma } from '@prisma/client';
import Stripe from 'stripe';
import { notifyOwner } from './notify';
import { isPastFeeDeadline, sendClientEmail } from './reminderEngine';
import { agreedFeeCents, checkFeeChange } from './feeRules';

const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// One bill: when an invoice is still unpaid the day after its fee deadline
// (due date + grace days), replace it with a single invoice for the original
// balance + the late fee, and email the client "a late fee has been added —
// pay $X". With auto-apply off (the default) the fee waits for the owner to
// approve, lower or waive it in the dashboard. The fee terms were set by the
// owner at invoice creation, so this is enforcement of an agreed-upon term.
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

    const feeCents = agreedFeeCents(invoice.amount, fee);
    if (feeCents <= 0) continue;

    // owner approval gate: only auto-apply if the account has opted in,
    // otherwise it waits in the dashboard for approve / change / waive.
    const settings = await prisma.settings.findUnique({
      where: { accountId: invoice.accountId },
    });
    if (!settings?.autoApplyFees) {
      if (invoice.feeStatus !== 'pending') {
        await prisma.invoice.update({
          where: { id: invoice.id },
          data: { feeStatus: 'pending', feeAmountCents: feeCents },
        });
      }
      if (priorEvents.has('fee_pending_approval')) continue; // already asked
      await prisma.auditEvent.create({
        data: {
          invoiceId: invoice.id,
          event: 'fee_pending_approval',
          detail: `${feeLabel(fee)} = ${money(feeCents)} after ${fee.graceDays}d grace (auto-apply off)`,
        },
      });
      await notifyOwner(
        invoice.accountId,
        `Late fee ready for your approval — invoice ${invoice.stripeNumber ?? invoice.stripeInvoiceId}`,
        `${invoice.client?.name ?? invoice.client?.email} is ${Math.round((now.getTime() - due.getTime()) / 86_400_000)} days late. The ${money(feeCents)} late fee is ready. Nothing is charged until you approve it — you can also lower it or waive it in the dashboard.`
      );
      continue;
    }

    try {
      if (await applyFee(invoice, feeCents, now, { byOwner: false })) applied++;
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

// ---- Owner actions (dashboard) ----

export class FeeActionError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// Approve a pending fee — at the amount in the terms, or lower.
export async function approveFee(invoiceId: string, accountId: string, amountCents?: number, now = new Date()) {
  const invoice = await loadForAccount(invoiceId, accountId);
  const fee = requireFeePolicy(invoice);
  if (invoice.status !== 'open') throw new FeeActionError(409, 'This invoice is no longer open.');
  if (invoice.feeApplied) throw new FeeActionError(409, 'The late fee is already on the bill.');
  if (invoice.feeStatus === 'waived') throw new FeeActionError(409, 'This late fee was waived.');
  if (!isPastFeeDeadline(now, invoice.dueDate, fee.graceDays)) {
    throw new FeeActionError(409, "The fee deadline hasn't passed yet.");
  }
  const agreed = agreedFeeCents(invoice.amount, fee);
  const feeCents = amountCents ?? agreed;
  const problem = checkFeeChange(feeCents, agreed);
  if (problem) throw new FeeActionError(400, problem);

  const result = await applyFee(invoice, feeCents, now, { byOwner: true });
  if (!result) throw new FeeActionError(409, 'Stripe shows this invoice is no longer open — refresh the dashboard.');
  return result;
}

// Lower a fee that's already on the bill: reissue the bill at the new total.
export async function changeBilledFee(invoiceId: string, accountId: string, amountCents: number, now = new Date()) {
  const invoice = await loadForAccount(invoiceId, accountId);
  const fee = requireFeePolicy(invoice);
  requireBilledFee(invoice);
  const agreed = agreedFeeCents(invoice.amount, fee);
  const problem = checkFeeChange(amountCents, agreed);
  if (problem) throw new FeeActionError(400, problem);
  if (amountCents === invoice.feeAmountCents) throw new FeeActionError(400, `The late fee is already ${money(amountCents)}.`);

  const number = invoice.stripeNumber || invoice.stripeInvoiceId;
  const result = await reissueBill(invoice, amountCents, now, {
    description: `Replaces invoice ${number}, now void. The late fee was lowered to ${money(amountCents)}.`,
    feeLine: `Late fee (lowered from ${money(agreed)})`,
    fields: { feeApplied: true, feeAmountCents: amountCents, feeIssuedAt: now, feeStatus: 'open' },
  });
  if (!result) throw new FeeActionError(409, 'Stripe shows this invoice is no longer open — refresh the dashboard.');
  await prisma.auditEvent.create({
    data: {
      invoiceId: invoice.id,
      event: 'fee_lowered',
      detail: `Late fee lowered by you from ${money(invoice.feeAmountCents ?? agreed)} to ${money(amountCents)} — new bill ${money(result.totalCents)}`,
    },
  });
  await emailClient(invoice.id, 'fee_updated', result.stripeInvoiceId, invoice.account.stripeAccountId);
  return result;
}

// Waive a fee. Pending: nothing was billed, so just record it. On the bill:
// reissue the bill without the fee and tell the client.
export async function waiveFee(invoiceId: string, accountId: string, note: string | null, now = new Date()) {
  const invoice = await loadForAccount(invoiceId, accountId);
  if (invoice.feeStatus === 'waived') throw new FeeActionError(409, 'This late fee was already waived.');
  const detail = note ? `Late fee waived by you — "${note}"` : 'Late fee waived by you';

  if (invoice.feeStatus === 'pending') {
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { feeStatus: 'waived', waiveNote: note },
    });
    await prisma.auditEvent.create({ data: { invoiceId: invoice.id, event: 'fee_waived', detail } });
    return { billed: false as const };
  }

  requireBilledFee(invoice);
  const number = invoice.stripeNumber || invoice.stripeInvoiceId;
  const result = await reissueBill(invoice, 0, now, {
    description: `Replaces invoice ${number}, now void. The late fee was waived.`,
    feeLine: '',
    fields: { feeApplied: false, feeStatus: 'waived', waiveNote: note },
  });
  if (!result) throw new FeeActionError(409, 'Stripe shows this invoice is no longer open — refresh the dashboard.');
  await prisma.auditEvent.create({
    data: { invoiceId: invoice.id, event: 'fee_waived', detail: `${detail} — new bill ${money(result.totalCents)}` },
  });
  await emailClient(invoice.id, 'fee_updated', result.stripeInvoiceId, invoice.account.stripeAccountId);
  return { billed: true as const, ...result };
}

// ---- Internals ----

type FeeInvoice = Invoice & { client: Client | null; account: Account; feePolicy: FeePolicy | null };

async function loadForAccount(invoiceId: string, accountId: string): Promise<FeeInvoice> {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, accountId },
    include: { client: true, account: true, feePolicy: true },
  });
  if (!invoice) throw new FeeActionError(404, 'Invoice not found.');
  return invoice;
}

function requireFeePolicy(invoice: FeeInvoice): FeePolicy {
  if (!invoice.feePolicy || invoice.feePolicy.kind === 'none') {
    throw new FeeActionError(400, 'This invoice has no late fee.');
  }
  return invoice.feePolicy;
}

function requireBilledFee(invoice: FeeInvoice) {
  if (invoice.status !== 'open' || !invoice.feeApplied || invoice.feeStatus !== 'open') {
    throw new FeeActionError(400, "There's no late fee on the bill to change.");
  }
  // Fees billed under the old two-invoice model live on a separate Stripe
  // invoice; swapping this one would drop or double-count them.
  if (invoice.feeInvoiceId && invoice.feeInvoiceId !== invoice.stripeInvoiceId) {
    throw new FeeActionError(409, 'This late fee was billed as a separate invoice — change it in Stripe.');
  }
}

async function applyFee(invoice: FeeInvoice, feeCents: number, now: Date, o: { byOwner: boolean }) {
  const fee = invoice.feePolicy!;
  const agreed = agreedFeeCents(invoice.amount, fee);
  const lowered = feeCents < agreed;
  const number = invoice.stripeNumber || invoice.stripeInvoiceId;

  const result = await reissueBill(invoice, feeCents, now, {
    description: `Replaces invoice ${number}, now void. Includes the late fee agreed in the invoice terms.`,
    feeLine: lowered ? `Late fee (lowered from ${money(agreed)})` : `Late fee (${feeLabel(fee)}) per the invoice terms`,
    fields: { feeApplied: true, feeAmountCents: feeCents, feeIssuedAt: now, feeStatus: 'open' },
  });
  if (!result) return null;

  await prisma.auditEvent.create({
    data: {
      invoiceId: invoice.id,
      event: 'fee_applied',
      detail: `${money(feeCents)}${o.byOwner ? ' — approved by you' : ''}${lowered ? ` (lowered from ${money(agreed)})` : ''} — ${invoice.stripeInvoiceId} voided, replaced by ${result.stripeInvoiceId} for ${money(result.totalCents)}`,
    },
  });

  // Tell the client: "a late fee has been added — pay $X" (designer template).
  const emailed = await emailClient(invoice.id, 'fee_applied', result.stripeInvoiceId, invoice.account.stripeAccountId);

  if (!o.byOwner) {
    await notifyOwner(
      invoice.accountId,
      `Late fee applied — invoice ${number}`,
      `${invoice.client?.name ?? invoice.client?.email} hadn't paid invoice ${number} by the fee deadline, so Dunn added the ${money(feeCents)} late fee. The original invoice was replaced with one bill for ${money(result.totalCents)}, and ${emailed ? 'Dunn emailed it to them' : 'Stripe sent it to them'}.`
    );
  }
  return result;
}

// Stripe can't change a finalized invoice, so every fee change swaps the
// bill: create + finalize a new invoice (original balance + fee, if any),
// repoint our row to it, then void the current one. Our row keeps its due
// date, number, reminder history and fee terms — only the Stripe invoice
// behind it changes. Repointing BEFORE voiding means the old invoice's
// `invoice.voided` webhook finds no row, so it can't stop the reminders.
// The repoint only succeeds if the row still points at the invoice we read,
// so two changes at once (owner click + morning run) can't both go through.
async function reissueBill(
  invoice: FeeInvoice,
  feeCents: number,
  now: Date,
  o: { description: string; feeLine: string; fields: Prisma.InvoiceUpdateManyMutationInput }
): Promise<{ stripeInvoiceId: string; totalCents: number; feeCents: number } | null> {
  const opts = { stripeAccount: invoice.account.stripeAccountId };
  const number = invoice.stripeNumber || invoice.stripeInvoiceId;
  const customer = invoice.client!.stripeCustomerId;

  // Only an open invoice can be changed. If Stripe says otherwise (e.g. a
  // paid webhook we missed), mirror that instead.
  const current = await stripe.invoices.retrieve(invoice.stripeInvoiceId, {}, opts);
  if (current.status !== 'open') {
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        status: current.status ?? invoice.status,
        ...(current.status === 'paid' ? { paidAt: now } : {}),
      },
    });
    await prisma.auditEvent.create({
      data: {
        invoiceId: invoice.id,
        event: 'fee_skipped',
        detail: `Stripe shows the invoice as ${current.status} — late fee unchanged`,
      },
    });
    return null;
  }

  // What's owed without any fee currently on the bill.
  const baseCents = current.amount_remaining - (invoice.feeApplied ? invoice.feeAmountCents ?? 0 : 0);

  // Dunn emails the client itself, so Stripe must not also send its own
  // generic invoice email: auto_advance off, finalize without sending.
  const replacement = await stripe.invoices.create(
    {
      customer,
      collection_method: 'send_invoice',
      days_until_due: 14,
      auto_advance: false,
      description: o.description,
      metadata: {
        watchtower: 'true',
        replaces_invoice: current.id,
        original_number: number,
        includes_fee: feeCents > 0 ? 'true' : 'false',
      },
    },
    opts
  );
  await stripe.invoiceItems.create(
    { customer, invoice: replacement.id, amount: baseCents, currency: invoice.currency, description: `Invoice ${number}` },
    opts
  );
  if (feeCents > 0) {
    await stripe.invoiceItems.create(
      { customer, invoice: replacement.id, amount: feeCents, currency: invoice.currency, description: o.feeLine },
      opts
    );
  }
  const finalized = await stripe.invoices.finalizeInvoice(replacement.id, { auto_advance: false }, opts);

  const previous = {
    stripeInvoiceId: invoice.stripeInvoiceId,
    hostedInvoiceUrl: invoice.hostedInvoiceUrl,
    stripeNumber: invoice.stripeNumber,
    feeApplied: invoice.feeApplied,
    feeInvoiceId: invoice.feeInvoiceId,
    feeAmountCents: invoice.feeAmountCents,
    feeIssuedAt: invoice.feeIssuedAt,
    feeDueDate: invoice.feeDueDate,
    feeStatus: invoice.feeStatus,
    waiveNote: invoice.waiveNote,
  };
  const { count } = await prisma.invoice.updateMany({
    where: { id: invoice.id, stripeInvoiceId: current.id },
    data: {
      stripeInvoiceId: finalized.id,
      hostedInvoiceUrl: finalized.hosted_invoice_url ?? invoice.hostedInvoiceUrl,
      stripeNumber: number, // keep the number the client already knows
      feeInvoiceId: feeCents > 0 ? finalized.id : null,
      feeDueDate:
        feeCents > 0
          ? finalized.due_date
            ? new Date(finalized.due_date * 1000)
            : new Date(now.getTime() + 14 * 86_400_000)
          : null,
      ...o.fields,
    },
  });
  if (count === 0) {
    await stripe.invoices.voidInvoice(finalized.id, {}, opts).catch(() => {});
    throw new FeeActionError(409, 'This invoice changed a moment ago — refresh the dashboard and try again.');
  }

  try {
    await stripe.invoices.voidInvoice(current.id, {}, opts);
  } catch (err) {
    // Couldn't void (e.g. the client paid the current bill seconds ago):
    // undo — void the replacement and point our row back.
    await stripe.invoices.voidInvoice(finalized.id, {}, opts).catch(() => {});
    await prisma.invoice.update({ where: { id: invoice.id }, data: previous });
    throw err;
  }

  return { stripeInvoiceId: finalized.id, totalCents: baseCents + feeCents, feeCents };
}

// Dunn emails the client itself; if that fails, Stripe sends the bill so the
// client still gets it.
async function emailClient(invoiceId: string, step: string, stripeInvoiceId: string, stripeAccount: string) {
  const fresh = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: { client: true, account: true, feePolicy: true },
  });
  let emailed = false;
  try {
    emailed = await sendClientEmail(fresh, step);
  } catch (err) {
    console.error(`[fee] ${step} email failed for invoice`, invoiceId, err);
  }
  if (!emailed) {
    await stripe.invoices.sendInvoice(stripeInvoiceId, {}, { stripeAccount }).catch((err) =>
      console.error('[fee] Stripe fallback send failed for invoice', invoiceId, err)
    );
  }
  return emailed;
}

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function feeLabel(p: { kind: string; amount: number }): string {
  return p.kind === 'percent' ? `${p.amount}%` : `$${p.amount.toFixed(2)}`;
}
