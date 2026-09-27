# Watchtower — Build Status
_Updated 2026-09-27 (v1.6 — deployed + verified live on Railway) · working name = "Watchtower"; real name = "Dunn"_

## What's Built

**Location:** `~/Desktop/watchtower/`

**Stack:** Node 24 + TypeScript + Express + Stripe SDK + Prisma 6 (Postgres 16, local) + Resend (email). Railway-ready.

**Files:**
- `src/index.ts` — Express app; webhook route (raw body), health check, auth middleware, invoices + reports + templates + settings + clients + inbound routers, static form at `/`
- `src/routes/settings.ts` — **NEW (v0.9):** GET/PUT /settings (owner email, alert toggles for fee-approval/overdue/payment), GET /settings/status (Stripe connection state for onboarding)
- `src/routes/clients.ts` — **NEW (v0.9):** GET /clients (per-client lateness: late count, avg days late, fees paid, open balance)
- `src/routes/templates.ts` — Recurring invoice CRUD. POST/GET/PATCH/DELETE /templates. PATCH handles skip-to-next-cycle on resume.
- `src/services/templateEngine.ts` — Template → invoice creator cron job. Tracks sentCount, lastRunOk, lastError. skipToNextCycle() for paused→resume.
- `src/services/emailRenderer.ts` — **NEW (v1.0):** Handlebars HTML email rendering. Caches 8 templates, maps invoice data to designer's variable names, extracts subject from `<title>`. Templates in `src/email-templates/`.
- `src/middleware/auth.ts` — Bearer token auth gate.
- `src/routes/invoices.ts` — Dashboard API + invoice creator + **NEW (v0.9):** POST /invoices/:id/waive with optional note field
- `src/routes/reports.ts` — **UPDATED (v1.3):** reports endpoint returns per-client breakdown + month-by-month trend with per-client data. CSV download at /reports/revenue.csv includes per-client rows per month.
- `src/services/reminderEngine.ts` — **UPDATED (v1.0):** sends HTML emails from Handlebars templates instead of plain text. Sends text fallback. Configurable MASCOT_URL env var.
- `public/index.html` — **NEW (v1.2):** Designer's full landing/marketing page. Root route serves this to visitors.
- `public/create.html` — Invoice form (modal-style, dark fee panel, fee preview, returning-client notice). Linked from dashboard's "Create new invoice".
- `public/dashboard.html` — **NEW (v1.1):** full dashboard (KPI cards, fees awaiting approval with approve/waive, invoice list with 5 statuses, filters, search). Loads api.js.
- `public/recurring.html` — **NEW (v1.1):** recurring invoices list (active/paused, failure banner, delete confirmation, new/edit modal form). Loads api.js.
- `public/onboarding-success.html` — **NEW (v1.1):** post-Stripe-connect success screen. Loads api.js.
- `public/api.js` — **NEW (v1.1):** API connector. Fetches all data, binds to data-bind elements, renders data-list templates, handles wt:* custom events. Works with watchtower-ui.js.
- `public/watchtower.css` — **NEW (v1.1):** complete design system (colors, fonts, radii as CSS variables).
- `public/watchtower-ui.js` — **NEW (v1.1):** UI behavior (tabs, modals, waive note, next-date calculation). No API calls.
- `public/lighthouse-transparent.png` — **UPDATED (v1.1):** transparent mascot for emails and dark backgrounds.
- `public/login.html` — **NEW (v1.3):** sign in / create account page. JWT-based auth, redirects to dashboard. Matches designer's design system.
- `src/routes/auth.ts` — **UPDATED (v1.3):** Stripe OAuth (start/callback) + email/password login + signup + session check. Issues JWTs, stores passwordHash on Account.
- `src/lib/account.ts` — **NEW (v1.6):** shared `resolveAccountId(req)` + `getAccount(req)` — resolve the signed-in account from the JWT cookie/Bearer, replacing the old single-account `findFirst()` across the whole API (settings, clients, templates, invoices, reports, billing).
- `src/routes/billing.ts` — **NEW (v1.6):** subscription billing. GET /billing/status (plan + renewal), POST /billing/checkout (Stripe Checkout for solo/business), POST /billing/portal (Billing Portal). Maps Stripe price IDs to plans via STRIPE_PRICE_SOLO / STRIPE_PRICE_BUSINESS.
- `src/routes/webhook.ts` — **UPDATED (v1.6):** +3 subscription handlers (checkout.session.completed, customer.subscription.updated, customer.subscription.deleted) writing subscription state back to the Account.
- `prisma/schema.prisma` — **UPDATED (v1.3):** added passwordHash field on Account model.
- `prisma/schema.prisma` — **UPDATED (v1.6):** Account subscription-billing fields (stripeCustomerId, plan, stripeSubscriptionId, subscriptionStatus, currentPeriodEnd, cancelAtPeriodEnd).
- `src/routes/auth.ts` — **UPDATED (v1.6):** signup requires `businessName`; OAuth callback links to the signed-in account (no more orphan account); callback redirects to `/onboarding-success.html` with counts.
- `src/routes/settings.ts` — **UPDATED (v1.6):** PUT accepts `businessName` (the client-facing email sender name).
- `src/services/invoiceCreator.ts` — **UPDATED (v1.6):** takes `accountId`; enforces the 10-invoice/mo cap on the Solo tier (`plan_limit`).
- `src/services/reminderEngine.ts` — **UPDATED (v1.6):** blank-guards on `businessName` (skips send + flags owner once).
- `research-invoicing-statistics.md` — **NEW (v1.2):** late payment statistics, market data, pain point research (10+ sources)
- `research-pain-point-validation.md` — **NEW (v1.2):** maps Dunn's features to documented small business pain points
- `nsf-sbir-strategy.md` — **NEW (v1.2):** strategy memo for NSF SBIR Phase I pitch
- `nsf-sbir-pitch-draft.md` — **NEW (v1.2):** draft Project Pitch for NSF SBIR Phase I (~$275K)
- `public/glance.html` — **NEW (v1.4):** rough at-a-glance widget (overdue count, collected, fee revenue, due soon). For designer to polish.
- `src/services/notify.ts` — **UPDATED (v1.4):** added `notifyEscalation()` — actionable owner email at T+14 asking "send another reminder or call?"
- `prisma/schema.prisma` — **UPDATED (v1.4):** `escalateAction` field on Invoice (null | "send_reminder" | "owner_calling")
- `src/routes/invoices.ts` — **UPDATED (v1.4):** added `POST /invoices/:id/escalate` and `GET /invoices/escalations`
- `src/services/reminderEngine.ts` — **UPDATED (v1.4):** at T+14, asks owner instead of auto-sending client email
- `railway.json` — **NEW (v1.1):** build/deploy/cron config for Railway (daily templates job at noon ET)
- `src/email-templates/` — **NEW (v1.0):** 8 Handlebars email templates from designer.
- `src/services/emailRenderer.ts` — **NEW (v1.0):** Handlebars HTML email rendering.
- `public/lighthouse-transparent.png` — **NEW (v1.0):** transparent-background mascot for emails (278×454).
- `prisma/schema.prisma` — Settings (alert toggles), Invoice (waiveNote, updatedAt), InvoiceTemplate (sentCount, lastRunOk, lastError).

