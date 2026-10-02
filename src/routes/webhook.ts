import { Router } from 'express';
import Stripe from 'stripe';
import { PrismaClient } from '@prisma/client';
import { notifyFounder, notifyOwner } from '../services/notify';
import { usd } from '../lib/money';
import { reportProblem } from '../services/problems';

const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export const webhookRouter = Router();

// Stripe sends the raw body; verify signature, then dispatch on event type.
webhookRouter.post('/', async (req, res) => {
  const sig = req.headers['stripe-signature'] as string;

  // Two webhook destinations feed this route — billing events ("Your account")
  // and invoice events ("Connected accounts") — and each carries its OWN signing
  // secret. Try each configured secret until one verifies.
  const secrets = [
    process.env.STRIPE_WEBHOOK_SECRET,
    process.env.STRIPE_WEBHOOK_SECRET_2,
  ].filter((s): s is string => !!s);

  let event: Stripe.Event | null = null;
  for (const secret of secrets) {
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, secret);
      break;
    } catch {
      // try the next secret
    }
  }

  if (!event) {
    console.error('[webhook] signature verification failed for all configured secrets');
    return res.status(400).send('Webhook Error: signature verification failed');
  }
  console.log(`[webhook] ${event.type} verified`);

  try {
    switch (event.type) {
      case 'invoice.created':
        await onInvoiceCreated(event.data.object as Stripe.Invoice, event.account);
        break;
      case 'invoice.finalized':
        await onInvoiceFinalized(event.data.object as Stripe.Invoice);
        break;
      case 'invoice.paid':
        await onInvoicePaid(event.data.object as Stripe.Invoice);
        break;
      case 'invoice.payment_failed':
        await onInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        break;
      case 'invoice.voided':
        await onInvoiceVoided(event.data.object as Stripe.Invoice);
        break;
      case 'invoice.marked_uncollectible':
        await onInvoiceMarkedUncollectible(event.data.object as Stripe.Invoice);
        break;
      case 'invoice.deleted':
        await onInvoiceDeleted(event.data.object as Stripe.Invoice);
        break;
      case 'invoice.updated':
        await onInvoiceUpdated(event.data.object as Stripe.Invoice);
        break;
      case 'checkout.session.completed':
        await onCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case 'customer.subscription.updated':
        await onSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;
      case 'customer.subscription.deleted':
        await onSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      default:
        // other events we don't act on yet
        break;
    }
    res.json({ received: true });
  } catch (err) {
    console.error('[webhook] handler failed', err);
    await reportProblem({
      kind: 'Stripe update not processed',
      key: `webhook:${event.type}:${(err as Error).message}`,
      detail: `${event.type} (${event.id}): ${(err as Error).stack ?? (err as Error).message}`,
    });
    // Still 200 so Stripe doesn't retry forever on our bugs;
    // we log and can replay from the audit trail.
    res.json({ received: true, error: (err as Error).message });
  }
});

// ---- handlers ----

async function onInvoiceCreated(inv: Stripe.Invoice, connectedAccountId?: string) {
  if (inv.metadata?.watchtower === 'true') {
    // An invoice created BY us (e.g. the late-fee invoice) — we don't
    // re-watch our own fee invoices to avoid loops.
    return;
  }
  // Mirror an invoice an owner made directly in their Stripe, onto THAT
  // owner's Dunn account (event.account = their connected account id).
  // No connected account = Dunn's own plan billing (a subscription invoice):
  // never an owner's client invoice. No due date = nothing to chase.
  if (!connectedAccountId || !inv.due_date) return;
  const account = await prisma.account.findUnique({ where: { stripeAccountId: connectedAccountId } });
  if (!account || !inv.customer_email) return;

  const customerId = inv.customer as string;
  let client = await prisma.client.findUnique({
    where: { stripeCustomerId: customerId },
  });
  if (!client) {
    client = await prisma.client.create({
      data: {
        accountId: account.id,
        stripeCustomerId: customerId,
        name: inv.customer_name ?? 'Unknown',
        email: inv.customer_email,
      },
    });
  }

  const invoice = await prisma.invoice.upsert({
    where: { stripeInvoiceId: inv.id },
    update: { status: inv.status ?? 'open' },
    create: {
      accountId: account.id,
      clientId: client.id,
      stripeInvoiceId: inv.id,
      amount: inv.amount_due,
      currency: inv.currency,
      dueDate: new Date(inv.due_date * 1000),
      status: inv.status ?? 'open',
    },
  });

  await prisma.auditEvent.create({
    data: {
      invoiceId: invoice.id,
      event: 'invoice_created',
      detail: `${inv.amount_due / 100} ${inv.currency.toUpperCase()} due ${new Date(inv.due_date * 1000).toISOString().slice(0, 10)}`,
    },
  });
}

