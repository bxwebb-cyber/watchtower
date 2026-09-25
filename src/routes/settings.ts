import { Router } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
export const settingsRouter = Router();

// GET /settings — return owner email + alert toggles for the connected account.
settingsRouter.get('/', async (_req, res) => {
  const account = await prisma.account.findFirst();
  if (!account) {
    return res.status(503).json({ error: 'No Stripe account connected' });
  }

  let settings = await prisma.settings.findUnique({ where: { accountId: account.id } });
  if (!settings) {
    // Auto-create default settings.
    settings = await prisma.settings.create({
      data: { accountId: account.id },
    });
  }

  res.json({
    ownerEmail: settings.ownerEmail ?? account.email,
    alertFeeApproval: settings.alertFeeApproval,
    alertOverdue: settings.alertOverdue,
    alertPayment: settings.alertPayment,
    businessName: account.businessName,
    stripeConnected: true,
  });
});

// PUT /settings — update owner email and alert toggles.
settingsRouter.put('/', async (req, res) => {
  const account = await prisma.account.findFirst();
  if (!account) {
    return res.status(503).json({ error: 'No Stripe account connected' });
  }

  const data: Record<string, unknown> = {};
  if (req.body.ownerEmail !== undefined) data.ownerEmail = req.body.ownerEmail;
  if (req.body.alertFeeApproval !== undefined) data.alertFeeApproval = Boolean(req.body.alertFeeApproval);
  if (req.body.alertOverdue !== undefined) data.alertOverdue = Boolean(req.body.alertOverdue);
  if (req.body.alertPayment !== undefined) data.alertPayment = Boolean(req.body.alertPayment);

  const settings = await prisma.settings.upsert({
    where: { accountId: account.id },
    update: data,
    create: { accountId: account.id, ...data } as any,
  });

  res.json({
    ownerEmail: settings.ownerEmail ?? account.email,
    alertFeeApproval: settings.alertFeeApproval,
    alertOverdue: settings.alertOverdue,
    alertPayment: settings.alertPayment,
  });
});

// GET /settings/status — Stripe connection status (for onboarding).
settingsRouter.get('/status', async (_req, res) => {
  const account = await prisma.account.findFirst();
  res.json({
    connected: !!account,
    businessName: account?.businessName ?? null,
    stripeAccountId: account?.stripeAccountId ?? null,
  });
});