# Watchtower Security Review — Issues & Fixes

**Date:** September 25, 2026  
**Reviewer:** Claude Code Security Review  
**Status:** Ready for Developer Implementation

---

## 🔴 CRITICAL — Fix Before Production

### 1. Hardcoded JWT Secret Fallback
**File:** `src/index.ts:48`, `src/routes/auth.ts:7`

**The Problem:**
```typescript
const JWT_SECRET = process.env.JWT_SECRET || process.env.API_TOKEN || 'dev-secret-change-in-production';
```

If `JWT_SECRET` and `API_TOKEN` are not set, the app falls back to a hardcoded string that's in the source code. Anyone with access to your repository can forge valid JWT tokens and impersonate any user.

**Why This Matters:**
This is an **authentication bypass**. An attacker doesn't need to steal a token—they can create one from scratch using the hardcoded secret.

**How to Fix:**
```typescript
// src/index.ts
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}

// src/routes/auth.ts
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}
```

**Testing:**
- Verify app fails to start without JWT_SECRET set
- Update deployment docs to require JWT_SECRET
- Update .env.example to remove the fallback secret

---

### 2. CORS Allows All Origins
**File:** `src/index.ts:22`

**The Problem:**
```typescript
app.use(cors());  // ← No options = allows ANY origin
```

This allows requests from any website to make API calls on behalf of your users.

**Why This Matters:**
- **CSRF Attacks:** A malicious website can trick users into making unwanted API calls (e.g., creating invoices, changing settings)
- **Data Theft:** Any origin can fetch data from your API if a user is authenticated

**How to Fix:**
```typescript
// src/index.ts
import cors from 'cors';

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:4000').split(',');

app.use(cors({
  origin: ALLOWED_ORIGINS.map(o => o.trim()),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
}));
```

**Update .env.example:**
```
# Comma-separated list of origins allowed to make cross-origin requests
ALLOWED_ORIGINS="http://localhost:4000,https://yourdomain.com"
```

**Testing:**
- Test that requests from allowed origins work
- Test that requests from `http://evil.com` are rejected with a CORS error
- Ensure frontend origin is in ALLOWED_ORIGINS

---

## 🟡 HIGH PRIORITY — Fix Soon

### 3. Tokens Exposed in Query Parameters
**File:** `src/index.ts:48-54`, `src/routes/auth.ts:48`

**The Problem:**
```typescript
// auth.ts line 48:
res.redirect('/dashboard?token=' + token);

// index.ts line 48-54:
const token = (req.query.token as string) || ...;
```

JWT tokens passed in URL query strings are:
- Logged in server access logs
- Stored in browser history
- Sent in Referer headers to third-party sites
- Visible in browser address bar

**Why This Matters:**
If someone gets access to logs or history, they can steal valid tokens.

**How to Fix:**

Option A: Use HTTP-only cookies (recommended)
```typescript
// src/routes/auth.ts - Stripe OAuth callback
router.get('/stripe/callback', async (req: Request, res: Response) => {
  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const oauthResp = await stripe.oauth.token({ grant_type: 'authorization_code', code });
    const account = await prisma.account.upsert({ ... });

    const token = issueToken(account.id);
    
    // Set secure, HTTP-only cookie instead of query param
    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });
    
    // Redirect without token in URL
    res.redirect('/dashboard');
  } catch (err: any) {
    console.error('Stripe OAuth error:', err);
    res.status(500).send('Stripe connection failed. Please try again.');
  }
});

// src/index.ts - Remove query param auth entirely
app.use('/dashboard', (req: Request, res: Response, _next: NextFunction) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : req.cookies.auth_token;
  
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET) as { accountId: string };
      (req as any).accountId = payload.accountId;
      res.sendFile(path.join(__dirname, '../public/dashboard.html'));
      return;
    } catch {}
  }
  res.redirect('/');
});
```

**Add to dependencies:**
```bash
npm install cookie-parser
npm install --save-dev @types/cookie-parser
```

**Update src/index.ts:**
```typescript
import cookieParser from 'cookie-parser';

const app = express();
app.use(cookieParser());
// ... rest of middleware
```

**Testing:**
- Sign in via Stripe OAuth, verify token is in httpOnly cookie (not visible in browser DevTools Application tab)
- Verify token is in Authorization header when making API calls
- Test that without a valid token, dashboard redirects to home

---

