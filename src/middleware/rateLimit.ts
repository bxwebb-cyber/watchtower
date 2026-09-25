import rateLimit from 'express-rate-limit';

// Strict limit for auth attempts (5 attempts per 15 minutes per IP)
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many attempts. Try again in 15 minutes.' },
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.ip || 'unknown';
  },
});

// Looser limit for general API (100 requests per 15 minutes per IP)
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: false,
  legacyHeaders: false,
});