**Verified (2026-09-23):**
- `tsc --noEmit` clean
- Postgres 16 running locally (brew service); migrations applied
- Server boots, `/health` ok
- **Stripe Standard OAuth enabled** — connected test account via OAuth flow
- **Full end-to-end loop verified** — invoice created via form ($250, due Oct 24, $25 late fee) → webhook mirrored into DB → reminder + fee engines run cleanly
- **Resend domain getdunn.org verified** — DNS records added via Cloudflare auto-configure, domain green in Resend
- **Real email delivery working** — test email sent from `reminders@getdunn.org` received at bashira.webb@gmail.com
- `MAIL_FROM`, `SENDING_DOMAIN`, and `RESEND_API_KEY` set in `.env`
- `npm run job:reminders` and `npm run job:fees` scripts added to package.json

**Verified (2026-08-24):**
- `tsc --noEmit` clean
- Postgres 16 running locally (brew service); `watchtower` DB created; migration `20260821023000_init` applied
- Server boots, `/health` ok
- `GET /` serves the form; `/lighthouse.png` serves (200, image/png)
- `GET /invoices/status` → `{stripeConfigured:false, accountConnected:false, ...}` (key is a placeholder)
- `POST /invoices` with a valid body → clean 503 `not_configured` (no crash); invalid bodies → proper 400s
- `GET /invoices` dashboard still returns `{"invoices":[],"clientLateness":{}}`

