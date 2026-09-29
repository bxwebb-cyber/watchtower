import { Request, Response, NextFunction } from 'express';

// Simple bearer token auth. When API_TOKEN is set in .env, every API request
// (except /health, /auth, and /webhooks) must include:
//   Authorization: Bearer <token>
// When unset, the API stays open (backwards compatible for local dev).
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Webhooks (Stripe, Resend client replies) prove themselves with their own
  // signatures and can never send our token — never block them here.
  if ((req.path ?? '').startsWith('/webhooks/')) return next();

  const token = process.env.API_TOKEN;
  if (!token) {
    // No token configured — open access for local dev.
    return next();
  }

  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'missing or malformed authorization header' });
    return;
  }

  const provided = header.slice(7).trim();
  if (provided !== token) {
    res.status(403).json({ error: 'invalid token' });
    return;
  }

  next();
}