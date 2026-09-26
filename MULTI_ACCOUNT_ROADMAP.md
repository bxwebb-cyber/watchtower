# Watchtower Multi-Account Future Roadmap

**Status:** Planning document (not yet implemented)  
**Trigger:** Build this when a paying customer asks for multiple Stripe accounts OR team access

---

## Why Multi-Account Matters

Currently, watchtower supports one Stripe connected account per app deployment. For scaling:

1. **Single SaaS instance for all customers** — Run one app, serve many businesses
2. **Team collaboration** — Multiple users accessing the same workspace
3. **Multiple Stripe accounts per business** — Large businesses with separate payment processors
4. **Per-customer billing** — Charge based on usage, not deployments

## When to Build This

**Not now.** Wait until:
- A paying customer says "I need two Stripe accounts"
- OR "Multiple people on my team need access"
- OR you're managing 5+ separate deployments

Right now: Ship single-account, get real users, understand what they actually need.

---

## Phase 1: Lay Groundwork Now (2 days)

This is a minimal refactor that makes Phase 2 trivial later. Do this before shipping to customers.

### Change Every Database Query

**Before:**
```typescript
const account = await prisma.account.findFirst();
const invoices = await prisma.invoice.findMany({ ... });
```

**After:**
```typescript
const account = await prisma.account.findUnique({ where: { id: accountId } });
const invoices = await prisma.invoice.findMany({ 
  where: { accountId }, // ← Always filter by accountId
  ... 
});
```

### Establish Account Context in Middleware

Add this to every protected route:

```typescript
// src/middleware/accountContext.ts
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export function requireAccountContext(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization;
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  
  if (!token) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  try {
    const JWT_SECRET = process.env.JWT_SECRET;
    const payload = jwt.verify(token, JWT_SECRET!) as { accountId: string };
    (req as any).accountId = payload.accountId;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// Use it:
// app.use(requireAccountContext);
// Then access: const accountId = (req as any).accountId;
```

### Update Database Schema

No migrations needed yet, but add a comment to every table:

```prisma
// prisma/schema.prisma

model Invoice {
  id String @id @default(cuid())
  accountId String // ← All data belongs to an account
  account Account @relation(fields: [accountId], references: [id])
  
  // ... rest of fields
  
  @@index([accountId]) // ← Speed up queries
}

model Client {
  id String @id @default(cuid())
  accountId String
  account Account @relation(fields: [accountId], references: [id])
  
  // ... rest
  
  @@index([accountId])
}

// Every table should have accountId except Account itself
```

### Checklist for Phase 1

- [ ] Update all invoice queries to filter by accountId
- [ ] Update all client queries to filter by accountId
- [ ] Update all template queries to filter by accountId
- [ ] Update webhook handler to look up account and pass it through
- [ ] Add accountContext middleware to all protected routes
- [ ] Test that a single-account app still works (all queries still succeed)

**Time estimate:** 2 days  
**Risk:** Low (all changes are additive, backward compatible)

---

## Phase 2: Multi-Account Architecture (When Needed)

Only start this when you have a paying customer asking for it.

### Step 1: Restructure Account Model

Your current `Account` model is the billing entity. Create a `Workspace` for the tenant boundary:

```prisma
model Account {
  id String @id @default(cuid())
  
  // Billing info (stays at Account level)
  email String @unique
  businessName String?
  stripeAccountId String @unique
  
  // New: Can have multiple workspaces
  workspaces Workspace[]
  
  createdAt DateTime @default(now())
}

model Workspace {
  id String @id @default(cuid())
  
  // Links back to Account
  accountId String
  account Account @relation(fields: [accountId], references: [id])
  
  // Tenant identity
  name String // "Primary Business" or "Chicago Office"
  stripeConnectedAccountId String? // Workspace's own Stripe account
  
  // All existing data now belongs to workspace
  invoices Invoice[]
  clients Client[]
  templates Template[]
  
  @@unique([accountId, name])
  @@index([accountId])
}

// Update existing models:
model Invoice {
  id String @id @default(cuid())
  workspaceId String  // ← Changed from accountId
  workspace Workspace @relation(fields: [workspaceId], references: [id])
  
  // ... rest
  
  @@index([workspaceId])
}
```

