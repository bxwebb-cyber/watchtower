import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import Stripe from 'stripe';
import { createInvoice, stripeConfigured } from '../services/invoiceCreator';

const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export const invoicesRouter = Router();

// The form checks this on load so it can say plainly what's missing
// (Stripe key vs. connected account) instead of failing mysteriously.
invoicesRouter.get('/status', async (_req, res) => {
  const account = await prisma.account.findFirst();
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
  const graceDays = Math.max(1, Math.round(Number(body.fee?.graceDays ?? 7)));

  const result = await createInvoice({
    clientName,
    clientEmail,
    amountCents: Math.round(amountDollars * 100),
    dueDate,
    fee: kind === 'none' ? { kind: 'none' } : { kind, amount: feeAmount, graceDays },
  });

  if (!result.ok) {
    const status = result.code === 'not_configured' ? 503 : result.code === 'no_account' ? 409 : 502;
    return res.status(status).json({ error: result.message, code: result.code });
  }

  res.status(201).json(result.invoice);
});

// POST /invoices/:id/waive — waive a pending fee with an optional note.
invoicesRouter.post('/:id/waive', async (req, res) => {
  const { id } = req.params;
  const invoice = await prisma.invoice.findUnique({ where: { id } });
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  if (invoice.feeStatus !== 'open' && !invoice.feeApplied) {
    return res.status(400).json({ error: 'No pending fee to waive' });
  }

  const note = String(req.body.note ?? '').trim() || null;

  await prisma.invoice.update({
    where: { id },
    data: {
      feeApplied: false,
      feeStatus: null,
      waiveNote: note,
    },
  });
  await prisma.auditEvent.create({
    data: {
      invoiceId: id,
      event: 'fee_waived',
      detail: note ? `Late fee waived by you — "${note}"` : 'Late fee waived by you',
    },
  });

  res.json({ waived: true, note });
});

// POST /invoices/:id/escalate — owner responds to an escalation.
// action = 'send' → trigger the T+14 final notice email to the client
// action = 'call' → mark as owner-handled, stop auto-reminders
invoicesRouter.post('/:id/escalate', async (req, res) => {
  const { id } = req.params;
  const action = String(req.body.action ?? '').trim();
  if (action !== 'send' && action !== 'call') {
    return res.status(400).json({ error: 'Action must be "send" or "call".' });
  }

  const invoice = await prisma.invoice.findUnique({
    where: { id },
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
invoicesRouter.get('/escalations', async (_req, res) => {
  const invoices = await prisma.invoice.findMany({
    where: {
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
        amount: `$${(inv.amount / 100).toFixed(2)}`,
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

  const account = await prisma.account.findFirst();
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
invoicesRouter.get('/', async (_req, res) => {
  const invoices = await prisma.invoice.findMany({
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
      client: inv.client?.name,
      amount: `$${(inv.amount / 100).toFixed(2)}`,
      due: inv.dueDate.toISOString().slice(0, 10),
      status: inv.status,
      fee: inv.feePolicy ? feeLabel(inv.feePolicy) : null,
      reminders: inv.reminders.map((r) => ({ step: r.step, sentAt: r.sentAt })),
    })),
    clientLateness: Object.fromEntries(clientLateness),
  });
});

function feeLabel(p: { kind: string; amount: number }): string {
  return p.kind === 'percent' ? `${p.amount}%` : `$${p.amount.toFixed(2)}`;
}
