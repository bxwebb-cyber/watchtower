import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { stripeConfigured } from '../services/invoiceCreator';
import { computeInitialNextRun, skipToNextCycle } from '../services/templateEngine';
import { getAccount } from '../lib/account';
import { parseGraceDays, GRACE_REQUIRED } from '../services/feeRules';
import { parseLines, linesTotalCents } from '../services/invoiceLines';
import { saveServices } from './services';

const prisma = new PrismaClient();
export const templatesRouter = Router();

// GET /templates — list all templates for the connected account.
templatesRouter.get('/', async (req, res) => {
  if (!stripeConfigured()) {
    return res.status(503).json({ error: 'Stripe not configured' });
  }

  const account = await getAccount(req);
  if (!account) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const templates = await prisma.invoiceTemplate.findMany({
    where: { accountId: account.id },
    orderBy: { nextRunDate: 'asc' },
  });

  res.json({ templates });
});

// GET /templates/:id — one recurring invoice plus the invoices it sent
// (newest first). Invoices from before templateId existed are found through
// lastInvoiceId, so the latest one always shows.
templatesRouter.get('/:id', async (req, res) => {
  const account = await getAccount(req);
  if (!account) return res.status(401).json({ error: 'Not authenticated' });
  const template = await prisma.invoiceTemplate.findFirst({ where: { id: req.params.id, accountId: account.id } });
  if (!template) return res.status(404).json({ error: 'Template not found' });
  const invoices = await prisma.invoice.findMany({
    where: {
      accountId: account.id,
      OR: [{ templateId: template.id }, ...(template.lastInvoiceId ? [{ id: template.lastInvoiceId }] : [])],
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, stripeNumber: true, amount: true, dueDate: true, status: true, createdAt: true, feeApplied: true },
  });
  res.json({
    template,
    invoices: invoices.map((i) => ({ ...i, due: i.dueDate.toISOString().slice(0, 10) })),
  });
});

// POST /templates — create a new recurring template.
templatesRouter.post('/', async (req, res) => {
  if (!stripeConfigured()) {
    return res.status(503).json({ error: 'Stripe not configured' });
  }

  const account = await getAccount(req);
  if (!account) {
    return res.status(401).json({ error: 'Not authenticated' });
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

  if (!clientName || !clientEmail || (amount == null && req.body.lines === undefined)) {
    return res.status(400).json({ error: 'clientName, clientEmail, and lines (or amount) are required' });
  }

  // Line items (the form), or one amount.
  let lines;
  if (req.body.lines !== undefined) {
    const parsed = parseLines(req.body.lines, `Invoice for ${clientName}`);
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });
    lines = parsed.lines;
  }
  const amountCents = lines ? linesTotalCents(lines) : Math.round(Number(amount) * 100);
  if (!(amountCents > 0)) {
    return res.status(400).json({ error: 'amount must be > 0' });
  }
  const poNumber = String(req.body.poNumber ?? '').trim().slice(0, 140) || null;

  // The owner chooses when the fee applies (0 = the day after the due date).
  const grace = parseGraceDays(graceDays);
  if ((feeKind ?? 'none') !== 'none' && grace === null) {
    return res.status(400).json({ error: GRACE_REQUIRED });
  }

  const validFrequencies = ['monthly', 'weekly', 'biweekly', 'custom'];
  const freq = (frequency ?? 'monthly') as string;
  if (!validFrequencies.includes(freq)) {
    return res.status(400).json({ error: `frequency must be one of: ${validFrequencies.join(', ')}` });
  }

  if (freq === 'custom' && (customDay == null || customDay < 1 || customDay > 31)) {
    return res.status(400).json({ error: 'customDay is required (1-31; 31 = last day of the month) for custom frequency' });
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
      lines: lines ?? undefined,
      poNumber,
      currency: currency ?? 'usd',
      // Due date follows the schedule unless the owner picked one: a weekly
      // invoice due in 30 days would pile up four open invoices at once.
      dueDays: dueDays != null && Number.isFinite(Number(dueDays)) ? Math.min(90, Math.max(0, Math.round(Number(dueDays)))) : ({ weekly: 7, biweekly: 14 } as Record<string, number>)[String(frequency)] ?? 30,
      feeKind: feeKind ?? 'none',
      feeAmount: feeAmount != null ? Number(feeAmount) : 0,
      graceDays: grace ?? 0,
      frequency: freq,
      customDay: freq === 'custom' ? Number(customDay) : null,
      nextRunDate: nextRun,
    },
  });

  if (lines && req.body.saveServices !== false) {
    await saveServices(account.id, lines.filter((l) => l.description !== `Invoice for ${clientName}`)).catch((err) => console.error('[templates] saving services failed', err));
  }
  res.status(201).json({ template });
});