### Step 2: Multi-Workspace Queries

```typescript
// Instead of filtering by accountId, filter by workspaceId
const invoices = await prisma.invoice.findMany({
  where: { workspaceId },
});

// Get workspace with account context
const workspace = await prisma.workspace.findUnique({
  where: { id: workspaceId },
  include: { account: true },
});
```

### Step 3: Multi-Account Webhook Routing

Currently broken (all webhooks go to first account). Fix it:

```typescript
// src/routes/webhook.ts
import Stripe from 'stripe';

webhookRouter.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'] as string;
  let event: Stripe.Event;

  // Try each workspace's webhook secret
  const workspaces = await prisma.workspace.findMany({
    where: { stripeConnectedAccountId: { not: null } },
  });

  for (const workspace of workspaces) {
    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        workspace.stripeWebhookSecret!  // Per-workspace secret
      );
      
      // Successfully verified — handle webhook for this workspace
      await handleWebhookForWorkspace(event, workspace);
      res.json({ received: true });
      return;
    } catch (err) {
      // Try next workspace
      continue;
    }
  }

  console.error('[webhook] signature verification failed for all workspaces');
  res.status(400).send('Webhook verification failed');
});

async function handleWebhookForWorkspace(event: Stripe.Event, workspace: Workspace) {
  // All existing webhook logic, now workspace-aware
  // onInvoiceCreated(inv, workspace.id) instead of onInvoiceCreated(inv)
}
```

### Step 4: User → Workspace Relationships

Add team access:

```prisma
model User {
  id String @id @default(cuid())
  email String @unique
  passwordHash String?
  accountId String
  account Account @relation(fields: [accountId], references: [id])
  
  // User can access multiple workspaces within their account
  workspaceAccess WorkspaceAccess[]
  
  createdAt DateTime @default(now())
}

model WorkspaceAccess {
  id String @id @default(cuid())
  userId String
  user User @relation(fields: [userId], references: [id])
  
  workspaceId String
  workspace Workspace @relation(fields: [workspaceId], references: [id])
  
  role String @default("member") // "owner", "member", "viewer"
  
  @@unique([userId, workspaceId])
  @@index([userId])
  @@index([workspaceId])
}
```

### Step 5: Workspace Selection in UI

Add to dashboard:

```typescript
// GET /workspaces — list user's workspaces
router.get('/workspaces', async (req, res) => {
  const userId = (req as any).userId;
  const access = await prisma.workspaceAccess.findMany({
    where: { userId },
    include: { workspace: true },
  });
  res.json({ workspaces: access.map(a => a.workspace) });
});

// POST /workspaces/:id/select — set current workspace in session
router.post('/workspaces/:id/select', async (req, res) => {
  const workspaceId = req.params.id;
  const userId = (req as any).userId;
  
  // Verify user has access
  const access = await prisma.workspaceAccess.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
  });
  
  if (!access) {
    res.status(403).json({ error: 'Not authorized' });
    return;
  }
  
  // Set cookie or update session to remember workspace preference
  res.cookie('workspaceId', workspaceId, { httpOnly: true });
  res.json({ ok: true });
});
```

### Step 6: Per-Workspace Settings

Move settings from Account to Workspace:

