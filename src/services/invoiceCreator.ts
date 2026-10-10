import { PrismaClient, Prisma } from '@prisma/client';
import Stripe from 'stripe';
import { sendClientEmail } from './reminderEngine';
import { monthStart, soloLimitMessage, hasActivePlan, planRequired, NO_PLAN_MESSAGE, countsTowardLimit } from './planLimits';
import { feeWhen } from './feeRules';
import { usd, usdDollars } from '../lib/money';
import { dueTimestamp, dueDateFromStripe, stripeDueTimestamp } from '../lib/dueDate';
import { InvoiceLine, linesTotalCents, stripeItemFor } from './invoiceLines';
import { reportProblem } from './problems';
export { dueTimestamp, dueDateFromStripe };

const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// A real Stripe key (test or live) is sk_ + 24+ chars. Placeholders like
// "sk_test_..." or empty strings mean "not configured" — the form should say
// so clearly instead of throwing an opaque Stripe error.
export function stripeConfigured(): boolean {
  const key = process.env.STRIPE_SECRET_KEY ?? '';
  return /^sk_(test|live)_/.test(key) && key.length >= 30;
}

export interface CreateInvoiceInput {
  accountId: string;
  clientName: string;
  clientEmail: string;
  amountCents: number; // with lines, ignored: the total is the sum of the lines
  // Several services on one invoice. Without lines, one line for amountCents.
  lines?: InvoiceLine[];
  currency?: string;
  dueDate: Date;
  // The fee prompt — set by the owner at creation time, per invoice.
  fee?: {
    kind: 'flat' | 'percent' | 'none';
    amount?: number; // flat: dollars; percent: 0-100
    graceDays?: number; // days after due before the fee applies — the owner's choice, 0 = the day after the due date
  };
  // The client's purchase-order number: many larger clients won't pay an
  // invoice without it. Printed on the Stripe invoice as a custom field.
  poNumber?: string;
  // Set when a recurring template creates the invoice ("Your monthly invoice").
  recurring?: { frequencyLabel: string };
}

export type CreateInvoiceResult =
  | {
      ok: true;
      invoice: {
        id: string;
        stripeInvoiceId: string;
        clientName: string;
        clientEmail: string;
        amount: string;
        dueDate: string;
        fee: string | null;
        hostedInvoiceUrl: string | null;
        stripeNumber: string | null;
      };
    }
  | { ok: false; code: 'not_configured' | 'no_account' | 'no_plan' | 'plan_limit' | 'stripe_error'; message: string };

// Solo ($39) limits live in planLimits (5 clients, 10 invoices per client, a
// month). Business ($59) is unlimited. Un-subscribed accounts (plan null,
// pre-launch) are not blocked.

