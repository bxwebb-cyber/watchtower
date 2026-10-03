import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import Stripe from 'stripe';
import { createInvoice, stripeConfigured, dueTimestamp } from '../services/invoiceCreator';
import { approveFee, changeBilledFee, waiveFee, FeeActionError } from '../services/feeEngine';
import { agreedFeeCents, parseGraceDays, GRACE_REQUIRED } from '../services/feeRules';
import { getAccount } from '../lib/account';
import { buildTimeline } from '../services/invoiceTimeline';
import { usd, usdDollars } from '../lib/money';
import { sendClientEmail } from '../services/reminderEngine';

const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export const invoicesRouter = Router();

// The form checks this on load so it can say plainly what's missing
// (Stripe key vs. connected account) instead of failing mysteriously.
invoicesRouter.get('/status', async (req, res) => {
  const account = await getAccount(req);
  res.json({
    stripeConfigured: stripeConfigured(),
    accountConnected: !!account,
    businessName: account?.businessName ?? null,
    connectUrl: '/auth/stripe/start',
  });
});

// The invoice CREATOR — the form posts here, we create the Stripe invoice
// under the connected account, mirror it, and start watching.
invoicesRouter.post('/', async (req, res) => {
  const body = req.body ?? {};

  const account = await getAccount(req);
  if (!account) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const clientName = String(body.clientName ?? '').trim();
  const clientEmail = String(body.clientEmail ?? '').trim().toLowerCase();
  const amountDollars = Number(body.amount);
  const dueDateStr = String(body.dueDate ?? '');

  if (!clientName) {
    return res.status(400).json({ error: 'Client name is required.' });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clientEmail)) {
    return res.status(400).json({ error: 'A valid client email is required.' });
  }
  if (!Number.isFinite(amountDollars) || amountDollars <= 0) {
    return res.status(400).json({ error: 'Amount must be a positive number.' });
  }
  const dueDate = new Date(`${dueDateStr}T00:00:00`);
  if (Number.isNaN(dueDate.getTime())) {
    return res.status(400).json({ error: 'A due date is required.' });
  }
  if (dueTimestamp(dueDate) * 1000 < Date.now()) {
    return res.status(400).json({ error: "The due date can't be in the past." });
  }

  // The fee prompt — the heart of the product. Per invoice, per client.
  const kindRaw = String(body.fee?.kind ?? 'none');
  const kind: 'flat' | 'percent' | 'none' =
    kindRaw === 'flat' || kindRaw === 'percent' ? kindRaw : 'none';
  let feeAmount: number | undefined;
  if (kind === 'flat') {
    feeAmount = Number(body.fee?.amount);
    if (!Number.isFinite(feeAmount) || feeAmount < 0) {
      return res.status(400).json({ error: 'Late fee amount must be $0 or more.' });
    }
  } else if (kind === 'percent') {
    feeAmount = Number(body.fee?.amount);
    if (!Number.isFinite(feeAmount) || feeAmount <= 0 || feeAmount > 100) {
      return res.status(400).json({ error: 'Percent fee must be between 0 and 100.' });
    }
  }
  // The owner chooses when the fee applies (0 = the day after the due date).
  const graceDays = parseGraceDays(body.fee?.graceDays);
  if (kind !== 'none' && graceDays === null) {
    return res.status(400).json({ error: GRACE_REQUIRED });
  }

  const result = await createInvoice({
    accountId: account.id,
    clientName,
    clientEmail,
    amountCents: Math.round(amountDollars * 100),
    dueDate,
    fee: kind === 'none' ? { kind: 'none' } : { kind, amount: feeAmount, graceDays: graceDays! },
  });

  if (!result.ok) {
    const status =
      result.code === 'not_configured' ? 503 :
      result.code === 'no_account' ? 409 :
      result.code === 'no_plan' ? 402 :
      result.code === 'plan_limit' ? 402 : 502;
    return res.status(status).json({ error: result.message, code: result.code });
  }

  res.status(201).json(result.invoice);
});

// ---- Late-fee owner actions (dashboard). Amounts arrive in dollars. ----

// POST /invoices/:id/fee/approve { amount? } — approve a pending fee, at the
// amount in the terms or lower. Replaces the bill and emails the client.
invoicesRouter.post('/:id/fee/approve', async (req, res) => {
  const account = await getAccount(req);
  if (!account) return res.status(401).json({ error: 'Not authenticated' });
  const raw = req.body?.amount;
  const amountCents = raw === undefined || raw === null || raw === '' ? undefined : Math.round(Number(raw) * 100);
  await feeAction(res, () => approveFee(req.params.id, account.id, amountCents));
});