```prisma
model WorkspaceSettings {
  id String @id @default(cuid())
  workspaceId String @unique
  workspace Workspace @relation(fields: [workspaceId], references: [id])
  
  // Email settings
  mailFrom String
  sendingDomain String
  
  // Reminder schedule
  remindersEnabled Boolean @default(true)
  reminderDaysBefore Int @default(7)
  
  // Late fees
  defaultFeeKind String @default("none") // "flat", "percent", "none"
  defaultFeeAmount Float?
  defaultGraceDays Int @default(7)
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

### Step 7: Per-Workspace Billing

Track usage per workspace:

```prisma
model WorkspaceUsage {
  id String @id @default(cuid())
  workspaceId String
  workspace Workspace @relation(fields: [workspaceId], references: [id])
  
  month String // "2026-09"
  invoicesCreated Int @default(0)
  remintersSent Int @default(0)
  feesApplied Int @default(0)
  
  @@unique([workspaceId, month])
}
```

Then charge based on usage or per-workspace subscription.

---

## Migration Path from Single → Multi-Account

Assuming you have live data:

### 1. Create default workspace for existing account
```sql
-- SQL migration
INSERT INTO "Workspace" ("id", "accountId", "name")
SELECT id, id, 'Primary'
FROM "Account";
```

### 2. Backfill workspaceId on existing invoices
```sql
-- SQL migration
UPDATE "Invoice"
SET "workspaceId" = (
  SELECT w.id FROM "Workspace" w
  WHERE w."accountId" = "Invoice"."accountId"
  LIMIT 1
)
WHERE "workspaceId" IS NULL;
```

### 3. Create default users for existing accounts
```sql
INSERT INTO "User" ("id", "accountId", "email")
SELECT id, id, email FROM "Account";

INSERT INTO "WorkspaceAccess" ("userId", "workspaceId", "role")
SELECT u.id, w.id, 'owner'
FROM "User" u
JOIN "Workspace" w ON w."accountId" = u."accountId";
```

### 4. Test end-to-end
- Existing account can still log in
- Existing invoices are visible
- Can create new workspaces
- Users can switch workspaces

---

## Design Decisions to Make Later

When you start Phase 2, decide:

1. **Billing model** — Per-workspace subscription? Per-account with shared workspaces? Usage-based?
2. **Workspace limits** — Can one account have 100 workspaces? Just 1?
3. **Stripe account strategy** — Can each workspace have its own Stripe account, or only one per Account?
4. **Team permissions** — What can each role do? (owner, member, viewer, admin?)
5. **Data isolation** — Do users see only their workspace, or their account's workspaces?

---

## Checklist for Phase 2 (When Ready)

- [ ] Database migration: Account → Workspace
- [ ] Backfill existing data into default workspace
- [ ] Update all queries to use workspaceId
- [ ] Add User and WorkspaceAccess models
- [ ] Create workspace selection UI
- [ ] Fix webhook routing to per-workspace
- [ ] Add per-workspace settings
- [ ] Test with multiple workspaces
- [ ] Update auth to handle workspace context
- [ ] Create billing model for per-workspace charges
- [ ] Write migration docs for existing customers

**Estimated effort:** 3-4 weeks (bigger refactor, but Phase 1 makes it smooth)

---

## Why Phase 1 Saves Time Later

If you don't do Phase 1 now, Phase 2 will be:
- Finding every `findFirst()` and fixing it
- Adding accountId filters to 50+ queries
- Risk of accidental data leaks (forgetting to filter by accountId)
- 6-8 weeks instead of 3-4

If you do Phase 1 now (2 days):
- Phase 2 is mostly schema changes + UI
- All queries already filter properly
- No data leak risk
- 3-4 weeks as estimated

**It's worth the 2 days upfront.**

---

## Questions to Ask When You Start Phase 2

1. How many customers will have multiple workspaces?
2. Do you want to support per-workspace Stripe accounts?
3. Will you charge per-workspace or per-account?
4. Do you need audit logs of who did what in which workspace?
5. Will workspace names be public (customer-facing)?

---

## Files to Update for Phase 1

- `src/middleware/accountContext.ts` — Create this
- `src/routes/*.ts` — Add accountId filters to all queries
- `prisma/schema.prisma` — Add comments, indexes
- `src/routes/webhook.ts` — Pass accountId through handlers
- `.env.example` — No changes needed yet

That's it. Everything else stays the same until Phase 2.
