import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import { webhookRouter } from './routes/webhook';
import { authRouter } from './routes/auth';
import { invoicesRouter } from './routes/invoices';
import { reportsRouter } from './routes/reports';
import { templatesRouter } from './routes/templates';
import { settingsRouter } from './routes/settings';
import { clientsRouter } from './routes/clients';
import { billingRouter } from './routes/billing';
import { inboundRouter } from './routes/inbound';
import { authMiddleware } from './middleware/auth';
import { apiLimiter } from './middleware/rateLimit';
import { httpsRedirect } from './middleware/https';
import { schedulerEnabled, startScheduler } from './jobs/scheduler';
import { jobsStartDate } from './jobs/startDate';
import { withJobLock, runSweep } from './jobs/sweep';

const app = express();
// Railway sits one proxy in front: trust it so rate limits see each visitor's
// real IP, not the proxy's (otherwise everyone shares one login limit).
app.set('trust proxy', 1);

// HTTPS redirect must come before EVERYTHING else in production.
app.use(httpsRedirect);

const jwtSecret: string = process.env.JWT_SECRET ?? (() => {
  throw new Error('JWT_SECRET environment variable is required');
})();

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:4000').split(',').map(o => o.trim());
app.use(cors({
  origin: ALLOWED_ORIGINS,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
}));

app.use(cookieParser());
// Webhooks (Stripe, Resend) verify a signature over the exact raw body, so
// they must reach their own express.raw() unparsed. JSON-parsing them first
// made every Stripe webhook fail verification.
const jsonParser = express.json();
app.use((req, res, next) => (req.path.startsWith('/webhooks/') ? next() : jsonParser(req, res, next)));

app.use('/webhooks/stripe', express.raw({ type: 'application/json' }), webhookRouter);

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'watchtower' });
});

app.use('/auth', authRouter());

app.use(authMiddleware);

app.use('/invoices', apiLimiter, invoicesRouter);
app.use('/reports', apiLimiter, reportsRouter);
app.use('/templates', apiLimiter, templatesRouter);
app.use('/settings', apiLimiter, settingsRouter);
app.use('/clients', apiLimiter, clientsRouter);
app.use('/billing', apiLimiter, billingRouter);
app.use('/webhooks/resend/inbound', express.raw({ type: 'application/json' }), inboundRouter);

app.get('/login', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../public/login.html'));
});

app.use('/dashboard', (req: Request, res: Response, _next: NextFunction) => {
  const authHeader = req.headers.authorization || '';
  const token = req.cookies?.auth_token || (authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '');
  if (token) {
    try {
      const payload = jwt.verify(token, jwtSecret) as unknown as { accountId: string };
      (req as any).accountId = payload.accountId;
      res.sendFile(path.join(__dirname, '../public/dashboard.html'));
      return;
    } catch {}
  }
  res.redirect('/');
});

// Root + demo routes BEFORE express.static so they take precedence over
// the directory's index.html default (otherwise "/" serves the stale index.html).
app.get('/', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../public/landing.html'));
});

// Demo dashboard (sample data, no API calls).
app.get('/demo', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../public/demo.html'));
});

// Legal pages at clean URLs.
app.get('/terms', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../public/terms.html'));
});
app.get('/privacy', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../public/privacy.html'));
});

// Guides at clean URLs (/guides, /guides/<slug>). Slugs are checked against
// the files that exist, so no path tricks reach the filesystem.
const GUIDES_DIR = path.join(__dirname, '../public/guides');
app.get('/guides', (_req: Request, res: Response) => {
  res.sendFile(path.join(GUIDES_DIR, 'index.html'));
});
app.get('/guides/:slug', (req: Request, res: Response, next) => {
  const slug = String(req.params.slug);
  const file = path.join(GUIDES_DIR, slug + '.html');
  if (!/^[a-z0-9-]+$/.test(slug) || !fs.existsSync(file)) return next();
  res.sendFile(file);
});

// First-run onboarding (connect Stripe + set default late-fee terms).
app.get('/onboarding', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../public/onboarding.html'));
});

app.use(express.static(path.join(__dirname, '../public')));

const port = Number(process.env.PORT || 4000);
app.listen(port, () => {
  console.log(`[watchtower] listening on :${port}`);
  if (schedulerEnabled()) {
    startScheduler(() => withJobLock(() => runSweep()));
    const start = jobsStartDate();
    console.log(start ? `[scheduler] only invoices created on/after ${start.toISOString().slice(0, 10)} (SCHEDULER_START)` : '[scheduler] all open invoices are eligible (no SCHEDULER_START)');
  } else {
    const why = process.env.SCHEDULER === 'off' ? 'SCHEDULER=off' : 'local dev';
    console.log(`[scheduler] off (${why}) — reminders and fees won't send on their own; run jobs with npm run job:*, or set SCHEDULER=on`);
  }
});