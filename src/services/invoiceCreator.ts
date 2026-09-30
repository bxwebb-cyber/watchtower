import { PrismaClient } from '@prisma/client';
import Stripe from 'stripe';
import { sendClientEmail } from './reminderEngine';
import { monthStart, soloLimitMessage } from './planLimits';
import { feeWhen } from './feeRules';

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
  amountCents: number;
  currency?: string;
  dueDate: Date;
  // The fee prompt — set by the owner at creation time, per invoice.
  fee?: {
    kind: 'flat' | 'percent' | 'none';
    amount?: number; // flat: dollars; percent: 0-100
    graceDays?: number; // days after due before the fee applies — the owner's choice, 0 = the day after the due date
  };
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
  | { ok: false; code: 'not_configured' | 'no_account' | 'plan_limit' | 'stripe_error'; message: string };

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

  // Plan cap: Solo covers 5 clients a month, 10 invoices each. The cap sorts
  // owners by how many clients they have, not how often they bill.
  if (account.plan === 'solo') {
    const thisMonth = await prisma.invoice.findMany({
      where: { accountId: account.id, createdAt: { gte: monthStart(new Date()) } },
      select: { client: { select: { email: true } } },
    });
    const message = soloLimitMessage(thisMonth.map((i) => i.client?.email), input.clientEmail);
    if (message) return { ok: false, code: 'plan_limit', message };
  }

  try {
    // 1. Customer — reuse if we already know them, else create in Stripe and mirror.
    let client = await prisma.client.findFirst({
      where: { accountId: account.id, email: input.clientEmail },
    });
    let stripeCustomerId = client?.stripeCustomerId;

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
    const dueSec = Math.floor(input.dueDate.getTime() / 1000);
    const fee = input.fee;
    const feeDescription =
      fee && fee.kind !== 'none'
        ? `Late fee: ${feeLabel(fee)} applies ${feeWhen(fee.graceDays ?? 0)}.`
        : undefined;

    const stripeInvoice = await stripe.invoices.create(
      {
        customer: stripeCustomerId,
        collection_method: 'send_invoice',
        auto_advance: false,
        due_date: dueSec,
        description: feeDescription,
        metadata: { watchtower: 'true' },
      },
      { stripeAccount: account.stripeAccountId }
    );

    await stripe.invoiceItems.create(
      {
        customer: stripeCustomerId,
        invoice: stripeInvoice.id,
        amount: input.amountCents,
        currency: input.currency ?? 'usd',
        description: input.clientName ? `Invoice for ${input.clientName}` : 'Invoice',
      },
      { stripeAccount: account.stripeAccountId }
    );

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

    const detail = `$${(input.amountCents / 100).toFixed(2)} due ${input.dueDate
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
        amount: `$${(input.amountCents / 100).toFixed(2)}`,
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
  return `$${amount.toFixed(2)}`;
}