**Live Stripe path NOT yet verified** — needs a test connected account (step 4). All creds are wired: secret key, Connect client_id + redirect_uri, webhook secret. The webhook route is FIXED (see below) and the pipeline returns 200.

**BUG FIXED 2026-08-29 — webhook 404:** `src/index.ts` mounted the webhook with `app.post('/webhooks/stripe', ...)`, but `webhookRouter` defines its handler at `post('/')`. Express called the router against the full path, so `/` never matched → every webhook returned `Cannot POST /webhooks/stripe` (404). Fix: `app.use('/webhooks/stripe', express.raw(...), webhookRouter)` (one line). Verified with `stripe trigger invoice.created` → 200.

**Stripe test setup (2026-08-29):** platform = Defiance Media LLC (existing account, test mode). `.env` now has `STRIPE_SECRET_KEY` (sk_test), `STRIPE_CLIENT_ID` (ca_), `STRIPE_REDIRECT_URI`, `STRIPE_WEBHOOK_SECRET` (whsec from `stripe listen`). Stripe CLI installed (brew, v1.50.6), authed to the **Test mode** environment. Connect business model = **Platform**.

## The Fee Design (locked)
- Per-invoice fee prompt at creation: flat $, % , or 0 (user's choice, per client/job)
- Fee written into invoice terms; agent enforces after grace period (default 7 days, configurable)
- Pattern B (separate fee invoice) for v1; Pattern A (fee hidden in draft) is v1.1
- Owner-approval gate: autoApplyFees off by default → fees get logged as "pending approval" until owner opts in

## What's NOT Built Yet (next steps)
1. ✅ **Recurring invoices** — DONE 9/24/26: InvoiceTemplate model, CRUD routes at /templates, template engine, cron job (npm run job:templates), 15 tests. Designer needs UI (templates page + "set as recurring" toggle).
2. **Dashboard frontend** — being built by designer. Cards need to match: overdue count, collected this month, fee revenue, pending fees. Invoice list needs fee-applied status. Waive needs optional note field. Remove duplicate invoice form.
3. ✅ **Test connected account + full-loop verification** — DONE 9/23/26
4. ✅ **Resend domain** — DONE 9/23/26: getdunn.org verified, email sending live
5. ✅ **Reminder → payment link** — DONE 9/2/26
6. ✅ **Tests** — DONE 9/24/26: 48 vitest tests (27 reminder math + 6 auth + 15 template schedule), all passing
7. ✅ **Inbound replies** — DONE 9/23/26: Svix signature verification wired, RESEND_WEBHOOK_SECRET set in .env
8. **Fee pending-approval UI** — part of dashboard (designer)
9. ✅ **Auth/sessions** — DONE 9/24/26: bearer token middleware
10. ⚠️ **Subscription billing** — CODE DONE 9/26/26: billing route + subscription webhooks + Account fields built, typecheck + tests green. REMAINING (config): create $39/$59 Stripe products/prices, set STRIPE_PRICE_SOLO/STRIPE_PRICE_BUSINESS, wire "Start watching" buttons (designer), add JWT_SECRET to local .env.

## Honest Status
**Watchtower (Dunn) v1.6 is DEPLOYED + VERIFIED LIVE (9/27/26).** All backend APIs built and tested (48 passing). All designer screens wired. Auth live (email/password + Stripe OAuth). Runs on Railway: project "carefree-education" / service "valiant-miracle" under bashira.webb@gmail.com, at https://valiant-miracle-production-16b0.up.railway.app. DB migrated (all 10 migrations — the DB was empty before 9/27; a `prisma migrate deploy` step now runs on every deploy). Node pinned to 24 (.nvmrc + engines). Subscription billing code built, inert pending Stripe price IDs.

**Remaining (credentials + domain — no code left):**
1. New Resend API key (old revoked) → `RESEND_API_KEY`
2. Stripe $39/$59 price IDs → `STRIPE_PRICE_SOLO` / `STRIPE_PRICE_BUSINESS`
3. Stripe webhook endpoint + secret → `STRIPE_WEBHOOK_SECRET`
4. Stripe OAuth redirect URI for the prod URL
5. Point getdunn.org at Railway
6. Switch to live Stripe keys when ready for real payments