### 4. Weak Password Requirements
**File:** `src/routes/auth.ts:65`

**The Problem:**
```typescript
if (password.length < 6) {
  res.status(400).json({ error: 'Password must be at least 6 characters' });
  return;
}
```

6 characters is too short and doesn't enforce any complexity.

**Why This Matters:**
Short passwords are vulnerable to brute force attacks. A 6-character password can be cracked in hours with modern hardware.

**How to Fix:**
```typescript
// src/routes/auth.ts
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

// In signup route:
router.post('/signup', async (req: Request, res: Response) => {
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
    
    // ... rest of signup logic
  }
});
```

**Testing:**
- Verify password `'Pass123'` (8 chars) is rejected
- Verify password `'Password123'` (12 chars, mixed case, number) is accepted
- Verify frontend shows password requirements to users

---

### 5. No Rate Limiting on Auth Endpoints
**File:** `src/routes/auth.ts`

**The Problem:**
The login, signup, and other auth endpoints have no rate limiting. An attacker can make thousands of login attempts per second to brute force passwords.

**Why This Matters:**
Without rate limiting, attackers can try many password combinations in a short time. This makes weak passwords even more dangerous.

**How to Fix:**

```bash
npm install express-rate-limit
npm install --save-dev @types/express-rate-limit
```

**Create src/middleware/rateLimit.ts:**
```typescript
import rateLimit from 'express-rate-limit';

// Strict limit for auth attempts (5 attempts per 15 minutes per IP)
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: 'Too many login attempts. Please try again in 15 minutes.',
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Use X-Forwarded-For if behind a proxy, otherwise use IP
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
```

**Update src/routes/auth.ts:**
```typescript
import { authLimiter } from '../middleware/rateLimit';

export function authRouter() {
  const router = Router();

  // Apply rate limiting to sensitive endpoints
  router.post('/signup', authLimiter, async (req: Request, res: Response) => {
    // ... signup logic
  });

  router.post('/login', authLimiter, async (req: Request, res: Response) => {
    // ... login logic
  });

  router.get('/stripe/callback', async (req: Request, res: Response) => {
    // ... stripe callback (no rate limit needed, signed by Stripe)
  });

  return router;
}
```

**Update src/index.ts:**
```typescript
import { apiLimiter } from './middleware/rateLimit';

app.use('/invoices', apiLimiter, invoicesRouter);
app.use('/reports', apiLimiter, reportsRouter);
// ... apply to other API routes
```

**Testing:**
- Make 6 login attempts in quick succession, verify 6th is rate limited
- Verify error message is user-friendly
- Ensure rate limit resets after 15 minutes

---

### 6. Email Enumeration Vulnerability
**File:** `src/routes/auth.ts:113`

**The Problem:**
```typescript
const account = await prisma.account.findFirst({ where: { email } });
if (!account?.passwordHash) {
  res.status(401).json({ error: 'No account found with that email.' });  // ← Leaks info!
  return;
}
```

The error message reveals whether an email address is registered. An attacker can enumerate valid emails by trying different addresses.

**Why This Matters:**
This helps attackers build a list of valid accounts to target with password attacks.

**How to Fix:**
```typescript
// src/routes/auth.ts - login endpoint
router.post('/login', authLimiter, async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: 'Email and password required' });
      return;
    }

    const account = await prisma.account.findFirst({ where: { email } });
    
    // Don't reveal whether the email exists
    const hasValidPassword = account?.passwordHash && await bcrypt.compare(password, account.passwordHash);
    
    if (!hasValidPassword) {
      res.status(401).json({ error: 'Invalid email or password.' });
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
```

**Testing:**
- Try login with non-existent email, verify message is "Invalid email or password"
- Try login with correct email but wrong password, verify same message
- Ensure no difference in error message or response time between the two cases

---

## 🟠 MEDIUM PRIORITY — Address Before Launch

### 7. Fragile Temporary Account ID Generation
**File:** `src/routes/auth.ts:88`

**The Problem:**
```typescript
stripeAccountId: 'pending_' + Date.now(),
```

Using timestamp as a unique ID is fragile. If two users sign up in the exact same millisecond (or in tests), IDs could collide.

**Why This Matters:**
- Could cause data corruption or account merging in edge cases
- Not a cryptographically sound approach