async function onInvoiceFinalized(inv: Stripe.Invoice) {
  // Late-fee invoices (metadata.parent_invoice) are never mirrored as their
  // own rows — the fee state lives on the parent Invoice. A fee replacement
  // (metadata.replaces_invoice) is already written by the fee engine.
  if (inv.metadata?.parent_invoice || inv.metadata?.replaces_invoice) return;
  // updateMany: for invoices Dunn creates, this event can land before the
  // creator has written the row — nothing to update yet, and that's fine.
  await prisma.invoice.updateMany({
    where: { stripeInvoiceId: inv.id },
    data: { status: inv.status ?? 'open' },
  });
}

async function onInvoicePaid(inv: Stripe.Invoice) {
  // A late-fee invoice is identified by metadata.parent_invoice. Record the
  // payment on the PARENT invoice — fee invoices are never mirrored as their
  // own rows, so a plain lookup by stripeInvoiceId would miss (and throw).
  const parentId = inv.metadata?.parent_invoice;
  if (parentId) {
    const parent = await prisma.invoice.findUnique({
      where: { stripeInvoiceId: parentId },
      include: { client: true },
    });
    if (parent) {
      await prisma.invoice.update({
        where: { id: parent.id },
        data: { feeStatus: 'paid', feePaidAt: new Date() },
      });
      await prisma.auditEvent.create({
        data: {
          invoiceId: parent.id,
          event: 'fee_paid',
          detail: `${(inv.amount_paid / 100).toFixed(2)} ${inv.currency ?? 'usd'}`,
        },
      });
      const clientName = parent.client?.name ?? 'A client';
      await notifyOwner(
        parent.accountId,
        `Late fee paid — invoice ${parent.stripeInvoiceId}`,
        `${clientName} paid the late fee (${(inv.amount_paid / 100).toFixed(2)} ${inv.currency ?? 'usd'}) on invoice ${parent.stripeInvoiceId}.`
      );
    }
    return;
  }

  // A fee replacement (metadata.replaces_invoice) is one bill for the original
  // balance + the late fee, so paying it pays the fee too — unless the bill
  // was reissued without the fee (waived: includes_fee = 'false').
  // Not one of Dunn's invoices (e.g. Dunn's own plan billing): nothing to mark.
  const existing = await prisma.invoice.findUnique({ where: { stripeInvoiceId: inv.id } });
  if (!existing) return;
  const paidAt = new Date();
  const paysFee = !!inv.metadata?.replaces_invoice && inv.metadata?.includes_fee !== 'false';
  const invoice = await prisma.invoice.update({
    where: { stripeInvoiceId: inv.id },
    data: {
      status: 'paid',
      paidAt,
      ...(paysFee ? { feeStatus: 'paid', feePaidAt: paidAt } : {}),
    },
  });
  const amount = `${usd(inv.amount_paid)}`;
  const number = invoice.stripeNumber ?? inv.id;
  await prisma.auditEvent.create({
    data: { invoiceId: invoice.id, event: 'invoice_paid', detail: `${amount} ${inv.currency}` },
  });
  await notifyOwner(
    invoice.accountId,
    `Invoice paid — ${number} (${amount})`,
    `Invoice ${number} was paid (${amount}${paysFee ? ', including the late fee' : ''}). Dunn has stopped the reminders.`
  );
  // Paid = stop all reminders. The daily job skips paid invoices.
}

