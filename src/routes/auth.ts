import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { authLimiter } from '../middleware/rateLimit';

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

      const account = await prisma.account.upsert({
        where: { stripeAccountId: connectedAccountId },
        update: { email },
        create: { stripeAccountId: connectedAccountId, email },
      });

      const token = issueToken(account.id);

      res.cookie('auth_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      res.redirect('/dashboard');
    } catch (err: any) {
      console.error('Stripe OAuth error:', err);
      res.status(500).send('Stripe connection failed. Please try again.');
    }
  });

  router.post('/signup', authLimiter, async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        res.status(400).json({ error: 'Email and password required' });
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
          data: { passwordHash },
        });
        const token = issueToken(existing.id);
        res.json({ token, account: { id: existing.id, email } });
      } else {
        const account = await prisma.account.create({
          data: {
            stripeAccountId: 'pending_' + crypto.randomUUID(),
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
      res.json({
        token,
        account: {
          id: account.id,
          email: account.email,
          businessName: account.businessName,
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
  return jwt.sign({ accountId }, jwtSecret, { expiresIn: '7d' }) as unknown as string;
}