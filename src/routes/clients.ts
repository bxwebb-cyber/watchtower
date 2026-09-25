import { Router } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
export const clientsRouter = Router();

// GET /clients — list all clients with lateness data.
clientsRouter.get('/', async (_req, res) => {
  const account = await prisma.account.findFirst();
  if (!account) return res.status(503).json({ error: 'No Stripe account connected' });

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
      (inv) => inv.paidAt && inv.dueDate && inv.paidAt > inv.dueDate
    );
    const lateCount = lateInvoices.length;
    const avgDaysLate =
      lateCount > 0
        ? Math.round(
            lateInvoices.reduce((s, inv) => {
              return s + (inv.paidAt!.getTime() - inv.dueDate.getTime()) / 86_400_000;
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