import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { getAccount } from '../lib/account';
import type { InvoiceLine } from '../services/invoiceLines';

const prisma = new PrismaClient();
export const servicesRouter = Router();

// GET /services — every saved service, most recently used first. The form
// filters this list itself (search, no cap on how many show).
servicesRouter.get('/', async (req, res) => {
  const account = await getAccount(req);
  if (!account) return res.status(401).json({ error: 'Not authenticated' });
  const services = await prisma.service.findMany({
    where: { accountId: account.id },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, name: true, unitCents: true },
  });
  res.json({ services });
});

// DELETE /services/:id — remove one from the list (invoices keep their lines).
servicesRouter.delete('/:id', async (req, res) => {
  const account = await getAccount(req);
  if (!account) return res.status(401).json({ error: 'Not authenticated' });
  const { count } = await prisma.service.deleteMany({ where: { id: req.params.id, accountId: account.id } });
  if (!count) return res.status(404).json({ error: 'Service not found' });
  res.json({ ok: true });
});

// After an invoice is created: save each line as a service, or update its
// price and bump it to the top if it's already saved.
export async function saveServices(accountId: string, lines: InvoiceLine[]): Promise<void> {
  for (const l of lines) {
    await prisma.service.upsert({
      where: { accountId_name: { accountId, name: l.description } },
      update: { unitCents: l.unitCents },
      create: { accountId, name: l.description, unitCents: l.unitCents },
    });
  }
}