**How to Fix:**
```typescript
// Add to package.json dependencies (or use Node 19.8.1+ built-in)
// npm install uuid

import { v4 as uuidv4 } from 'uuid';

// In signup route:
const account = await prisma.account.create({
  data: {
    stripeAccountId: 'pending_' + uuidv4(),
    email,
    passwordHash,
  },
});
```

**Testing:**
- Verify IDs are unique across many signups (no collisions)
- Check database for no duplicate stripeAccountIds

---

### 8. No HTTPS Enforcement
**File:** `src/index.ts`

**The Problem:**
The app doesn't redirect HTTP requests to HTTPS or require HTTPS.

**Why This Matters:**
Without HTTPS, authentication tokens and passwords are transmitted in plain text and can be intercepted by attackers on the network (man-in-the-middle attacks).

**How to Fix:**

Add middleware to enforce HTTPS in production:

```typescript
// src/middleware/https.ts
import { Request, Response, NextFunction } from 'express';

export function httpsRedirect(req: Request, res: Response, next: NextFunction): void {
  if (process.env.NODE_ENV === 'production') {
    // Check if request came through a proxy (X-Forwarded-Proto header)
    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    if (proto !== 'https') {
      res.redirect(301, `https://${req.hostname}${req.originalUrl}`);
      return;
    }
  }
  next();
}
```

**Update src/index.ts:**
```typescript
import { httpsRedirect } from './middleware/https';

const app = express();

// Apply HTTPS redirect BEFORE other middleware
app.use(httpsRedirect);

// ... rest of middleware
```

**Update deployment docs** to note that:
- In production, reverse proxy (nginx, load balancer) must handle HTTPS
- X-Forwarded-Proto header must be set by the proxy
- Test with: `curl -i http://your-domain.com` should redirect to https

**Testing:**
- In development (NODE_ENV !== 'production'), HTTP requests should work normally
- Simulate production with HTTPS redirect enabled
- Verify all auth endpoints are HTTPS-only in production

---

### 9. No CSRF Protection
**File:** `src/index.ts`

**The Problem:**
POST/PUT/DELETE endpoints don't validate CSRF tokens. A malicious website can trick users into making unwanted state-changing requests.

**Why This Matters:**
A user could be tricked into visiting a malicious site that silently creates invoices or changes settings on their account.

**How to Fix:**

```bash
npm install csurf
npm install --save-dev @types/csurf
```

**Create src/middleware/csrf.ts:**
```typescript
import csrf from 'csurf';

export const csrfProtection = csrf({ cookie: false });
```

**Update src/index.ts:**
```typescript
import { csrfProtection } from './middleware/csrf';

app.use(csrfProtection);

// Provide CSRF token to frontend
app.get('/csrf-token', (req, res) => {
  res.json({ token: req.csrfToken() });
});
```

**Update frontend code** (in public/dashboard.html or equivalent):
```javascript
// Fetch CSRF token on page load
fetch('/csrf-token')
  .then(r => r.json())
  .then(data => {
    window.csrfToken = data.token;
  });

// Include CSRF token in all POST/PUT/DELETE requests
fetch('/invoices', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-CSRF-Token': window.csrfToken,  // ← Add this
  },
  body: JSON.stringify({ ... }),
});
```

**Testing:**
- Verify POST/PUT/DELETE without CSRF token returns 403
- Verify requests with valid token succeed
- Test that CSRF token is validated per-session

---

### 10. Stripe Account Lookup Assumes Single Account
**File:** `src/routes/webhook.ts:80`

**The Problem:**
```typescript
const account = await prisma.account.findFirst();  // ← Gets ANY first account
```

This assumes only one Stripe account exists. If you support multiple accounts in the future, webhooks from any Stripe account will be attributed to the first account in the database.

**Why This Matters:**
In multi-account setups, invoices could be assigned to the wrong customer or business.

**How to Fix:**

Store the Stripe webhook secret per account and verify it:

```typescript
// Assume your Account model has: stripeWebhookSecret, stripeAccountId

app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'] as string;
  let event: Stripe.Event;

  // Try each account's webhook secret
  const accounts = await prisma.account.findMany({
    where: { stripeWebhookSecret: { not: null } },
  });

  for (const account of accounts) {
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        account.stripeWebhookSecret!
      );
      
      // Found the account — proceed with this webhook
      await handleWebhookForAccount(event, account);
      res.json({ received: true });
      return;
    } catch (err) {
      // Try next account
      continue;
    }
  }

  // No account matched
  console.error('[webhook] signature verification failed for all accounts');
  res.status(400).send('Webhook signature verification failed');
});

async function handleWebhookForAccount(event: Stripe.Event, account: Account) {
  // ... webhook handling logic, now account-aware
}
```

