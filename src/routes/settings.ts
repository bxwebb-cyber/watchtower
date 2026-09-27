import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { getAccount } from '../lib/account';

const prisma = new PrismaClient();
export const settingsRouter = Router();

// GET /settings — return owner email + alert toggles for the connected account.
settingsRouter.get('/', async (req, res) => {
  const account = await getAccount(req);
  if (!account) {
    return res.status(401).json({ error: 'Not authenticated' });
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
    stripeConnected: !!account.stripeAccountId && !account.stripeAccountId.startsWith('pending_'),
    defaultFeeKind: settings.defaultFeeKind,
    defaultFeeAmount: settings.defaultFeeAmount,
    defaultGraceDays: settings.defaultGraceDays,
  });
});

// PUT /settings — update owner email and alert toggles.
settingsRouter.put('/', async (req, res) => {
  const account = await getAccount(req);
  if (!account) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  // businessName is the client-facing sender name; it lives on the Account.
  let businessName = account.businessName ?? null;
  if (req.body.businessName !== undefined) {
    businessName = String(req.body.businessName).trim() || null;
    await prisma.account.update({ where: { id: account.id }, data: { businessName } });
  }

  const data: Record<string, unknown> = {};
  if (req.body.ownerEmail !== undefined) data.ownerEmail = req.body.ownerEmail;
  if (req.body.alertFeeApproval !== undefined) data.alertFeeApproval = Boolean(req.body.alertFeeApproval);
  if (req.body.alertOverdue !== undefined) data.alertOverdue = Boolean(req.body.alertOverdue);
  if (req.body.alertPayment !== undefined) data.alertPayment = Boolean(req.body.alertPayment);
  if (req.body.defaultFeeKind !== undefined) data.defaultFeeKind = String(req.body.defaultFeeKind);
  if (req.body.defaultFeeAmount !== undefined) data.defaultFeeAmount = Number(req.body.defaultFeeAmount);
  if (req.body.defaultGraceDays !== undefined) data.defaultGraceDays = Number(req.body.defaultGraceDays);

  const settings = await prisma.settings.upsert({
    where: { accountId: account.id },
    update: data,
    create: { accountId: account.id, ...data } as any,
  });

  res.json({
    businessName,
    ownerEmail: settings.ownerEmail ?? account.email,
    alertFeeApproval: settings.alertFeeApproval,
    alertOverdue: settings.alertOverdue,
    alertPayment: settings.alertPayment,
    defaultFeeKind: settings.defaultFeeKind,
    defaultFeeAmount: settings.defaultFeeAmount,
    defaultGraceDays: settings.defaultGraceDays,
  });
});

// GET /settings/status — Stripe connection status (for onboarding).
settingsRouter.get('/status', async (req, res) => {
  const account = await getAccount(req);
  res.json({
    connected: !!account,
    businessName: account?.businessName ?? null,
    stripeAccountId: account?.stripeAccountId ?? null,
    stripeConnected: !!account?.stripeAccountId && !account.stripeAccountId.startsWith('pending_'),
  });
});