// PATCH /templates/:id — update a template (pause, edit, etc.).
templatesRouter.patch('/:id', async (req, res) => {
  const account = await getAccount(req);
  if (!account) return res.status(401).json({ error: 'Not authenticated' });
  const { id } = req.params;

  const existing = await prisma.invoiceTemplate.findFirst({
    where: { id, accountId: account.id },
  });
  if (!existing) {
    return res.status(404).json({ error: 'Template not found' });
  }

  const updates: Record<string, unknown> = {};
  const fields = ['clientName', 'clientEmail', 'amount', 'currency', 'dueDays',
    'feeKind', 'feeAmount', 'graceDays', 'frequency', 'customDay', 'active'] as const;

  for (const field of fields) {
    if (req.body[field] !== undefined) {
      if (field === 'amount' && req.body.lines !== undefined) {
        continue; // the lines set the amount below
      } else if (field === 'amount') {
        const cents = Math.round(Number(req.body.amount) * 100);
        if (!(cents > 0)) return res.status(400).json({ error: 'amount must be > 0' });
        updates.amount = cents;
      } else if (field === 'graceDays') {
        const grace = parseGraceDays(req.body.graceDays);
        if (grace === null) return res.status(400).json({ error: GRACE_REQUIRED });
        updates.graceDays = grace;
      } else if (field === 'dueDays') {
        const n = Number(req.body.dueDays);
        if (!Number.isFinite(n)) return res.status(400).json({ error: 'dueDays must be a number' });
        updates.dueDays = Math.min(90, Math.max(0, Math.round(n)));
      } else if (field === 'feeAmount') {
        updates.feeAmount = Number(req.body.feeAmount) || 0;
      } else if (field === 'active') {
        updates.active = req.body.active === true;
      } else {
        updates[field] = req.body[field];
      }
    }
  }

  if (req.body.lines !== undefined) {
    const name = String(req.body.clientName ?? existing.clientName);
    const parsed = parseLines(req.body.lines, `Invoice for ${name}`);
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });
    updates.lines = parsed.lines;
    updates.amount = linesTotalCents(parsed.lines);
    if (req.body.saveServices !== false) {
      await saveServices(account.id, parsed.lines.filter((l) => l.description !== `Invoice for ${name}`)).catch((err) => console.error('[templates] saving services failed', err));
    }
  }
  if (req.body.poNumber !== undefined) updates.poNumber = String(req.body.poNumber ?? '').trim().slice(0, 140) || null;

  const freq = String(updates.frequency ?? existing.frequency);
  if (!['monthly', 'weekly', 'biweekly', 'custom'].includes(freq)) {
    return res.status(400).json({ error: 'frequency must be one of: monthly, weekly, biweekly, custom' });
  }
  if (updates.feeKind !== undefined && !['none', 'flat', 'percent'].includes(String(updates.feeKind))) {
    return res.status(400).json({ error: 'feeKind must be none, flat or percent' });
  }
  if ((updates.feeKind ?? existing.feeKind) !== 'none' && updates.graceDays === undefined && existing.graceDays == null) {
    return res.status(400).json({ error: GRACE_REQUIRED });
  }
  let customDay: number | null = existing.customDay;
  if (freq === 'custom') {
    customDay = Number(updates.customDay ?? existing.customDay);
    if (!(customDay >= 1 && customDay <= 31)) {
      return res.status(400).json({ error: 'customDay is required (1-31; 31 = last day of the month) for custom frequency' });
    }
  } else {
    customDay = null;
  }
  updates.customDay = customDay;

  // The edit form sends the "Next invoice date" as startDate. Re-place the
  // next run whenever that date or the schedule changes (a custom day snaps
  // to the next matching day on or after it).
  const scheduleChanged = freq !== existing.frequency || customDay !== existing.customDay;
  if (req.body.startDate || scheduleChanged) {
    const start = req.body.startDate ? new Date(req.body.startDate) : existing.nextRunDate;
    if (Number.isNaN(start.getTime())) return res.status(400).json({ error: 'Next invoice date is not a valid date' });
    updates.nextRunDate = computeInitialNextRun(start, freq, customDay ?? undefined);
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
  const account = await getAccount(req);
  if (!account) return res.status(401).json({ error: 'Not authenticated' });
  const { id } = req.params;

  const existing = await prisma.invoiceTemplate.findFirst({
    where: { id, accountId: account.id },
  });
  if (!existing) {
    return res.status(404).json({ error: 'Template not found' });
  }

  await prisma.invoiceTemplate.delete({ where: { id } });
  res.json({ deleted: true });
});