async function onInvoicePaymentFailed(inv: Stripe.Invoice) {
  const invoice = await prisma.invoice.findUnique({
    where: { stripeInvoiceId: inv.id },
  });
  if (!invoice) return;
  await prisma.auditEvent.create({
    data: { invoiceId: invoice.id, event: 'payment_failed', detail: 'auto-charge failed; reminder schedule continues' },
  });
  const number = invoice.stripeNumber ?? invoice.stripeInvoiceId;
  await reportProblem({
    kind: 'Client payment failed',
    key: `payment_failed:${inv.id}`,
    accountId: invoice.accountId,
    detail: `Invoice ${number}: ${inv.last_finalization_error?.message ?? 'payment attempt failed'}`,
    owner: {
      subject: `A payment on invoice ${number} failed`,
      text: `Your client tried to pay invoice ${number}, but the payment didn't go through (for example, a declined card).\n\nThe invoice is still open and Dunn keeps the reminders going. You may want to let your client know.`,
    },
  });
}

async function onInvoiceVoided(inv: Stripe.Invoice) {
  // Fee invoices live on the parent row, not their own — skip them here.
  if (inv.metadata?.parent_invoice) return;
  const invoice = await prisma.invoice.findUnique({
    where: { stripeInvoiceId: inv.id },
  });
  if (!invoice || invoice.status === 'void') return;
  await prisma.invoice.update({ where: { id: invoice.id }, data: { status: 'void' } });
  await prisma.auditEvent.create({
    data: { invoiceId: invoice.id, event: 'invoice_voided', detail: 'voided in Stripe; reminders stopped' },
  });
}

async function onInvoiceMarkedUncollectible(inv: Stripe.Invoice) {
  if (inv.metadata?.parent_invoice) return;
  const invoice = await prisma.invoice.findUnique({
    where: { stripeInvoiceId: inv.id },
  });
  if (!invoice || invoice.status === 'uncollectible') return;
  await prisma.invoice.update({ where: { id: invoice.id }, data: { status: 'uncollectible' } });
  await prisma.auditEvent.create({
    data: { invoiceId: invoice.id, event: 'invoice_uncollectible', detail: 'marked uncollectible in Stripe; reminders stopped' },
  });
}

async function onInvoiceDeleted(inv: Stripe.Invoice) {
  if (inv.metadata?.parent_invoice) return;
  const invoice = await prisma.invoice.findUnique({
    where: { stripeInvoiceId: inv.id },
  });
  if (!invoice || invoice.status === 'deleted') return;
  await prisma.invoice.update({ where: { id: invoice.id }, data: { status: 'deleted' } });
  await prisma.auditEvent.create({
    data: { invoiceId: invoice.id, event: 'invoice_deleted', detail: 'deleted in Stripe; reminders stopped' },
  });
}

async function onInvoiceUpdated(inv: Stripe.Invoice) {
  // A fee replacement has its own Stripe due date, but the reminder clock
  // stays anchored to the ORIGINAL due date — never re-anchor from it.
  if (inv.metadata?.parent_invoice || inv.metadata?.replaces_invoice) return;
  const invoice = await prisma.invoice.findUnique({
    where: { stripeInvoiceId: inv.id },
  });
  if (!invoice) return;

  // Sync the due date — the field the owner can edit after the fact (an
  // extension granted verbally, a re-issued invoice) — so the reminder clock
  // re-anchors. We deliberately do NOT sync `status` here: status changes have
  // their own dedicated events (paid / voided / uncollectible), and `updated`
  // also fires on partial payments, where setting status without `paidAt`
  // would corrupt the lateness math.
  const dueDate = inv.due_date ? new Date(inv.due_date * 1000) : undefined;
  if (!dueDate) return;

  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { dueDate },
  });
  await prisma.auditEvent.create({
    data: { invoiceId: invoice.id, event: 'invoice_updated', detail: `due date changed to ${dueDate.toISOString().slice(0, 10)}` },
  });
}

