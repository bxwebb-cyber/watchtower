import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || process.env.API_TOKEN || 'dev-secret-change-in-production';

export function authRouter() {
  const router = Router();

  // ── Stripe OAuth ──

  // GET /auth/stripe/start — redirect to Stripe Connect
  router.get('/stripe/start', (_req: Request, res: Response) => {
    const clientId = process.env.STRIPE_CLIENT_ID;
    const redirectUri = process.env.STRIPE_REDIRECT_URI || 'http://localhost:4000/auth/stripe/callback';
    if (!clientId) {
      res.status(500).json({ error: 'STRIPE_CLIENT_ID not configured' });
      return;
    }
    const url = `https://connect.stripe.com/oauth/authorize?response_type=code&client_id=${clientId}&scope=read_write&redirect_uri=${encodeURIComponent(redirectUri)}`;
    res.redirect(url);
  });

  // GET /auth/stripe/callback — handle Stripe OAuth response
  router.get('/stripe/callback', async (req: Request, res: Response) => {
    const { code } = req.query;
    if (!code || typeof code !== 'string') {
      res.status(400).send('Missing authorization code.');
      return;
    }
    try {
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      const oauthResp = await stripe.oauth.token({ grant_type: 'authorization_code', code });
      const connectedAccountId = oauthResp.stripe_user_id;
      const email = oauthResp.email || 'unknown@stripe.com';

      // upsert account
      const account = await prisma.account.upsert({
        where: { stripeAccountId: connectedAccountId },
        update: { email },
        create: { stripeAccountId: connectedAccountId, email },
      });

      // Create a session token and redirect to dashboard
      const token = issueToken(account.id);
      res.redirect('/dashboard?token=' + token);
    } catch (err: any) {
      console.error('Stripe OAuth error:', err);
      res.status(500).send('Stripe connection failed. Please try again.');
    }
  });

  // ── Email/password auth ──

  // POST /auth/signup — create account + set password
  router.post('/signup', async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        res.status(400).json({ error: 'Email and password required' });
        return;
      }
      if (password.length < 6) {
        res.status(400).json({ error: 'Password must be at least 6 characters' });
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
          data: { passwordHash },
        });
        const token = issueToken(existing.id);
        res.json({ token, account: { id: existing.id, email } });
      } else {
        const account = await prisma.account.create({
          data: {
            stripeAccountId: 'pending_' + Date.now(),
            email,
            passwordHash,
          },
        });
        const token = issueToken(account.id);
        res.json({ token, account: { id: account.id, email } });
      }
    } catch (err: any) {
      console.error('Signup error:', err);
      res.status(500).json({ error: 'Something went wrong.' });
    }
  });

  // POST /auth/login — sign in
  router.post('/login', async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        res.status(400).json({ error: 'Email and password required' });
        return;
      }

      const account = await prisma.account.findFirst({ where: { email } });
      if (!account?.passwordHash) {
        res.status(401).json({ error: 'No account found with that email.' });
        return;
      }

      const valid = await bcrypt.compare(password, account.passwordHash);
      if (!valid) {
        res.status(401).json({ error: 'Invalid password.' });
        return;
      }

      const token = issueToken(account.id);
      res.json({
        token,
        account: { id: account.id, email: account.email, businessName: account.businessName, stripeConnected: !account.stripeAccountId.startsWith('pending_') },
      });
    } catch (err: any) {
      console.error('Login error:', err);
      res.status(500).json({ error: 'Something went wrong.' });
    }
  });

  // GET /auth/me — check current session
  router.get('/me', async (req: Request, res: Response) => {
    const auth = req.headers.authorization;
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    try {
      const payload = jwt.verify(token, JWT_SECRET) as { accountId: string };
      const account = await prisma.account.findUnique({ where: { id: payload.accountId } });
      if (!account) { res.status(401).json({ error: 'Account not found' }); return; }
      res.json({
        account: {
          id: account.id, email: account.email, businessName: account.businessName,
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
  return jwt.sign({ accountId }, JWT_SECRET, { expiresIn: '7d' });
}