// The product's heart: owner fills OUR form (with the fee prompt), we create
// the invoice on THEIR connected Stripe account via API, then mirror client +
// invoice + fee policy into our DB so the agent can watch, remind, and fee.
export async function createInvoice(input: CreateInvoiceInput): Promise<CreateInvoiceResult> {
  if (!stripeConfigured()) {
    return {
      ok: false,
      code: 'not_configured',
      message: 'Stripe is not configured yet. Add your sk_test_... key to .env and restart the server.',
    };
  }

  if (input.lines?.length) input = { ...input, amountCents: linesTotalCents(input.lines) };

  // Resolve the account whose Stripe connection we're invoicing under.
  const account = await prisma.account.findUnique({ where: { id: input.accountId } });
  // Signed up but never finished "Connect Stripe": the id is a pending_
  // placeholder, and Stripe would answer with a confusing access error.
  if (!account || account.stripeAccountId.startsWith('pending_')) {
    return {
      ok: false,
      code: 'no_account',
      message: 'Connect your Stripe account first (Settings → Connect Stripe). Dunn creates invoices in your Stripe, so it needs that link.',
    };
  }

  if (planRequired() && !hasActivePlan(account)) {
    return { ok: false, code: 'no_plan', message: NO_PLAN_MESSAGE };
  }

  // Plan cap: Solo covers 5 clients a month, 10 invoices each. The cap sorts
  // owners by how many clients they have, not how often they bill.
  if (account.plan === 'solo') {
    const message = soloLimitMessage(await clientEmailsThisMonth(account.id), input.clientEmail);
    if (message) return { ok: false, code: 'plan_limit', message };
  }

  try {
    // 1. Customer — reuse if we already know them, else create in Stripe and mirror.
    let client = await prisma.client.findFirst({
      where: { accountId: account.id, email: input.clientEmail },
    });
    let stripeCustomerId = client?.stripeCustomerId;

    // Same email = same client, but the name the owner just typed wins (it's
    // what goes on this invoice). Keep Dunn and the Stripe customer in step.
    const typedName = input.clientName?.trim();
    if (client && stripeCustomerId && typedName && typedName !== client.name) {
      client = await prisma.client.update({ where: { id: client.id }, data: { name: typedName } });
      await stripe.customers.update(stripeCustomerId, { name: typedName }, { stripeAccount: account.stripeAccountId });
    }

    if (!stripeCustomerId) {
      const customer = await stripe.customers.create(
        {
          email: input.clientEmail,
          name: input.clientName || undefined,
        },
        { stripeAccount: account.stripeAccountId }
      );
      stripeCustomerId = customer.id;
      client = await prisma.client.upsert({
        where: { stripeCustomerId },
        update: { name: input.clientName, email: input.clientEmail },
        create: {
          accountId: account.id,
          stripeCustomerId,
          name: input.clientName,
          email: input.clientEmail,
        },
      });
    }

    // 2. The Stripe invoice — draft first, then line item, then finalize.
    const dueSec = stripeDueTimestamp(input.dueDate);
    const fee = input.fee;
    const feeDescription =
      fee && fee.kind !== 'none'
        ? `Late fee: ${feeLabel(fee)} applies ${feeWhen(fee.graceDays ?? 0)}.`
        : undefined;

    // Card, plus bank transfer (ACH) when the owner allows it (Settings, on
    // by default). If their Stripe can't take bank payments yet, Stripe
    // refuses: send the invoice card-only and tell the owner once.
    const settings = await prisma.settings.findUnique({ where: { accountId: account.id } });
    const wantBank = settings?.allowBankPayments ?? true;
    const createDraft = (bank: boolean) =>
      stripe.invoices.create(
        {
          customer: stripeCustomerId!,
          collection_method: 'send_invoice',
          auto_advance: false,
          due_date: dueSec,
          description: feeDescription,
          payment_settings: { payment_method_types: bank ? ['card', 'us_bank_account'] : ['card'] },
          ...(input.poNumber ? { custom_fields: [{ name: 'PO number', value: input.poNumber }] } : {}),
          metadata: { watchtower: 'true' },
        },
        { stripeAccount: account.stripeAccountId }
      );
    let stripeInvoice: Stripe.Invoice;
    try {
      stripeInvoice = await createDraft(wantBank);
    } catch (err) {
      if (!wantBank) throw err;
      stripeInvoice = await createDraft(false);
      console.warn('[invoice] bank payments refused by Stripe; sent card-only', (err as Error).message);
      await reportProblem({
        kind: 'Bank payments not available',
        key: `no_bank:${account.id}`,
        accountId: account.id,
        detail: (err as Error).message,
        owner: {
          subject: 'Turn on bank payments in Stripe',
          text: `Dunn tried to let your client pay by bank transfer, but your Stripe account isn't set up for bank payments yet, so the invoice offers card only.\n\nTo turn it on: Stripe → Settings → Payment methods → ACH Direct Debit (https://dashboard.stripe.com/settings/payment_methods). Or, if you'd rather take cards only, switch off "Let clients pay by bank transfer" in Dunn → Settings.`,
        },
      });
    }

    const items = input.lines?.length
      ? input.lines.map((l) => stripeItemFor(l, usd))
      : [{ amount: input.amountCents, description: input.clientName ? `Invoice for ${input.clientName}` : 'Invoice' }];
    for (const item of items) {
      await stripe.invoiceItems.create(
        { customer: stripeCustomerId, invoice: stripeInvoice.id, currency: input.currency ?? 'usd', ...item },
        { stripeAccount: account.stripeAccountId }
      );
    }

    const finalizedInvoice = await stripe.invoices.finalizeInvoice(stripeInvoice.id, undefined, {
      stripeAccount: account.stripeAccountId,
    });
    // The human `number` (e.g. HUDSON-0007) and the hosted payment URL are only
    // assigned once the invoice is finalized, so read them off the finalized result.
    // Stripe does NOT email it: Dunn sends the invoice itself (step 4).

    // 3. Mirror into our DB: invoice + fee policy + audit trail.
    const invoice = await prisma.invoice.upsert({
      where: { stripeInvoiceId: stripeInvoice.id },
      update: {
        amount: input.amountCents,
        dueDate: input.dueDate,
        status: 'open',
        stripeNumber: finalizedInvoice.number ?? undefined,
        hostedInvoiceUrl: finalizedInvoice.hosted_invoice_url ?? undefined,
      },
      create: {
        accountId: account.id,
        clientId: client!.id,
        stripeInvoiceId: stripeInvoice.id,
        stripeNumber: finalizedInvoice.number ?? null,
        hostedInvoiceUrl: finalizedInvoice.hosted_invoice_url ?? null,
        amount: input.amountCents,
        currency: input.currency ?? 'usd',
        dueDate: input.dueDate,
        status: 'open',
        poNumber: input.poNumber || null,
        lines: input.lines?.length ? (input.lines as unknown as Prisma.InputJsonValue) : undefined,
      },
    });

    if (fee && fee.kind !== 'none') {
      const feePolicy = await prisma.feePolicy.create({
        data: {
          accountId: account.id,
          kind: fee.kind,
          amount: fee.amount ?? 0,
          graceDays: fee.graceDays ?? 0,
        },
      });
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { feePolicyId: feePolicy.id },
      });
    }

    const detail = `${usd(input.amountCents)} due ${input.dueDate
      .toISOString()
      .slice(0, 10)}${
      fee && fee.kind !== 'none'
        ? ` + late fee ${feeLabel(fee)} ${feeWhen(fee.graceDays ?? 0)}`
        : ''
    }`;
    await prisma.auditEvent.create({
      data: { invoiceId: invoice.id, event: 'invoice_created', detail },
    });

    // 4. Dunn sends the invoice (template 00): the client's first email comes
    //    from the business via Dunn, states the fee terms, and replies route
    //    back to Dunn. Stripe sends its own email only if Dunn couldn't — the
    //    client always gets the invoice exactly once. Never fails creation.
    let emailed = false;
    try {
      const full = await prisma.invoice.findUniqueOrThrow({
        where: { id: invoice.id },
        include: { client: true, account: true, feePolicy: true },
      });
      emailed = await sendClientEmail(full, 'new_invoice', {
        invoicePdfUrl: finalizedInvoice.invoice_pdf ?? null,
        isRecurring: !!input.recurring,
        frequencyLabel: input.recurring?.frequencyLabel ?? null,
      });
    } catch (err) {
      console.error('[invoice] Dunn invoice email failed', (err as Error).message);
    }
    if (!emailed) {
      try {
        await stripe.invoices.sendInvoice(stripeInvoice.id, undefined, {
          stripeAccount: account.stripeAccountId,
        });
      } catch (err) {
        console.warn('[invoice] Stripe fallback send failed (non-fatal)', (err as Error).message);
      }
    }

    return {
      ok: true,
      invoice: {
        id: invoice.id,
        stripeInvoiceId: stripeInvoice.id,
        clientName: input.clientName,
        clientEmail: input.clientEmail,
        amount: `${usd(input.amountCents)}`,
        dueDate: input.dueDate.toISOString().slice(0, 10),
        fee: fee && fee.kind !== 'none' ? feeLabel(fee) : null,
        hostedInvoiceUrl: finalizedInvoice.hosted_invoice_url ?? null,
        stripeNumber: finalizedInvoice.number ?? null,
      },
    };
  } catch (err) {
    console.error('[invoice] create failed', err);
    return { ok: false, code: 'stripe_error', message: (err as Error).message };
  }
}