**Testing:**
- Verify webhooks from account A go to account A's customers
- Add another account, verify its webhooks are handled separately

---

### 11. Ensure Email Template Data Validation
**File:** `src/services/emailRenderer.ts`

**The Problem:**
Email templates render user-supplied data. While Handlebars auto-escapes HTML, ensure all data is validated before rendering.

**Current Code (looks OK):**
```typescript
export function renderEmail(name: string, data: EmailData): { html: string; subject: string } {
  const tmpl = loadTemplate(name);
  const html = tmpl({ ... }); // Handlebars auto-escapes
}
```

**How to Ensure It's Safe:**
```typescript
// Add validation before renderEmail is called
function validateEmailData(data: EmailData): boolean {
  // Ensure all string fields are actual strings
  if (typeof data.businessName !== 'string') return false;
  if (typeof data.clientFirstName !== 'string') return false;
  if (typeof data.invoiceId !== 'string') return false;
  
  // Check for suspicious content
  const suspiciousPatterns = [/<script/, /javascript:/, /on\w+=/i];
  for (const field of Object.values(data)) {
    if (typeof field === 'string') {
      for (const pattern of suspiciousPatterns) {
        if (pattern.test(field)) {
          console.warn('Suspicious pattern in email data:', field);
          return false;
        }
      }
    }
  }
  
  return true;
}

// Before calling renderEmail:
if (!validateEmailData(data)) {
  throw new Error('Invalid email data');
}
const { html, subject } = renderEmail('reminder', data);
```

**Testing:**
- Try to render email with `<script>alert('xss')</script>` in a field
- Verify it's escaped as `&lt;script&gt;...&lt;/script&gt;` in the output
- Check that validation rejects suspicious input

---

### 12. Structured Logging (Don't Log Sensitive Data)
**File:** Multiple files log with `console.error()`

**The Problem:**
```typescript
console.error('Login error:', err);  // ← Might contain password or token
console.error('[webhook] signature verification failed', err);
```

Error details might contain sensitive data (passwords, tokens, PII) that shouldn't be in logs.

**How to Fix:**

Create a logger utility:

```typescript
// src/services/logger.ts
export function logError(message: string, error: any, context?: Record<string, any>) {
  // Don't log the full error if it contains sensitive info
  const safeError = {
    message: error?.message || String(error),
    code: error?.code,
    statusCode: error?.statusCode,
  };
  
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'error',
    message,
    error: safeError,
    context, // Add relevant context but NOT passwords/tokens
  }));
}
```

**Usage:**
```typescript
// src/routes/auth.ts
import { logError } from '../services/logger';

try {
  // ... auth logic
} catch (err: any) {
  logError('Login failed', err, { email: req.body.email });  // Safe to log email but not password
  res.status(500).json({ error: 'Something went wrong.' });
}
```

**Testing:**
- Check logs don't contain passwords, tokens, or PII
- Verify error messages are helpful for debugging without exposing secrets

---

## 📋 Implementation Checklist

- [ ] Fix hardcoded JWT secret (🔴 CRITICAL)
- [ ] Fix CORS (🔴 CRITICAL)
- [ ] Move tokens out of query params (🟡 HIGH)
- [ ] Increase password requirements (🟡 HIGH)
- [ ] Add rate limiting (🟡 HIGH)
- [ ] Fix email enumeration (🟡 HIGH)
- [ ] Use UUID for temp account IDs (🟠 MEDIUM)
- [ ] Add HTTPS enforcement (🟠 MEDIUM)
- [ ] Add CSRF protection (🟠 MEDIUM)
- [ ] Multi-account webhook support (🟠 MEDIUM)
- [ ] Validate email template data (🟠 MEDIUM)
- [ ] Structured logging (🟠 MEDIUM)

---

## Testing After Fixes

```bash
# Run type checking
npm run typecheck

# Run tests
npm test

# Build for production
npm run build

# Start in production mode (set all required env vars first)
NODE_ENV=production npm start
```

---

## Questions?

If any fix is unclear, ask for clarification before implementing. Some fixes depend on frontend changes (CSRF token handling, cookie-based auth) so coordinate across the stack.