// POST /invoices/:id/fee/change { amount } — lower a fee that's already on
// the bill. Reissues the bill and emails the client the new amount.
invoicesRouter.post('/:id/fee/change', async (req, res) => {
  const account = await getAccount(req);
  if (!account) return res.status(401).json({ error: 'Not authenticated' });
  const amountCents = Math.round(Number(req.body?.amount) * 100);
  await feeAction(res, () => changeBilledFee(req.params.id, account.id, amountCents));
});

// POST /invoices/:id/waive { note? } — waive a pending fee, or one already on
// the bill (the bill is reissued without it and the client is emailed).
invoicesRouter.post('/:id/waive', async (req, res) => {
  const account = await getAccount(req);
  if (!account) return res.status(401).json({ error: 'Not authenticated' });
  const note = String(req.body?.note ?? '').trim() || null;
  await feeAction(res, () => waiveFee(req.params.id, account.id, note));
});

async function feeAction(res: Response, action: () => Promise<object>) {
  try {
    res.json({ ok: true, ...(await action()) });
  } catch (err) {
    if (err instanceof FeeActionError) return res.status(err.status).json({ error: err.message });
    console.error('[fee] owner action failed', err);
    res.status(502).json({ error: 'Stripe or the email service had a problem — nothing was changed. Try again in a minute.' });
  }
}

// POST /invoices/:id/cancel { tellClient? } — the owner cancels an unpaid
// invoice: it's voided in their Stripe (the pay link stops working), Dunn
// stops every reminder and fee, and, unless told not to, the client gets a
// "you don't need to pay this" email. Paid invoices can't be cancelled here
// (that's a refund, done in Stripe).
invoicesRouter.post('/:id/cancel', async (req, res) => {
  const account = await getAccount(req);
  if (!account) return res.status(401).json({ error: 'Not authenticated' });
  const invoice = await prisma.invoice.findFirst({
    where: { id: String(req.params.id), accountId: account.id },
    include: { client: true, account: true, feePolicy: true },
  });
  if (!invoice) return res.status(404).json({ error: 'Invoice not found.' });
  if (invoice.status !== 'open') {
    return res.status(400).json({ error: invoice.status === 'paid' ? 'This invoice is paid. To give money back, refund it in Stripe.' : 'This invoice is already cancelled.' });
  }

  const opts = { stripeAccount: account.stripeAccountId };
  try {
    const si = await stripe.invoices.retrieve(invoice.stripeInvoiceId, {}, opts);
    if (si.status === 'paid') {
      return res.status(409).json({ error: 'The client just paid this invoice, so it can’t be cancelled. To give money back, refund it in Stripe.' });
    }
    if (si.status === 'draft') await stripe.invoices.del(si.id, {}, opts);
    else if (si.status === 'open') await stripe.invoices.voidInvoice(si.id, {}, opts);
    // A late fee billed under the old two-invoice model is a separate bill.
    if (invoice.feeInvoiceId && invoice.feeInvoiceId !== invoice.stripeInvoiceId) {
      await stripe.invoices.voidInvoice(invoice.feeInvoiceId, {}, opts).catch(() => {});
    }
  } catch (err) {
    console.error('[invoices] cancel failed in Stripe', invoice.id, err);
    return res.status(502).json({ error: 'Stripe had a problem, so nothing was cancelled. Try again in a minute.' });
  }

  await prisma.invoice.updateMany({
    where: { id: invoice.id, status: { in: ['open', 'void'] } },
    data: { status: 'void', ...(invoice.feeStatus === 'pending' ? { feeStatus: null } : {}) },
  });
  await prisma.auditEvent.create({
    data: { invoiceId: invoice.id, event: 'invoice_cancelled', detail: 'cancelled by the owner; reminders stopped' },
  });

  let clientEmailed = false;
  if (req.body?.tellClient !== false && invoice.client?.email) {
    try { clientEmailed = await sendClientEmail(invoice, 'cancelled'); }
    catch (err) { console.error('[invoices] cancel email failed', invoice.id, err); }
  }
  res.json({ ok: true, clientEmailed });
});