function feeLabel(p: { kind: string; amount?: number; graceDays?: number }): string {
  const amount = p.amount ?? 0;
  if (p.kind === 'percent') return `${amount}%`;
  if (amount === 0) return 'no late fee';
  return `${usdDollars(amount)}`;
}

// The client emails that use a $39-plan slot this month.
export async function clientEmailsThisMonth(accountId: string): Promise<(string | null | undefined)[]> {
  const invs = await prisma.invoice.findMany({
    where: { accountId, createdAt: { gte: monthStart(new Date()) } },
    select: {
      status: true,
      createdAt: true,
      client: { select: { email: true } },
      auditLog: {
        where: { event: { in: ['invoice_cancelled', 'invoice_voided', 'invoice_deleted'] } },
        orderBy: { createdAt: 'asc' },
        take: 1,
        select: { createdAt: true },
      },
    },
  });
  return invs
    .filter((i) => countsTowardLimit({ status: i.status, createdAt: i.createdAt, cancelledAt: i.auditLog[0]?.createdAt ?? null }))
    .map((i) => i.client?.email);
}

// One-time repair at start-up (safe to repeat): due dates saved from Stripe
// between 10/3 and this fix landed a day late. Every stored due date should be
// midnight UTC; anything else is re-read the same way.
export async function repairDueDates(): Promise<number> {
  const rows = await prisma.invoice.findMany({ select: { id: true, dueDate: true } });
  let fixed = 0;
  for (const r of rows) {
    const t = r.dueDate;
    if (t.getUTCHours() === 0 && t.getUTCMinutes() === 0 && t.getUTCSeconds() === 0) continue;
    const dueDate = dueDateFromStripe(Math.floor(t.getTime() / 1000));
    await prisma.invoice.update({ where: { id: r.id }, data: { dueDate } });
    fixed++;
  }
  if (fixed) console.log(`[startup] repaired ${fixed} due date(s) to their calendar date`);
  return fixed;
}