// ---- subscription billing handlers ----

// A checkout session completed means the owner subscribed to Dunn. Resolve
// the session to its subscription + customer, then stamp the account.
async function onCheckoutCompleted(session: Stripe.Checkout.Session) {
  if (session.mode !== 'subscription') return;
  const accountId = session.client_reference_id || session.metadata?.accountId;
  if (!accountId) return;

  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account || !session.subscription) return;

  const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
  await syncSubscription(accountId, subscription);

  await notifyOwner(
    accountId,
    'Subscription active',
    'Your Dunn subscription is now active. Dunn is keeping watch.'
  );
  const price = subscription.items?.data?.[0]?.price;
  const planName = session.metadata?.plan === 'business' ? 'Unlimited clients' : 'Up to 5 clients';
  const billed = price?.recurring?.interval === 'year' ? 'yearly' : 'monthly';
  await notifyFounder(
    `New subscription: ${account.businessName ?? account.email}`,
    `${account.ownerName ?? ''} (${account.email}) subscribed.\nBusiness: ${account.businessName ?? '—'}\nPlan: ${planName}, billed ${billed} (${price?.unit_amount != null ? '$' + (price.unit_amount / 100).toFixed(2) : '?'})`
  );
}

// Subscription state changed (renewed, past-due, plan changed, etc.).
async function onSubscriptionUpdated(sub: Stripe.Subscription) {
  const accountId = sub.metadata?.accountId as string | undefined;
  if (!accountId) return;
  const before = await prisma.account.findUnique({ where: { id: accountId } });
  await syncSubscription(accountId, sub);
  // Cancelling in Stripe's portal usually means "at the end of the period":
  // the plan stays active and only `deleted` arrives later. Tell the founder
  // the moment they click cancel.
  if (before && !before.cancelAtPeriodEnd && sub.cancel_at_period_end) {
    const end = sub.items?.data?.[0]?.current_period_end;
    await notifyFounder(
      `Cancelled: ${before.businessName ?? before.email}`,
      `${before.ownerName ?? ''} (${before.email}) cancelled their Dunn plan.${end ? ` It ends ${new Date(end * 1000).toDateString()}.` : ''}`
    );
  }
}

async function onSubscriptionDeleted(sub: Stripe.Subscription) {
  const accountId = sub.metadata?.accountId as string | undefined;
  if (!accountId) return;
  const acct = await prisma.account.findUnique({ where: { id: accountId } });
  if (acct && !acct.cancelAtPeriodEnd) await notifyFounder(`Cancelled: ${acct.businessName ?? acct.email}`, `${acct.ownerName ?? ''} (${acct.email}) cancelled their Dunn plan.`);
  await prisma.account.update({
    where: { id: accountId },
    data: {
      subscriptionStatus: 'canceled',
      stripeSubscriptionId: sub.id,
      currentPeriodEnd: null,
    },
  });
}

// One source of truth for writing a subscription back to the account row.
export async function syncSubscription(accountId: string, sub: Stripe.Subscription) {
  const item = sub.items?.data?.[0];
  const price = item?.price;
  // Map Stripe price id → our plan name via the configured env vars.
  let plan: string | null = null;
  if (price?.id && [process.env.STRIPE_PRICE_SOLO, process.env.STRIPE_PRICE_SOLO_YEARLY].includes(price.id)) plan = 'solo';
  else if (price?.id && [process.env.STRIPE_PRICE_BUSINESS, process.env.STRIPE_PRICE_BUSINESS_YEARLY].includes(price.id)) plan = 'business';

  await prisma.account.update({
    where: { id: accountId },
    data: {
      stripeCustomerId: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
      stripeSubscriptionId: sub.id,
      subscriptionStatus: sub.status,
      plan,
      currentPeriodEnd: item?.current_period_end
        ? new Date(item.current_period_end * 1000)
        : null,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    },
  });
}
