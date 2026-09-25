# Watchtower — Handoff Sheet
_Last updated: 2026-09-25 (v1.4 — notification escalation + extension + widget) · working name = "Watchtower"; real name = "Dunn" (accounting term). Keep calling it Watchtower in code/docs until the domain is bought._

---

## ▶ STATUS — v1.4 ALL BUILD DONE. EXTENSION BUILT. READY TO DEPLOY.

**What exists:** Everything. Invoice creator, pre-due reminders, late-fee engine with owner-approval gate, per-invoice fee prompts, inbound client replies, recurring invoice templates, dashboard (KPI cards + invoice list with 5 statuses + fee approval), settings (owner email + 3 alert toggles), per-client lateness view, reports (revenue + CSV export), HTML email templates (8 Handlebars, designer-delivered), Stripe Connect OAuth, bearer token auth, 48 passing tests, Railway deploy config with cron. Landing page (designer prototype) at /. Login/signup page at /login. Dashboard protected behind JWT auth. Pain point validation research + NSF SBIR pitch drafted.
- **Location:** `~/Desktop/watchtower/`
- **Stack:** Node 24 + TypeScript + Express + Stripe SDK + Prisma 6 (Postgres 16, local) + Resend (email). Railway-ready.
- **Verified (2026-08-29):** `tsc --noEmit` clean · server boots · `/health` ok · `/invoices/status` now returns `stripeConfigured:true` · OAuth start URL builds correctly with the real client_id · webhook pipeline returns 200 (was 404 — see bug fix below).
- **`.env` now contains (all TEST mode):** `STRIPE_SECRET_KEY` (sk_test), `STRIPE_CLIENT_ID` (ca_), `STRIPE_REDIRECT_URI`, `STRIPE_WEBHOOK_SECRET` (whsec, from `stripe listen`). Plus existing `DATABASE_URL`/`PORT`/`RESEND_API_KEY`/`APP_URL`.
|- **Stripe Standard OAuth is ENABLED (confirmed by user).** Test OAuth flow worked end-to-end in v1.3.

