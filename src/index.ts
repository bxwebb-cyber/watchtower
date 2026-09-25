import 'dotenv/config';
import path from 'path';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { webhookRouter } from './routes/webhook';
import { authRouter } from './routes/auth';
import { invoicesRouter } from './routes/invoices';
import { reportsRouter } from './routes/reports';
import { templatesRouter } from './routes/templates';
import { settingsRouter } from './routes/settings';
import { clientsRouter } from './routes/clients';
import { inboundRouter } from './routes/inbound';
import { authMiddleware } from './middleware/auth';

const app = express();

// Webhook route needs the RAW body for Stripe signature verification,
// so it gets its own express.raw() instance BEFORE the json parser.
app.use('/webhooks/stripe', express.raw({ type: 'application/json' }), webhookRouter);

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'watchtower' });
});

app.use('/auth', authRouter);

// Auth gate: protect API routes with a bearer token when API_TOKEN is set.
app.use(authMiddleware);

app.use('/invoices', invoicesRouter);
app.use('/reports', reportsRouter);
app.use('/templates', templatesRouter);
app.use('/settings', settingsRouter);
app.use('/clients', clientsRouter);
// Inbound email (Resend): client replies to reminders land here.
// Needs raw body for Svix signature verification.
app.use('/webhooks/resend/inbound', express.raw({ type: 'application/json' }), inboundRouter);

// Auth pages (no auth required).
app.get('/login', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../public/login.html'));
});

const JWT_SECRET = process.env.JWT_SECRET || process.env.API_TOKEN || 'dev-secret-change-in-production';

// The dashboard (authenticated).
app.use('/dashboard', (req: Request, res: Response, _next: NextFunction) => {
  // Allow access if ?token= is provided (from Stripe OAuth callback redirect)
  const authHeader = req.headers.authorization || '';
  const token = (req.query.token as string) || (authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '');
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET) as { accountId: string };
      (req as any).accountId = payload.accountId;
      // Serve the file
      res.sendFile(path.join(__dirname, '../public/dashboard.html'));
      return;
    } catch {}
  }
  // No valid token → redirect to landing page
  res.redirect('/');
});

// The landing page (marketing site, no auth).
app.use(express.static(path.join(__dirname, '../public')));

// Default: serve landing page
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

const port = Number(process.env.PORT || 4000);
app.listen(port, () => {
  console.log(`[watchtower] listening on :${port}`);
});
