import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { getAccount } from '../lib/account';
import { stripePublicName } from '../lib/stripeName';
import { parseGraceDays, GRACE_REQUIRED } from '../services/feeRules';
import { clientsUsed, monthStart, SOLO_CLIENTS_PER_MONTH, hasActivePlan, planRequired } from '../services/planLimits';

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

  // $39 plan: how many of its 5 clients are used this month (for the warning).
  let clientsThisMonth: number | null = null;
  if (account.plan === 'solo') {
    const invs = await prisma.invoice.findMany({
      where: { accountId: account.id, createdAt: { gte: monthStart(new Date()) } },
      select: { client: { select: { email: true } } },
    });
    clientsThisMonth = clientsUsed(invs.map((i) => i.client?.email));
  }

  res.json({
    plan: account.plan ?? null,
    needsPlan: planRequired() && !hasActivePlan(account),
    planEnding: account.cancelAtPeriodEnd,
    planPeriodEnd: account.currentPeriodEnd ? account.currentPeriodEnd.toISOString() : null,
    clientsThisMonth,
    clientLimit: account.plan === 'solo' ? SOLO_CLIENTS_PER_MONTH : null,
    ownerEmail: settings.ownerEmail ?? account.email,
    alertFeeApproval: settings.alertFeeApproval,
    alertOverdue: settings.alertOverdue,
    alertPayment: settings.alertPayment,
    businessName: account.businessName,
    ownerName: account.ownerName,
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
  // ownerName is the owner's own name — emails sign off with its first word.
  let businessName = account.businessName ?? null;
  let ownerName = account.ownerName ?? null;
  if (req.body.businessName !== undefined) {
    const next = String(req.body.businessName).trim();
    if (!next) return res.status(400).json({ error: 'Business name is required — every email is sent in it.' });
    businessName = next;
  }
  if (req.body.ownerName !== undefined) {
    ownerName = String(req.body.ownerName).trim() || null;
  }
  if (req.body.businessName !== undefined || req.body.ownerName !== undefined) {
    await prisma.account.update({ where: { id: account.id }, data: { businessName, ownerName } });
  }

  const data: Record<string, unknown> = {};
  if (req.body.ownerEmail !== undefined) data.ownerEmail = req.body.ownerEmail;
  if (req.body.alertFeeApproval !== undefined) data.alertFeeApproval = Boolean(req.body.alertFeeApproval);
  if (req.body.alertOverdue !== undefined) data.alertOverdue = Boolean(req.body.alertOverdue);
  if (req.body.alertPayment !== undefined) data.alertPayment = Boolean(req.body.alertPayment);
  if (req.body.defaultFeeKind !== undefined) data.defaultFeeKind = String(req.body.defaultFeeKind);
  if (req.body.defaultFeeAmount !== undefined) data.defaultFeeAmount = Number(req.body.defaultFeeAmount);
  if (req.body.defaultGraceDays !== undefined) {
    // The owner's choice (0 = the day after the due date); blank clears it.
    const blank = req.body.defaultGraceDays === null || req.body.defaultGraceDays === '';
    const grace = parseGraceDays(req.body.defaultGraceDays);
    if (!blank && grace === null) return res.status(400).json({ error: GRACE_REQUIRED });
    data.defaultGraceDays = blank ? null : grace;
  }

  const settings = await prisma.settings.upsert({
    where: { accountId: account.id },
    update: data,
    create: { accountId: account.id, ...data } as any,
  });

  res.json({
    businessName,
    ownerName,
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
    stripeName: await stripePublicName(account?.stripeAccountId),
    stripeAccountId: account?.stripeAccountId ?? null,
    stripeConnected: !!account?.stripeAccountId && !account.stripeAccountId.startsWith('pending_'),
  });
});