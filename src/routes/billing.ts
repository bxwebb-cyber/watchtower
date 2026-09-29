import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import Stripe from 'stripe';
import jwt from 'jsonwebtoken';

const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

const jwtSecret: string = process.env.JWT_SECRET ?? (() => {
  throw new Error('JWT_SECRET environment variable is required');
})();

export const billingRouter = Router();

const PLANS: Record<'solo' | 'business', { name: string; label: string; priceEnv: string }> = {
  solo: { name: 'solo', label: 'Solo', priceEnv: 'STRIPE_PRICE_SOLO' },
  business: { name: 'business', label: 'Business', priceEnv: 'STRIPE_PRICE_BUSINESS' },
};

// Paid monthly or once a year. Yearly prices live in <monthly env>_YEARLY:
// Solo $390/yr (2 months free), Unlimited $540/yr ($45/mo) — Bashira 9/29.
export type Billing = 'monthly' | 'yearly';

function priceIdFor(plan: keyof typeof PLANS, billing: Billing): string {
  const env = PLANS[plan].priceEnv + (billing === 'yearly' ? '_YEARLY' : '');
  const id = process.env[env];
  if (!id) {
    throw new Error(`${env} environment variable is not set`);
  }
  return id;
}

// Resolve the logged-in account id from the auth cookie / bearer token.
// Returns null when the visitor is not authenticated.
function resolveAccountId(req: Request): string | null {
  const authHeader = req.headers.authorization || '';
  const token = req.cookies?.auth_token || (authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '');
  if (!token) return null;
  try {
    const payload = jwt.verify(token, jwtSecret) as { accountId: string };
    return payload.accountId;
  } catch {
    return null;
  }
}

// GET /billing/status — what plan the account is on, for the dashboard + gating.
billingRouter.get('/status', async (req, res) => {
  const accountId = resolveAccountId(req);
  if (!accountId) {
    return res.json({ subscribed: false, plan: null });
  }
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) {
    return res.json({ subscribed: false, plan: null });
  }

  res.json({
    subscribed: account.subscriptionStatus === 'active' || account.subscriptionStatus === 'trialing',
    plan: account.plan ?? null,
    subscriptionStatus: account.subscriptionStatus ?? null,
    currentPeriodEnd: account.currentPeriodEnd ? account.currentPeriodEnd.toISOString() : null,
    cancelAtPeriodEnd: account.cancelAtPeriodEnd,
  });
});

// POST /billing/checkout — start a subscription for the given plan.
// Body: { plan: "solo" | "business", billing?: "monthly" | "yearly" }.
// Returns the hosted checkout URL.
billingRouter.post('/checkout', async (req, res) => {
  const plan = String(req.body?.plan ?? '') as 'solo' | 'business';
  if (plan !== 'solo' && plan !== 'business') {
    return res.status(400).json({ error: 'Plan must be "solo" or "business".' });
  }
  const billing = String(req.body?.billing ?? 'monthly') as Billing;
  if (billing !== 'monthly' && billing !== 'yearly') {
    return res.status(400).json({ error: 'Billing must be "monthly" or "yearly".' });
  }

  const accountId = resolveAccountId(req);
  if (!accountId) {
    return res.status(401).json({ error: 'Sign up or sign in first.' });
  }
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) {
    return res.status(503).json({ error: 'Account not found.' });
  }

  // If the account already has an active subscription, don't start a second.
  if (account.subscriptionStatus === 'active' || account.subscriptionStatus === 'trialing') {
    return res.status(409).json({ error: 'You already have an active subscription.' });
  }

  try {
    const priceId = priceIdFor(plan, billing);
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: account.email,
      client_reference_id: account.id,
      allow_promotion_codes: true,
      success_url: `${process.env.APP_URL || 'http://localhost:4000'}/dashboard?checkout=success`,
      cancel_url: `${process.env.APP_URL || 'http://localhost:4000'}/dashboard?checkout=cancelled`,
      subscription_data: {
        metadata: { accountId: account.id },
      },
      metadata: { accountId: account.id, plan, billing },
    });

    res.json({ url: session.url });
  } catch (err: any) {
    console.error('[billing] checkout failed:', err);
    res.status(500).json({ error: 'Could not start checkout. Is billing configured?' });
  }
});

// POST /billing/portal — open the Stripe customer portal (upgrade/downgrade/cancel).
billingRouter.post('/portal', async (req, res) => {
  const accountId = resolveAccountId(req);
  if (!accountId) {
    return res.status(401).json({ error: 'Sign up or sign in first.' });
  }
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account?.stripeCustomerId) {
    return res.status(409).json({ error: 'No billing customer yet.' });
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: account.stripeCustomerId,
      return_url: `${process.env.APP_URL || 'http://localhost:4000'}/dashboard`,
    });
    res.json({ url: session.url });
  } catch (err: any) {
    console.error('[billing] portal failed:', err);
    res.status(500).json({ error: 'Could not open the billing portal.' });
  }
});