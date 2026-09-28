import { Router } from 'express';
import Stripe from 'stripe';
import { PrismaClient } from '@prisma/client';
import { notifyOwner } from '../services/notify';

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

  try {
    switch (event.type) {
      case 'invoice.created':
        await onInvoiceCreated(event.data.object as Stripe.Invoice);
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
    // Still 200 so Stripe doesn't retry forever on our bugs;
    // we log and can replay from the audit trail.
    res.json({ received: true, error: (err as Error).message });
  }
});

// ---- handlers ----

async function onInvoiceCreated(inv: Stripe.Invoice) {
  if (inv.metadata?.watchtower === 'true') {
    // An invoice created BY us (e.g. the late-fee invoice) — we don't
    // re-watch our own fee invoices to avoid loops.
    return;
  }
  // Find the connected account + mirror the invoice into our DB.
  // Invoices created on connected accounts arrive via webhook with the
  // connected account id in `account` only when the event is fetched with
  // the account context. As a robust fallback, we match on the customer's
  // metadata — but v1 single-account assumption: look up by the first
  // connected account we know. (Multi-account routing is a later pass.)
  const account = await prisma.account.findFirst();
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
      dueDate: new Date((inv.due_date ?? Date.now()) * 1000),
      status: inv.status ?? 'open',
    },
  });

  await prisma.auditEvent.create({
    data: {
      invoiceId: invoice.id,
      event: 'invoice_created',
      detail: `${inv.amount_due / 100} ${inv.currency.toUpperCase()} due ${new Date((inv.due_date ?? Date.now()) * 1000).toISOString().slice(0, 10)}`,
    },
  });
}

async function onInvoiceFinalized(inv: Stripe.Invoice) {
  // Late-fee invoices (metadata.parent_invoice) are never mirrored as their
  // own rows — the fee state lives on the parent Invoice.
  if (inv.metadata?.parent_invoice) return;
  await prisma.invoice.update({
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

  const invoice = await prisma.invoice.update({
    where: { stripeInvoiceId: inv.id },
    data: { status: 'paid', paidAt: new Date() },
  });
  await prisma.auditEvent.create({
    data: { invoiceId: invoice.id, event: 'invoice_paid', detail: `${inv.amount_paid / 100} ${inv.currency}` },
  });
  await notifyOwner(
    invoice.accountId,
    `Invoice paid — ${inv.amount_paid / 100} ${inv.currency}`,
    `Invoice ${inv.id} was paid (${inv.amount_paid / 100} ${inv.currency}). Dunn has stopped the reminders.`
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
  if (inv.metadata?.parent_invoice) return;
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
}

// Subscription state changed (renewed, past-due, plan changed, etc.).
async function onSubscriptionUpdated(sub: Stripe.Subscription) {
  const accountId = sub.metadata?.accountId as string | undefined;
  if (!accountId) return;
  await syncSubscription(accountId, sub);
}

async function onSubscriptionDeleted(sub: Stripe.Subscription) {
  const accountId = sub.metadata?.accountId as string | undefined;
  if (!accountId) return;
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
async function syncSubscription(accountId: string, sub: Stripe.Subscription) {
  const item = sub.items?.data?.[0];
  const price = item?.price;
  // Map Stripe price id → our plan name via the configured env vars.
  let plan: string | null = null;
  if (price?.id === process.env.STRIPE_PRICE_SOLO) plan = 'solo';
  else if (price?.id === process.env.STRIPE_PRICE_BUSINESS) plan = 'business';

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