## The Product (locked decisions — do not drift from these)
- **Tagline (locked 8/21/26): "We keep watch so you don't have to."** The whole pitch in one sentence — the lighthouse keeps watch so the ships don't have to, Watchtower keeps watch so the owner doesn't have to chase.
- **Mascot (locked 8/21/26): the lighthouse.** Hand-drawn sketch / tattoo-flash style: bold black ink linework, red-and-white striped tower, kind face, tiny waves + sailboat at base, warm glowing lantern, small flag on top. Black ink with sparse red/gold accents, white background, no ground shadow. Drafts: ~/Desktop/watchtower-mascot-dude.png (rejected) and ~/Desktop/watchtower-mascot-lighthouse.png (WINNER). Deliberately NOT TIB style — this brand is sketch/tattoo, not Sanrio-kawaii. Mascot must appear in reminder emails (warm, never threatening) + dashboard logo.
- **Mascot final (locked 8/21/26, night): WOODCUT version won.** ~/Desktop/watchtower-mascot-v5-woodcut.png (original, with boat) → ~/Desktop/watchtower-mascot-v5-woodcut-noboat.png (FINAL, boat removed, regenerated same style). Animation: ~/Desktop/watchtower-lighthouse-beam.gif (12-frame rotating beam + lantern pulse, 344KB — good for web; need an email-size <150KB version before using in reminder emails).
- **Price: tiered (locked 9/23/26).** $29/mo Solo (up to 10 invoices/mo), $49/mo Business (unlimited). One late fee applied covers the month — the dashboard must show recovered money ("Watchtower recovered $X this month") to make the price self-evident. Solo undercuts Stripe Dunning Pro's $29 entry; Business targets the agency segment.
- **The wedge:** reminders BEFORE the invoice is late (nobody else does this — Stripe's built-ins are due/past-due only, ChaseAI chases only after overdue).
- **Stripe does the invoice; we are the front door + the brain.** User creates the invoice in OUR form (with the fee prompt), we hand it to Stripe via API. Stripe stores, sends, collects. We watch, remind, fee, and keep the proof.
- **The fee prompt (Bashira's design, the heart of the product):** at invoice creation, the owner is asked "if not paid in N days, what's your late fee?" — flat $, %, or $0/none, per invoice per client. Fee is written into the invoice terms the client sees. Never a surprise, never a global-only setting.
- **Late fee mechanics:** Pattern B for v1 — after grace period (default 7 days), create a SEPARATE Stripe invoice for the fee, finalize + send. Pattern A (fee hidden in draft) is a v1.1 upgrade.
- **Owner-approval gate:** autoApplyFees is OFF by default — fees get logged as "pending approval" until the owner opts in. Never silently charge a client.
- **Guardrails:** fee only if the owner set one (per-invoice terms); fee % configurable (state-law caps respected); we never touch money (Stripe is merchant of record — no money-transmission regulation); reminder emails stay warm, never debt-collector.
- **Stripe-only path (locked 9/23/26):** Launch requires a Stripe account. OAuth flow handles signup for new users (create one in 2 minutes). No manual/check/PayPal mode until customers ask for it.
- **The dashboard differentiator:** the "who's always late" per-client lateness view (how often + how many days late each client is). API already returns it.

## What's Built
- `src/index.ts` — Express app; raw-body webhook route, health, auth + invoices routers, static form at `/`
- `src/routes/webhook.ts` — Stripe webhook handler: invoice.created / finalized / paid / payment_failed → mirrors invoices + clients into DB, writes audit events. (Note: matches account via `findFirst()` — single-account assumption; skips invoices we create ourselves via `metadata.watchtower=true` so the creator endpoint is the mirror, avoiding double-audit.) **Now records late-fee payments: a paid invoice carrying `metadata.parent_invoice` stamps `feeStatus:'paid'` + `feePaidAt` on the parent invoice.**
- `src/routes/reports.ts` — **NEW: revenue rollup + bookkeeper export.** `GET /reports/revenue?month=YYYY-MM` → money in, late-fee revenue, total collected, invoice/fee counts, avg days to pay a fee (THIS MONTH), avg days late (THIS MONTH), per-client breakdown, 12-month trend. `GET /reports/export.csv?month=YYYY-MM` → CSV (Date, Client, Description, Type, Amount, Status) with invoices + late fees as separate rows, for QuickBooks/Xero/Wave import.
- `src/routes/auth.ts` — Stripe Connect OAuth (start + callback) for connecting a user's Stripe account
- `src/routes/invoices.ts` — dashboard API (GET /invoices: list + per-client lateness) **+ invoice creator (POST /invoices) + setup status (GET /invoices/status)**
- `src/services/invoiceCreator.ts` — **the creator's brain: takes the form input (client, amount, due date, fee prompt), creates the Stripe invoice under the connected account (customer → draft → line item → finalize → best-effort send), mirrors client + invoice + fee policy into DB, writes the audit event. `stripeConfigured()` returns a clean "not configured" guard instead of throwing.**
- `src/services/reminderEngine.ts` — the agent's clock: T-7 / T-3 / due / T+3 / T+7 / T+14 schedule, template emails, dedupe (never double-sends a step), audit logging, dry-run mode (works without RESEND_API_KEY)
- `src/services/feeEngine.ts` — Pattern B late-fee: after grace, creates a separate Stripe invoice (flat or %), finalizes + sends, owner-approval gate. **Now also writes `feeAmountCents`, `feeIssuedAt`, `feeDueDate`, `feeStatus:'open'` to the parent invoice so fee revenue is trackable.**
- `src/jobs/run.ts` — manual/cron job runner: `npm run job:reminders` / `npm run job:fees` / both
- `public/index.html` + `public/lighthouse.png` — **the invoice creator form (self-contained, no build step): client name/email, amount, due date, and Bashira's fee prompt ("If not paid within N days of the due date, what's your late fee?" → no fee / flat $ / %), warm on-brand styling with the woodcut lighthouse.**
- `prisma/schema.prisma` — Account / Client / Invoice / FeePolicy / Reminder / AuditEvent / Settings / **Reply**. **Invoice now carries fee-tracking fields (`feeAmountCents`, `feeIssuedAt`, `feeDueDate`, `feeStatus`, `feePaidAt`) + `repliedAt` (pauses reminders). Settings carries `ownerEmail`.**
- `src/services/notify.ts` — **NEW: owner-alert + email helpers.** `notifyOwner()` resolves the owner inbox (Settings.ownerEmail → Account.email), `mailFrom()` + `replyToFor()` give every email the right from/reply-to.
- `src/routes/inbound.ts` — **NEW: inbound Resend webhook.** A client reply arriving at `reply-<invoiceId>@<domain>` is matched to the invoice, the full body fetched (webhook carries metadata only), stored as a `Reply`, `repliedAt` set (pauses reminders), and the gist forwarded to the owner.
- `src/services/reminderEngine.ts` — **now sends with per-invoice reply-to, skips invoices with `repliedAt` set, and alerts the owner on past-due (T+7+) reminders.**
- `src/services/feeEngine.ts` — **now alerts the owner on fee-pending-approval AND fee-applied.**
- `src/routes/webhook.ts` — **now alerts the owner on invoice-paid AND fee-paid.**

## NEXT SESSION — the build order
1. ✅ **The invoice CREATOR form** — DONE
2. ✅ **Stripe test-mode setup** — DONE
3. ✅ **Test connected account + full-loop verification** — DONE 9/23/26
4. **Dashboard frontend** — being built by designer. APIs ready: GET /invoices (paid/late view), GET /reports/revenue (money-in + fee revenue), GET /reports/export.csv (bookkeeper export). Include fee pending-approval UI (approve/waive flagged fees). Designer has notes on the fee prompt fields.
5. ✅ **Real sending domain** — DONE 9/23/26: getdunn.org verified in Resend, email sending from reminders@getdunn.org
6. ✅ **Inbound webhook signature verification** — DONE 9/23/26: Svix verification with RESEND_WEBHOOK_SECRET
7. ✅ **Auth/sessions** — DONE 9/24/26: bearer token middleware, tests passing
8. ✅ **Tests** — DONE 9/24/26: 48 tests (reminder math + auth + template schedule)
9. ✅ **Recurring invoices** — DONE 9/24/26: full backend + designer UI wired
10. ✅ **Dashboard, onboarding, emails** — DONE 9/24/26: all designer screens integrated
11. ✅ **Settings, clients, waive, reports** — DONE 9/24/26: all API gaps closed
12. ✅ **Deploy config** — DONE 9/24/26: railway.json with cron for daily templates job
13. **Multi-business / accountant seat** — growth feature, not a ship-blocker.

## DEPLOY (v1.4 — extensions built, ready to ship)

1. `railway link` this project to your Railway account
2. Set these in Railway env vars — copy from `.env`:
   - `PORT`, `DATABASE_URL` (Railway Postgres), `STRIPE_SECRET_KEY` (live), `STRIPE_CLIENT_ID`, `STRIPE_REDIRECT_URI` (production URL), `RESEND_API_KEY`, `MAIL_FROM`, `SENDING_DOMAIN`, `APP_URL` (production URL), `API_TOKEN` (generate one), `MASCOT_URL` (production URL + /lighthouse-transparent.png)
3. Set `NODE_VERSION=24` in Railway env
4. Push → Railway builds from `railway.json` and deploys
5. Set `NODE_ENV=production` if needed for Stripe live mode
6. The cron job in railway.json runs daily templates at noon ET

## All backend APIs built. All designer screens wired. Ready to ship.

**API endpoints ready:**
- `GET /templates` — list all templates
- `POST /templates` — create template (clientName, clientEmail, amount, frequency, customDay, startDate, fee, dueDays, graceDays)
- `PATCH /templates/:id` — update any field, including `active` (pause/resume)
- `DELETE /templates/:id` — delete (does not affect past invoices)

**Template fields:**

| Field | Type | Notes |
|-------|------|-------|
| Client name | text | |
| Client email | email | |
| Amount | number ($) | |
| Fee prompt | flat $ / % / none | same as invoice form, with grace days |
| Frequency | dropdown | Monthly / Biweekly / Weekly / Custom |
| Custom day | number 1-28 | only shown when Frequency = Custom |
| Next invoice date | date | calendar picker, defaults to today |
| Due days | number | how many days after creation the invoice is due (default 30) |
| Status | toggle | Active / Paused |

**Templates list page:**
- Client name + amount
- Frequency + next invoice date
- Last invoice date + status
- Status badge (Active / Paused)
- Actions: Edit, Pause/Resume, Delete

**Where the "set as recurring" option lives** — two approaches:
- (A) Toggle on the invoice form that expands to frequency settings. When checked, saves as template instead of sending immediately.
- (B) Separate Templates page with "New template" button. Invoice form stays for one-offs only.

**Edge cases:**
- Template failure (Stripe error) logs audit event + alerts owner, stays active, retries next cycle.
- Delete does not affect invoices already created.
- Changing template amount only affects future invoices.
- To stop a template, set status to Paused — no data loss, can resume later.

## DONE (9/24/26)
- **Recurring invoices:** New `InvoiceTemplate` model (Prisma), CRUD routes at `/templates`, template engine (`src/services/templateEngine.ts`) with UTC-safe schedule math, cron job (`npm run job:templates`), 15 tests covering monthly/weekly/biweekly/custom schedule, short-month clamping, year wraparound.
- **Auth/sessions:** bearer token middleware (`src/middleware/auth.ts`). Set `API_TOKEN` in `.env` to protect `/invoices`, `/reports`, `/webhooks/resend/inbound`. Unset = open for local dev. `/health`, `/auth`, `/webhooks/stripe`, and static files stay open. 6 vitest tests covering all cases.
- **Tests:** Vitest installed, vitest.config.ts created, `npm run test` / `npm run test:watch` scripts added. Pure functions extracted from reminderEngine.ts. **Total: 48 tests, all passing.**

## DOMAIN + RESEND SETUP — checklist (domain bought: getdunn.org)

Credentials: Resend/ngrok login = bmwxcf@gmail.com.

Domain is owned. These are the steps to get email actually flowing, in order.

1. In Resend → **Domains** → **Add Domain**, enter `getdunn.org`.
2. Resend shows DNS records to add. In your domain registrar's DNS panel, add exactly what it lists — typically: an SPF `TXT` record, a `TXT` for DKIM (usually two CNAME or TXT rows), and a custom return-path `MX`/`CNAME`. Copy them verbatim; a single typo fails verification.
3. Click **Verify** in Resend. Wait for green (DNS can take a few min to hours; Resend's check is manual re-click, no auto).
4. Once green, set in `.env`:
   - `MAIL_FROM="Dunn <reminders@getdunn.org>"`
   - `SENDING_DOMAIN="getdunn.org"`
5. Send a test email from the Resend dashboard to yourself — confirms real delivery, not just DNS.
6. For inbound replies: in Resend → Domains → `getdunn.org` → enable **Inbound**, set the destination to `http://localhost:4000/webhooks/resend/inbound` (dev) — note localhost inbound needs a tunnel (e.g. `ngrok`) since Resend can't reach a local port. Capture the signed webhook secret → `/webhooks/resend/inbound` signature check (step 6 from next-session).
7. Agent does next: wire `.env`, start the inbound signature check, then run the first real end-to-end email test.

## Known Gaps / Honest Notes
- **FIXED 9/23/26 — Inbound was placeholder-only.** The inbound route had no signature verification (TODO comment) and no sending domain. Now: getdunn.org verified, RESEND_WEBHOOK_SECRET set, Svix signature verification implemented, ngrok tunnel running.
- **FIXED 9/2/26 — reminder emails made a false fee statement.** T+7/T+14 copy hard-coded "the late fee has been applied" even when autoApplyFees was off and nothing was charged. `buildFeeClause()` now reads actual state: applied → "has been applied", pending → "may be added", none → omitted.
- **FIXED 9/2/26 — voided / uncollectible / deleted invoices kept getting reminders.** `webhook.ts` now handles `invoice.voided`, `invoice.marked_uncollectible`, `invoice.deleted` (each sets the row status so the reminder engine drops it) and `invoice.updated` (re-anchors the due date on edits/extensions).
- **FIXED 9/2/26 — reminder offset sign was INVERTED (pre-existing, found while doing 1.3).** `reminderEngine.ts` computed `offset = dueDay - today`, which is positive BEFORE the due date — so a "7 days before due" reminder actually matched the `t+7` "now past due" step and vice-versa. The schedule was firing on the wrong side of the due date. Now `offset = today - dueDay`, matching the "negative = before due" convention. Verified with a logic harness across all six steps plus catch-up and the T-3 suppression.
- **FIXED 9/2/26 — reminder job skipped a step forever if cron missed a day.** Replaced the exact-match `SCHEDULE.find(s => s.offsetDays === offset)` with catch-up logic: for each invoice, find the latest scheduled step whose day has arrived and hasn't been sent, send exactly one step per run. Also skips a pre-due reminder landing within 2 days of invoice creation (`MIN_DAYS_AFTER_CREATE`).
- **FEE MEMORY (3.2) DONE 9/2/26** — "take the headache away" feature. `/invoices/fee-default?email=…` returns the client's last-used fee terms; the invoice form fires it on email blur and prefills the fee prompt. Owner never re-answers the same fee for a repeat client.
- **CONFIRMATION GLANCE DONE 9/2/26** — the Stripe OAuth callback now renders a one-tap page ("We'll send reminders as [Business]. Looks right — create an invoice") instead of a bare "Stripe connected!" string. Wrong name is fixed in Stripe, not in an onboarding form.
- **1.5 DONE (pending domain)** — `clientMailFrom()` puts the business name in the From line ("Hudson & Co. via Dunn") and appends a "Sent on behalf of [Business] by Dunn." footer to client emails. Body signature + chair-holder already used the business name (9/2/26); this completes the trust surface. Blocked on the real sending domain for actual delivery, same as all outbound email.
- **INBOUND IS PLACEHOLDER-ONLY UNTIL THE DOMAIN LANDS.** The reply-to addresses use `SENDING_DOMAIN` (currently `your-domain.com`), so no real reply can reach us yet. The webhook signature check is also skipped. This whole feature is code-complete but inert until step 5 (domain) + step 6 (signature).
- **WEBHOOK ROUTE BUG — FIXED 8/29/26:** the webhook was mounted with `app.post('/webhooks/stripe', ...)` in `src/index.ts`, but `webhookRouter` defines its handler at `post('/')`. Express called the router against the FULL path, so the router's `/` never matched → every webhook returned `Cannot POST /webhooks/stripe` (404). Fix: `app.use('/webhooks/stripe', express.raw(...), webhookRouter)` (one line). Verified: `stripe trigger invoice.created` now returns 200 and the signature verifies. Auth + invoices routes already used `app.use`, which is why only webhooks 404'd.
- **Stripe Connect OAuth client_id + redirect_uri were MISSING from `.env`** — added 8/29/26 (`STRIPE_CLIENT_ID`, `STRIPE_REDIRECT_URI`). The auth route reads both and would have sent `undefined` to Stripe. Fixed before first live OAuth attempt.
- **Reminder → payment link is a placeholder** (`https://pay.stripe.com/invoice/{id}` — not the real hosted URL). Fix at step 5 (creator already returns the real `hosted_invoice_url` — just needs storing + swapping).
- **Webhook account matching is single-account** (`findFirst()`). Fine for v1 (one business using it), wrong for multi-tenant.
- **No auth/sessions yet** — the API is open. Needed before any real deployment.
- **Invoice creator is code-complete but the live Stripe path is unverified** — now that test creds + webhook are wired, it needs a test connected account (step 4) to exercise customer create / invoice create / finalize / send under Connect. Expect possible tweaks (e.g. `send_invoice` email settings) on first live run.
- **Prisma 7 gotcha (solved):** Prisma 7 moved DATABASE_URL out of schema.prisma; we pinned `prisma@6` + `@prisma/client@6` (6.19.3) which uses the classic config. Do NOT bump Prisma to 7 without porting the config.
- **No tests yet.** The reminder schedule math (day offsets) is the highest-value unit test to add first.

## Stripe Test Setup — what's wired (2026-08-29)
- **Platform account:** Defiance Media LLC (existing Stripe account, not a new one). Test mode ON.
- **Secret key** (`sk_test_...`) → `.env` `STRIPE_SECRET_KEY`. Verified server reads it (`stripeConfigured:true`).
- **Connect:** platform business model = **Platform** (not Marketplace). OAuth client_id (`ca_...`) → `.env` `STRIPE_CLIENT_ID`. Redirect URI `http://localhost:4000/auth/stripe/callback` → `.env` `STRIPE_REDIRECT_URI`.
- **Stripe CLI:** installed via `brew install stripe/stripe-cli/stripe` (v1.50.6). Authed via `stripe login` → chose the **Test mode** environment (NOT the isolated "Defiance Media LLC sandbox" and NOT Live). CLI active account = `acct_1TmQ1ERve8cRy3m3` (matches the sk_test key's account).
- **Webhook secret:** `stripe listen --forward-to http://localhost:4000/webhooks/stripe` → `whsec_...` written to `.env` `STRIPE_WEBHOOK_SECRET`. (Dev-only: the whsec regenerates each `stripe listen` session — re-run listen and update .env when starting fresh.)
- **NEXT:** create a test connected account (email must differ from platform email) → run OAuth at `/auth/stripe/start` → create an invoice via the form → watch webhook mirror + reminders + fee.

## How to Run
```bash
cd ~/Desktop/watchtower
npm run dev            # tsx watch — server on :4000
npm run job:reminders  # run the reminder sweep once
npm run job:fees       # run the fee sweep once
npm run job:templates  # check and fire due recurring invoices
```
- Postgres must be running (`brew services start postgresql@16`).
- `.env` exists locally with placeholders for Stripe keys; real keys needed for live calls.

## Research Trail (the why)
- `~/Desktop/research-hated-tasks-ai-agents.md` — the annoyance economy, why this category
- `~/Desktop/research-invoice-collections-agent.md` — market validation, competitors, the gap
- `~/Desktop/research-chaseai-deepdive.md` — ChaseAI analysis: no payment integration, no pre-due mode, no late fees, no trail — our spec beats it on every axis
- `~/Desktop/invoice-agent-build-scope.md` — the original build plan (Pattern A/B, guardrails, decisions)
- `~/Desktop/watchtower/BUILD_STATUS.md` — build log