// POST /invoices/:id/escalate — owner responds to an escalation.
// action = 'send' → trigger the T+14 final notice email to the client
// action = 'call' → mark as owner-handled, stop auto-reminders
invoicesRouter.post('/:id/escalate', async (req, res) => {
  const account = await getAccount(req);
  if (!account) return res.status(401).json({ error: 'Not authenticated' });
  const { id } = req.params;
  const action = String(req.body.action ?? '').trim();
  if (action !== 'send' && action !== 'call') {
    return res.status(400).json({ error: 'Action must be "send" or "call".' });
  }

  const invoice = await prisma.invoice.findFirst({
    where: { id, accountId: account.id },
    include: { client: true, account: true },
  });
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

  if (action === 'send') {
    // Queue a manual final-notice send — mark the invoice so the next
    // reminder run sends the T+14 email immediately.
    await prisma.invoice.update({
      where: { id },
      data: { escalateAction: 'send_reminder' },
    });
    await prisma.auditEvent.create({
      data: {
        invoiceId: id,
        event: 'escalation_send_reminder',
        detail: `Owner chose: send final notice to ${invoice.client?.name ?? 'client'}`,
      },
    });
    res.json({ action: 'send_reminder', message: 'Final notice will be sent on the next reminder run.' });
  } else {
    // Owner will call — stop auto-reminders for this invoice.
    await prisma.invoice.update({
      where: { id },
      data: { escalateAction: 'owner_calling', repliedAt: invoice.repliedAt ?? new Date() },
    });
    await prisma.auditEvent.create({
      data: {
        invoiceId: id,
        event: 'escalation_owner_calling',
        detail: `Owner chose: will call ${invoice.client?.name ?? 'client'} personally`,
      },
    });
    res.json({ action: 'owner_calling', message: 'Auto-reminders paused. You\'re handling it.' });
  }
});

// GET /invoices/escalations — list invoices needing owner decision.
invoicesRouter.get('/escalations', async (req, res) => {
  const account = await getAccount(req);
  if (!account) return res.status(401).json({ error: 'Not authenticated' });

  const invoices = await prisma.invoice.findMany({
    where: {
      accountId: account.id,
      status: 'open',
      escalateAction: null,
      feeApplied: false,
      repliedAt: null,
    },
    include: { client: true, feePolicy: true },
    orderBy: { dueDate: 'asc' },
  });

  const now = new Date();
  const escalations = invoices
    .filter((inv) => {
      const daysLate = Math.round((now.getTime() - inv.dueDate.getTime()) / 86_400_000);
      return daysLate >= 14;
    })
    .map((inv) => {
      const daysLate = Math.round((now.getTime() - inv.dueDate.getTime()) / 86_400_000);
      return {
        id: inv.id,
        clientName: inv.client?.name ?? 'Unknown',
        amount: `${usd(inv.amount)}`,
        daysLate,
        hasFee: inv.feePolicy != null && inv.feePolicy.kind !== 'none',
      };
    });

  res.json({ escalations });
});

// The form calls this on email blur: returns the client's last-used fee terms
// so the fee prompt is pre-filled and the owner never retypes the same fee
// for the same client month after month. (The "take the headache away" feature.)
invoicesRouter.get('/fee-default', async (req, res) => {
  const email = String(req.query.email ?? '').trim().toLowerCase();
  if (!email) return res.json({ found: false });

  const account = await getAccount(req);
  if (!account) return res.json({ found: false });

  const client = await prisma.client.findFirst({
    where: { accountId: account.id, email },
  });
  if (!client) return res.json({ found: false });

  // Most recent invoice for this client that carries a fee policy.
  const latest = await prisma.invoice.findFirst({
    where: { clientId: client.id, feePolicy: { isNot: null } },
    include: { feePolicy: true },
    orderBy: { createdAt: 'desc' },
  });
  if (!latest?.feePolicy) return res.json({ found: false });

  res.json({
    found: true,
    kind: latest.feePolicy.kind,
    amount: latest.feePolicy.amount,
    graceDays: latest.feePolicy.graceDays,
  });
});

