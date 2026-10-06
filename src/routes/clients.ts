import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { getAccount } from '../lib/account';
import { daysLateAt } from '../lib/dueDate';

const prisma = new PrismaClient();
export const clientsRouter = Router();

// GET /clients — list all clients with lateness data.
clientsRouter.get('/', async (req, res) => {
  const account = await getAccount(req);
  if (!account) return res.status(401).json({ error: 'Not authenticated' });

  const clients = await prisma.client.findMany({
    where: { accountId: account.id },
    include: {
      invoices: {
        where: { status: { in: ['open', 'paid'] } },
        select: {
          id: true,
          amount: true,
          dueDate: true,
          paidAt: true,
          status: true,
          feeApplied: true,
          feeAmountCents: true,
          feeStatus: true,
        },
      },
    },
    orderBy: { name: 'asc' },
  });

  const rows = clients.map((client) => {
    const total = client.invoices.length;
    const lateInvoices = client.invoices.filter(
      (inv) => inv.paidAt && daysLateAt(inv.paidAt, inv.dueDate) > 0
    );
    const lateCount = lateInvoices.length;
    const avgDaysLate =
      lateCount > 0
        ? Math.round(
            lateInvoices.reduce((s, inv) => {
              return s + daysLateAt(inv.paidAt!, inv.dueDate);
            }, 0) / lateCount
          )
        : 0;

    const feesPaid = client.invoices
      .filter((inv) => inv.feeStatus === 'paid' && inv.feeAmountCents)
      .reduce((s, inv) => s + (inv.feeAmountCents ?? 0), 0);

    const openBalance = client.invoices
      .filter((inv) => inv.status === 'open')
      .reduce((s, inv) => s + inv.amount, 0);

    return {
      id: client.id,
      name: client.name,
      email: client.email,
      clientSinceYear: client.createdAt.getFullYear(),
      totalInvoices: total,
      lateCount,
      lateRatio: total > 0 ? Math.round((lateCount / total) * 100) : 0,
      avgDaysLate,
      feesPaidCents: feesPaid,
      openBalanceCents: openBalance,
    };
  });

  res.json({ clients: rows });
});