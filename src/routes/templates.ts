import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { stripeConfigured } from '../services/invoiceCreator';
import { computeInitialNextRun, skipToNextCycle } from '../services/templateEngine';

const prisma = new PrismaClient();
export const templatesRouter = Router();

// GET /templates — list all templates for the connected account.
templatesRouter.get('/', async (_req, res) => {
  if (!stripeConfigured()) {
    return res.status(503).json({ error: 'Stripe not configured' });
  }

  const account = await prisma.account.findFirst();
  if (!account) {
    return res.status(503).json({ error: 'No Stripe account connected' });
  }

  const templates = await prisma.invoiceTemplate.findMany({
    where: { accountId: account.id },
    orderBy: { nextRunDate: 'asc' },
  });

  res.json({ templates });
});

// POST /templates — create a new recurring template.
templatesRouter.post('/', async (req, res) => {
  if (!stripeConfigured()) {
    return res.status(503).json({ error: 'Stripe not configured' });
  }

  const account = await prisma.account.findFirst();
  if (!account) {
    return res.status(503).json({ error: 'No Stripe account connected' });
  }

  const {
    clientName,
    clientEmail,
    amount, // dollars, e.g. 2500
    currency,
    dueDays,
    feeKind,
    feeAmount,
    graceDays,
    frequency,
    customDay,
    startDate, // ISO date string or null (defaults to today)
  } = req.body;

  if (!clientName || !clientEmail || amount == null) {
    return res.status(400).json({ error: 'clientName, clientEmail, and amount are required' });
  }

  const amountCents = Math.round(Number(amount) * 100);
  if (amountCents <= 0) {
    return res.status(400).json({ error: 'amount must be > 0' });
  }

  const validFrequencies = ['monthly', 'weekly', 'biweekly', 'custom'];
  const freq = (frequency ?? 'monthly') as string;
  if (!validFrequencies.includes(freq)) {
    return res.status(400).json({ error: `frequency must be one of: ${validFrequencies.join(', ')}` });
  }

  if (freq === 'custom' && (customDay == null || customDay < 1 || customDay > 28)) {
    return res.status(400).json({ error: 'customDay is required (1-28) for custom frequency' });
  }

  const today = new Date();
  const start = startDate ? new Date(startDate) : today;
  const nextRun = computeInitialNextRun(start, freq, customDay ? Number(customDay) : undefined);

  const template = await prisma.invoiceTemplate.create({
    data: {
      accountId: account.id,
      clientName,
      clientEmail,
      amount: amountCents,
      currency: currency ?? 'usd',
      dueDays: dueDays != null ? Number(dueDays) : 30,
      feeKind: feeKind ?? 'none',
      feeAmount: feeAmount != null ? Number(feeAmount) : 0,
      graceDays: graceDays != null ? Number(graceDays) : 7,
      frequency: freq,
      customDay: freq === 'custom' ? Number(customDay) : null,
      nextRunDate: nextRun,
    },
  });

  res.status(201).json({ template });
});

// PATCH /templates/:id — update a template (pause, edit, etc.).
templatesRouter.patch('/:id', async (req, res) => {
  const { id } = req.params;

  const existing = await prisma.invoiceTemplate.findUnique({ where: { id } });
  if (!existing) {
    return res.status(404).json({ error: 'Template not found' });
  }

  const updates: Record<string, unknown> = {};
  const fields = ['clientName', 'clientEmail', 'amount', 'currency', 'dueDays',
    'feeKind', 'feeAmount', 'graceDays', 'frequency', 'customDay', 'active', 'nextRunDate'] as const;

  for (const field of fields) {
    if (req.body[field] !== undefined) {
      if (field === 'amount') {
        updates.amount = Math.round(Number(req.body.amount) * 100);
      } else {
        updates[field] = req.body[field];
      }
    }
  }

  // If resuming a paused template whose nextRunDate has passed, skip to next cycle.
  if (req.body.active === true && !existing.active) {
    const nextRun = skipToNextCycle(
      updates.nextRunDate as Date ?? existing.nextRunDate,
      String(updates.frequency ?? existing.frequency),
      (updates.customDay as number | undefined) ?? existing.customDay ?? undefined
    );
    updates.nextRunDate = nextRun;
  }

  const template = await prisma.invoiceTemplate.update({
    where: { id },
    data: updates,
  });

  res.json({ template });
});

// DELETE /templates/:id — delete a template (doesn't affect past invoices).
templatesRouter.delete('/:id', async (req, res) => {
  const { id } = req.params;

  const existing = await prisma.invoiceTemplate.findUnique({ where: { id } });
  if (!existing) {
    return res.status(404).json({ error: 'Template not found' });
  }

  await prisma.invoiceTemplate.delete({ where: { id } });
  res.json({ deleted: true });
});