// The dashboard's core view: every invoice, its status, what the agent has
// done, and per-client lateness history. The "who's always late" screen.
invoicesRouter.get('/', async (req, res) => {
  const account = await getAccount(req);
  if (!account) return res.status(401).json({ error: 'Not authenticated' });

  const invoices = await prisma.invoice.findMany({
    where: { accountId: account.id },
    include: {
      client: true,
      reminders: { orderBy: { sentAt: 'asc' } },
      feePolicy: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  // Per-client lateness: how often + how late each client pays.
  const clientLateness = new Map<string, { total: number; lateCount: number; avgDaysLate: number }>();
  for (const inv of invoices) {
    if (!inv.client) continue;
    const entry = clientLateness.get(inv.client.id) ?? { total: 0, lateCount: 0, avgDaysLate: 0 };
    entry.total++;
    if (inv.paidAt && inv.dueDate && inv.paidAt > inv.dueDate) {
      entry.lateCount++;
      const daysLate = Math.round((inv.paidAt.getTime() - inv.dueDate.getTime()) / 86_400_000);
      entry.avgDaysLate = (entry.avgDaysLate * (entry.lateCount - 1) + daysLate) / entry.lateCount;
    }
    clientLateness.set(inv.client.id, entry);
  }

  res.json({
    invoices: invoices.map((inv) => ({
      id: inv.id,
      stripeInvoiceId: inv.stripeInvoiceId,
      stripeNumber: inv.stripeNumber ?? null,
      // Stripe's page for this invoice — what the client sees, with the PDF.
      hostedInvoiceUrl: inv.hostedInvoiceUrl ?? null,
      client: inv.client?.name,
      clientEmail: inv.client?.email ?? null,
      amount: `${usd(inv.amount)}`,
      amountCents: inv.amount,
      due: inv.dueDate.toISOString().slice(0, 10),
      status: inv.status,
      fee: inv.feePolicy ? feeLabel(inv.feePolicy) : null,
      feeKind: inv.feePolicy?.kind ?? 'none',
      graceDays: inv.feePolicy?.graceDays ?? null,
      feeApplied: inv.feeApplied,
      feeStatus: inv.feeStatus ?? null,
      feeAmountCents: inv.feeAmountCents ?? null,
      // The fee in the invoice terms — the most the owner can set it to.
      feeTermsCents: inv.feePolicy ? agreedFeeCents(inv.amount, inv.feePolicy) : 0,
      paidAt: inv.paidAt ? inv.paidAt.toISOString() : null,
      reminders: inv.reminders.map((r) => ({ step: r.step, sentAt: r.sentAt })),
    })),
    clientLateness: Object.fromEntries(clientLateness),
  });
});

// GET /invoices/:id — one invoice for the owner's invoice view in the
// dashboard: the facts, a PDF link, and its story (emails, replies, fee).
invoicesRouter.get('/:id', async (req, res) => {
  const account = await getAccount(req);
  if (!account) return res.status(401).json({ error: 'Not authenticated' });

  const inv = await prisma.invoice.findFirst({
    where: { accountId: account.id, id: String(req.params.id) },
    include: {
      client: true,
      feePolicy: true,
      reminders: { orderBy: { sentAt: 'asc' } },
      replies: { orderBy: { createdAt: 'asc' } },
      auditLog: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!inv) return res.status(404).json({ error: 'Invoice not found.' });

  // The PDF lives in the owner's Stripe; a missing one never blocks the view.
  let pdfUrl: string | null = null;
  try {
    const si = await stripe.invoices.retrieve(inv.stripeInvoiceId, {}, { stripeAccount: account.stripeAccountId });
    pdfUrl = si.invoice_pdf ?? null;
  } catch { /* shown without the PDF button */ }

  res.json({
    id: inv.id,
    number: inv.stripeNumber ?? null,
    client: inv.client?.name ?? null,
    clientEmail: inv.client?.email ?? null,
    amountCents: inv.amount,
    due: inv.dueDate.toISOString().slice(0, 10),
    createdAt: inv.createdAt.toISOString(),
    status: inv.status,
    paidAt: inv.paidAt ? inv.paidAt.toISOString() : null,
    fee: inv.feePolicy && inv.feePolicy.kind !== 'none' ? feeLabel(inv.feePolicy) : null,
    graceDays: inv.feePolicy?.graceDays ?? null,
    feeStatus: inv.feeStatus ?? null,
    feeAmountCents: inv.feeAmountCents ?? null,
    hostedInvoiceUrl: inv.hostedInvoiceUrl ?? null,
    pdfUrl,
    timeline: buildTimeline({ events: inv.auditLog, reminders: inv.reminders, replies: inv.replies }),
  });
});

function feeLabel(p: { kind: string; amount: number }): string {
  return p.kind === 'percent' ? `${p.amount}%` : `${usdDollars(p.amount)}`;
}
