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

const app = express();

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
app.use(express.json());

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

app.use(express.static(path.join(__dirname, '../public')));

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/landing.html'));
});

// Demo dashboard (sample data, no API calls).
app.get('/demo', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/demo.html'));
});

const port = Number(process.env.PORT || 4000);
app.listen(port, () => {
  console.log(`[watchtower] listening on :${port}`);
});