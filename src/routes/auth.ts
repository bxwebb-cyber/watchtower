import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { authLimiter } from '../middleware/rateLimit';
import { stripePublicName } from '../lib/stripeName';
import { makeResetToken, checkResetToken, readResetAccount } from '../lib/resetToken';
import { Resend } from 'resend';
import { mailFrom } from '../services/notify';

const prisma = new PrismaClient();

const jwtSecret: string = process.env.JWT_SECRET ?? (() => {
  throw new Error('JWT_SECRET environment variable is required');
})();

function validatePassword(password: string): { valid: boolean; error?: string } {
  if (password.length < 12) {
    return { valid: false, error: 'Password must be at least 12 characters' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one uppercase letter' };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one lowercase letter' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one number' };
  }
  return { valid: true };
}

export function authRouter() {
  const router = Router();

  router.get('/stripe/start', (req: Request, res: Response) => {
    // Stripe links to an existing Dunn account. Without one, the callback
    // would invent an account with no business name and no reachable email.
    const signedIn = resolveAccountId(req);
    if (!signedIn) {
      res.redirect('/login');
      return;
    }
    const clientId = process.env.STRIPE_CLIENT_ID;
    const redirectUri = process.env.STRIPE_REDIRECT_URI || 'http://localhost:4000/auth/stripe/callback';
    if (!clientId) {
      res.status(500).json({ error: 'STRIPE_CLIENT_ID not configured' });
      return;
    }
    // `state` says who started this, signed and good for 15 minutes. The
    // callback trusts it over the cookie (the browser may not send the cookie
    // on Stripe's redirect back), and it stops anyone else's Stripe from
    // being attached to this account (OAuth CSRF).
    const state = jwt.sign({ accountId: signedIn, purpose: 'stripe_connect' }, jwtSecret, { expiresIn: '15m' });
    const url = `https://connect.stripe.com/oauth/authorize?response_type=code&client_id=${clientId}&scope=read_write&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;
    res.redirect(url);
  });

  router.get('/stripe/callback', async (req: Request, res: Response) => {
    const { code, state } = req.query;
    if (!code || typeof code !== 'string') {
      res.status(400).send('Missing authorization code.');
      return;
    }
    let stateAccountId: string | null = null;
    try {
      const p = jwt.verify(String(state ?? ''), jwtSecret) as { accountId?: string; purpose?: string };
      if (p.purpose === 'stripe_connect' && p.accountId) stateAccountId = p.accountId;
    } catch { /* missing or expired: handled below */ }
    if (!stateAccountId) {
      res.status(400).send('This Stripe link expired or didn\'t start from Dunn. Go back to Dunn → Settings → Connect Stripe and try again.');
      return;
    }
    try {
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      const oauthResp = await stripe.oauth.token({ grant_type: 'authorization_code', code });
      const connectedAccountId = oauthResp.stripe_user_id;

      // LINK the Stripe account to the signed-in Dunn account (created at
      // signup with a `pending_` stripeAccountId). Only the Stripe id changes:
      // the owner's email is their sign-in and where alerts go, and Stripe's
      // (often missing — test accounts return none) must never replace it.
      let accountId: string | null = stateAccountId;
      if (accountId) {
        const existing = await prisma.account.findUnique({ where: { id: accountId } });
        if (!existing) accountId = null;
      }
      if (!accountId) {
        res.redirect('/login');
        return;
      }
      // This Stripe account may already sit on another Dunn account. If that
      // one can't be signed into (no password — made by the old connect flow
      // that invented accounts), it's a stray: move its invoices, clients and
      // recurring templates here and free the Stripe id. A real account keeps it.
      const holder = await prisma.account.findUnique({ where: { stripeAccountId: connectedAccountId } });
      if (holder && holder.id !== accountId) {
        if (holder.passwordHash) {
          res.status(409).send('That Stripe account is already connected to another Dunn account. Sign in to that one, or connect a different Stripe account.');
          return;
        }
        const to = accountId;
        await prisma.$transaction([
          prisma.account.update({ where: { id: holder.id }, data: { stripeAccountId: 'pending_' + crypto.randomUUID() } }),
          prisma.client.updateMany({ where: { accountId: holder.id }, data: { accountId: to } }),
          prisma.feePolicy.updateMany({ where: { accountId: holder.id }, data: { accountId: to } }),
          prisma.invoice.updateMany({ where: { accountId: holder.id }, data: { accountId: to } }),
          prisma.invoiceTemplate.updateMany({ where: { accountId: holder.id }, data: { accountId: to } }),
        ]);
        console.log(`[auth] moved stray account ${holder.id} (Stripe ${connectedAccountId}) into ${to}`);
      }
      await prisma.account.update({
        where: { id: accountId },
        data: { stripeAccountId: connectedAccountId },
      });

      setAuthCookie(res, issueToken(accountId!));

      // The "connected" screen: what Dunn found, plus the name check — the
      // business name in Dunn's emails vs. the public name on the Stripe
      // payment page and receipt (the page hides the check if either is missing).
      const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId! } });
      const [openInvoices, clients, pastDue] = await Promise.all([
        prisma.invoice.count({ where: { accountId: account.id, status: 'open' } }),
        prisma.client.count({ where: { accountId: account.id } }),
        prisma.invoice.count({ where: { accountId: account.id, status: 'open', dueDate: { lt: new Date() } } }),
      ]);
      const params = new URLSearchParams({
        open_invoices: String(openInvoices),
        clients: String(clients),
        past_due: String(pastDue),
      });
      if (account.businessName) params.set('dunn_name', account.businessName);
      const stripeName = await stripePublicName(connectedAccountId);
      if (stripeName) params.set('stripe_name', stripeName);
      res.redirect('/onboarding-success.html?' + params.toString());
    } catch (err: any) {
      console.error('Stripe OAuth error:', err);
      res.status(500).send('Stripe connection failed. Please try again.');
    }
  });

  // Sign out: drop the session cookie (same options it was set with).
  const signOut = (_req: Request, res: Response) => {
    res.clearCookie('auth_token', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' });
    res.redirect('/login');
  };
  router.get('/logout', signOut);
  router.post('/logout', signOut);

  router.post('/signup', authLimiter, async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        res.status(400).json({ error: 'Email and password required' });
        return;
      }
      const businessName = String(req.body.businessName ?? '').trim();
      if (!businessName) {
        res.status(400).json({ error: 'Business name is required — reminders are sent in your business\'s name.' });
        return;
      }
      const ownerName = String(req.body.ownerName ?? '').trim();
      if (!ownerName) {
        res.status(400).json({ error: 'Add your name — emails sign off with it.' });
        return;
      }

      const validation = validatePassword(password);
      if (!validation.valid) {
        res.status(400).json({ error: validation.error });
        return;
      }

      const existing = await prisma.account.findFirst({ where: { email } });
      if (existing?.passwordHash) {
        res.status(409).json({ error: 'Account already exists. Sign in instead.' });
        return;
      }

      const passwordHash = await bcrypt.hash(password, 12);

      if (existing) {
        await prisma.account.update({
          where: { id: existing.id },
          data: { passwordHash, businessName, ownerName },
        });
        const token = issueToken(existing.id);
        setAuthCookie(res, token);
        res.json({ token, account: { id: existing.id, email, businessName, ownerName } });
      } else {
        const account = await prisma.account.create({
          data: {
            stripeAccountId: 'pending_' + crypto.randomUUID(),
            email,
            passwordHash,
            businessName,
            ownerName,
          },
        });
        const token = issueToken(account.id);
        setAuthCookie(res, token);
        res.json({ token, account: { id: account.id, email, businessName, ownerName } });
      }
    } catch (err: any) {
      console.error('Signup error:', err);
      res.status(500).json({ error: 'Something went wrong.' });
    }
  });

  // POST /auth/forgot { email } — email a reset link. Always the same answer,
  // so this can't be used to find out who has an account.
  router.post('/forgot', authLimiter, async (req: Request, res: Response) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    res.json({ ok: true, message: "If there's a Dunn account for that email, we sent a link to reset the password. It works for 1 hour." });
    if (!email) return;
    try {
      const account = await prisma.account.findFirst({ where: { email: { equals: email, mode: 'insensitive' }, passwordHash: { not: null } } });
      if (!account?.passwordHash || !process.env.RESEND_API_KEY) return;
      const link = `${process.env.APP_URL || 'http://localhost:4000'}/login/reset?token=${encodeURIComponent(makeResetToken(account.id, account.passwordHash, jwtSecret))}`;
      await new Resend(process.env.RESEND_API_KEY).emails.send({
        from: mailFrom(),
        to: account.email,
        subject: 'Reset your Dunn password',
        text: `Someone asked to reset the password for your Dunn account.\n\nSet a new one here (the link works for 1 hour, once):\n${link}\n\nIf this wasn't you, ignore this email. Your password stays the same.`,
        html: `<p>Someone asked to reset the password for your Dunn account.</p><p><a href="${link}" style="display:inline-block;padding:12px 20px;border-radius:10px;background:#0F302E;color:#F3F0E8;text-decoration:none;font-weight:600">Set a new password</a></p><p style="color:#5D6E6B;font-size:13px">The link works for 1 hour, once. If this wasn't you, ignore this email. Your password stays the same.</p>`,
      });
      console.log('[auth] password reset link sent');
    } catch (err) {
      console.error('[auth] forgot failed', (err as Error).message);
    }
  });

  // POST /auth/reset { token, password } — set the new password, sign in.
  router.post('/reset', authLimiter, async (req: Request, res: Response) => {
    const token = String(req.body?.token ?? '');
    const password = String(req.body?.password ?? '');
    const accountId = readResetAccount(token, jwtSecret);
    const account = accountId ? await prisma.account.findUnique({ where: { id: accountId } }) : null;
    const valid = account && checkResetToken(token, jwtSecret, () => account.passwordHash);
    if (!account || !valid) {
      res.status(400).json({ error: 'This reset link has expired or was already used. Ask for a new one.' });
      return;
    }
    const check = validatePassword(password);
    if (!check.valid) {
      res.status(400).json({ error: check.error });
      return;
    }
    await prisma.account.update({ where: { id: account.id }, data: { passwordHash: await bcrypt.hash(password, 12) } });
    setAuthCookie(res, issueToken(account.id));
    res.json({ ok: true });
  });

  router.post('/login', authLimiter, async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        res.status(400).json({ error: 'Email and password required' });
        return;
      }

      const account = await prisma.account.findFirst({ where: { email } });

      const hasValidPassword = account?.passwordHash && await bcrypt.compare(password, account.passwordHash);
      if (!hasValidPassword) {
        res.status(401).json({ error: 'Invalid email or password.' });
        return;
      }

      const token = issueToken(account.id);
      setAuthCookie(res, token);
      res.json({
        token,
        account: {
          id: account.id,
          email: account.email,
          businessName: account.businessName,
          ownerName: account.ownerName,
          stripeConnected: !account.stripeAccountId.startsWith('pending_'),
        },
      });
    } catch (err: any) {
      console.error('Login error:', err);
      res.status(500).json({ error: 'Something went wrong.' });
    }
  });

  router.get('/me', async (req: Request, res: Response) => {
    const auth = req.headers.authorization;
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    try {
      const payload = jwt.verify(token, jwtSecret) as unknown as { accountId: string };
      const account = await prisma.account.findUnique({ where: { id: payload.accountId } });
      if (!account) { res.status(401).json({ error: 'Account not found' }); return; }
      res.json({
        account: {
          id: account.id, email: account.email, businessName: account.businessName, ownerName: account.ownerName,
          stripeConnected: !account.stripeAccountId.startsWith('pending_'),
        },
      });
    } catch {
      res.status(401).json({ error: 'Invalid or expired token' });
    }
  });

  return router;
}

function issueToken(accountId: string): string {
  return jwt.sign({ accountId }, jwtSecret, { expiresIn: '7d' });
}

function setAuthCookie(res: Response, token: string): void {
  res.cookie('auth_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax', // sent when Stripe redirects back; still not on cross-site POSTs
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

// Resolve the signed-in account id from the auth cookie / bearer token.
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