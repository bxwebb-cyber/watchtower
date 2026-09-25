# Watchtower (Dunn) — Product Review
_Written 2026-09-01 by Claude (fable 5.1). Independent read of every file in `src/`, `prisma/`, `public/`, plus HANDOFF.md, BUILD_STATUS.md, and the design brief. No code was changed._

_Audience: Bashira + a second agent (DeepSeek) who will act on these. Each item says WHAT, WHY it matters to the product, WHERE in the code, and a suggested fix. Items are tagged:_
- **[BUG]** — it doesn't do what the docs say it does
- **[TRUST]** — the client or owner would lose confidence
- **[PRODUCT]** — a feature/positioning gap
- **[GROWTH]** — distribution / pricing / accountant channel

---

## 0. The one-paragraph verdict

The brain is real and the locked decisions are right: pre-due reminders, per-invoice fee prompt, owner-approval gate, Stripe holds the money. What's missing is everything the CLIENT sees and everything that happens at the EDGES of the happy path (voided invoices, replies, missed cron days, fee-invoice on the wrong Stripe account). Right now the product is optimized for the owner creating an invoice; it is not yet optimized for the client receiving one — and the client is who decides whether the money comes in. Fix the client-facing surface first, the edge cases second, then the dashboard.

---

## 1. Ship-blockers (these break the promise, not just the polish)

### 1.1 [BUG] The late-fee invoice is created on the PLATFORM account, not the connected account
`src/services/feeEngine.ts` lines 60–77: `stripe.invoices.create(...)`, `invoiceItems.create(...)`, `finalizeInvoice`, `sendInvoice` are all called **without** `{ stripeAccount: invoice.account.stripeAccountId }`. `invoiceCreator.ts` passes it correctly on every call; the fee engine never does. Result on first live run: the customer id (`cus_...`) belongs to the connected account, so Stripe on the platform account will return "No such customer" — every fee errors into `fee_error`. If the customer somehow existed, the fee money would land in Defiance Media's account instead of the business's. This is the heart-of-the-product feature and it can't work as written. `account` is already included in the query (line 15), so the fix is passing the option on four calls.

### 1.2 [BUG] Voided / uncollectible / deleted invoices keep getting reminders
`src/routes/webhook.ts` handles only `invoice.created / finalized / paid / payment_failed`. If the owner voids an invoice in Stripe (common: client disputes, re-issued invoice, typo), our row stays `status: 'open'` and the reminder engine keeps emailing the client "now past due" for a bill that no longer exists. Add `invoice.voided`, `invoice.marked_uncollectible`, `invoice.deleted`, and `invoice.updated` (due-date edits). Reminders on a voided invoice is the single fastest way to lose a client's client.

### 1.3 [BUG] The reminder job skips a step forever if cron misses that exact day
`reminderEngine.ts` line 55: `SCHEDULE.find((s) => s.offsetDays === offset)` — exact-match only. If Railway cron fails one day, or the server is down, or the job runs at 11:59 PM and again at 12:01 AM across a DST shift, the step is simply never sent. Also: an invoice created 5 days before due never gets T-7 (fine) but also gets T-3 the day after the client received the invoice itself (annoying). Suggested logic: find the most recent step whose offset has passed and that hasn't been sent, send only that one (never two in one run), and skip pre-due steps that fall within 2 days of invoice creation.

### 1.4 [TRUST] Reminder emails tell the client a fee "applies" / "has been applied" when it may not have
`reminderEngine.ts` lines 29–32: T+7 body says "a late fee of $X applies" and T+14 says "the late fee has been applied." But `feeEngine.ts` only applies the fee if `autoApplyFees` is on — which is OFF by default. Default-config outcome: the client is told a fee was applied, no fee invoice exists, the owner hasn't approved anything. That's a false statement to a third party under the business's name. The email copy must read from actual state: `feeApplied` true → "has been applied (invoice #…)"; pending → "per the terms, a late fee of $X may be added"; none → omit.

### 1.5 [TRUST] Every client email comes from "Watchtower", not from the business
`notify.ts` `mailFrom()` returns one global sender; `reminderEngine.ts` uses it for client emails. The client has never heard of Watchtower/Dunn. An unknown sender asking for money = spam folder or "is this a scam?" reply. Every reminder should be `From: "<Business name> via Dunn" <reminders@dunn-domain>`, Reply-To per invoice (already built), with the business name in the subject and a one-line footer: "Sent on behalf of <Business> by Dunn — <link to the invoice on Stripe>." This is one function change plus the `Account.businessName` you already store.

### 1.6 [TRUST] Emails are unsigned, unnamed, and show raw Stripe ids
- Body opens "Hi there," — `Client.name` is available on the invoice (line 44 includes client). Use it.
- Body ends "Thanks,\n" and then nothing. No business name. Reads like a broken template.
- Subject: "Heads up — invoice in_1Rx8Kq2eZvKYlo2C… is coming due". Stripe gives every finalized invoice a human `number` (e.g. `HUDSON-0007`). Store `stripeNumber` on the Invoice row at creation/finalize and use it everywhere (subjects, dashboard, CSV).
- Dates render as `2026-09-15` (ISO). A warm email says "September 15."
- The "[pay]" link is the known placeholder (`https://pay.stripe.com/invoice/<id>` is not a real URL). `invoiceCreator.ts` already has `hosted_invoice_url` at line 191 — store it in a `hostedInvoiceUrl` column and use it. Until this is fixed, every reminder sends the client to a dead link, which is worse than no reminder.

### 1.7 [PRODUCT] The invoice has no description of what it's for
`public/index.html` form: client, email, amount, due date, fee. No "What's this for?" field. `invoiceCreator.ts` line 121 writes the line item as `"Invoice for Hudson & Co."`. The client gets a $2,400 invoice from a company with a line item that literally says "Invoice for <their own name>". Ambiguous invoices get questioned, and questioned invoices pay late — which the product is supposed to prevent. Add a required one-line description (and optionally a multi-line-item mode later). Stripe's `invoiceItems.description` is where it goes.

---

## 2. Edge cases that will bite in the first month

### 2.1 [BUG] The owner gets the "fee ready for approval" email every single day
`feeEngine.ts` lines 35–51: when `autoApplyFees` is off, it writes `fee_pending_approval` and emails the owner — and `feeApplied` stays false, so the invoice is picked up again tomorrow, and the next day. Nothing dedupes this. Add a `feePendingAt` timestamp (or check the audit log for an existing `fee_pending_approval`) and alert once, with a gentle 7-day re-nudge at most.

### 2.2 [PRODUCT] "Client replied" pauses reminders forever with no way back
`inbound.ts` line 71 sets `repliedAt`; `reminderEngine.ts` line 43 excludes those rows permanently. A client who replies "thanks, paying Friday" and then doesn't pay has just discovered the mute button. Needed: (a) an owner action "resume reminders", (b) an auto-resume after N days (default 5) with the owner alerted, (c) the owner alert should say "Reminders paused — resume?" with a one-click link. This should be the first row-level action in the dashboard, above fee approval.

### 2.3 [BUG] `Settings.remindT7 … remindT14` toggles exist in the schema and are never read
`prisma/schema.prisma` lines 127–132 define six per-step toggles. `reminderEngine.ts` never queries `Settings`. Either wire them or remove them; dead settings become "the checkbox that doesn't work" support tickets. (Wiring them is also the cheapest way to offer cadence choice — see 3.2.)

### 2.4 [BUG] Reminders fire against server-local midnight; email dates use UTC
`reminderEngine.ts` lines 51–53 normalize to local day; line 79 formats the due date via `toISOString()` (UTC). For a US business this happens to work; for anyone at UTC+ it shifts a day. More important: reminders go out whenever cron fires. A 2 AM reminder reads as automated (which it is) — send in the recipient's morning (9–10 AM in the account's timezone; add `Settings.timezone`). Nobody pays at 2 AM, and the open rate of a 9 AM email is meaningfully higher.

### 2.5 [BUG] Original invoice paid, fee invoice still open — nothing happens
If the client pays the main invoice after the fee invoice was issued, the fee invoice stays open with no reminders (fee invoices are never watched: `webhook.ts` line 57 skips `metadata.watchtower`). Options for the owner should exist: waive it (void the fee invoice), or keep chasing it with the same cadence. At minimum, the "invoice paid" owner alert should say "the $X late fee is still outstanding — waive or keep?"

### 2.6 [BUG] Lateness stats ignore invoices that are late RIGHT NOW
`routes/invoices.ts` lines 100–104: a client counts as late only when `paidAt > dueDate`. An invoice 40 days overdue and unpaid contributes zero lateness. The "who's always late" view should count `open && today > dueDate` as late with `daysLate = today - dueDate`. Same for `reports.ts` `avgDaysLate` (paid-only). Also `take: 200` on the invoice list means the lateness math silently truncates for any real business after ~a year.

### 2.7 [BUG] Partial payments and credit notes aren't modeled
Stripe invoices can be partially paid (`amount_paid < amount_due`, `status` still `open`). The reminder still says "invoice for $2,400" when $2,000 is in. Store `amountPaid` from the webhook and say "remaining balance $400." This is a correctness issue that reads as carelessness to the client.

### 2.8 [BUG] Docs reference `npm run job:reminders` / `job:fees`; `package.json` doesn't define them
`package.json` scripts: dev, build, start, typecheck only. HANDOFF, BUILD_STATUS and the skill file all say `npm run job:reminders`. Either add `"job:reminders": "tsx src/jobs/run.ts reminders"` etc., or fix the docs. Also `typescript: ^7.0.2` in devDependencies — verify that's intentional (HANDOFF says tsc is clean, so presumably yes; just flagging the version jump).

### 2.9 [PRODUCT] Nothing happens after "final notice" (T+14)
The schedule ends at T+14 and the audit trail just… stops. The owner is left holding a late invoice with no guidance. Close the loop: at T+21, email the owner a "Proof pack" (see 3.4) plus three plain options — call the client (with a short script), mark it uncollectible in Stripe, or keep the fee invoice open. Even a "we did our part; here's everything we sent and when" message turns a dead end into a moment where the product proves its value.

---

## 3. Product upgrades — the things that make it a product, not a script

### 3.1 [PRODUCT] Import existing open invoices on Stripe connect (the demo moment)
Right now `auth.ts` stores the account and does nothing else. A business connecting Stripe already has 5–50 open invoices in there. Pull them (`stripe.invoices.list({status:'open'}, {stripeAccount})`) and the empty state becomes: "We found 14 open invoices, $18,240 outstanding, 3 already past due. Want us to start watching them?" That is the design brief's "empty state is the onboarding" done with the user's real money in the first 30 seconds. It also solves the fact that `webhook.ts` only mirrors invoices created after connect, and only if Connect webhooks are configured (note: `stripe listen` needs `--forward-connect-to` to see connected-account events; production needs a Connect webhook endpoint, not an account endpoint — HANDOFF doesn't mention this).

Imported invoices have no fee policy (the prompt only exists in our form) — so step two of onboarding is: "Set a late fee for these? (per client)". Which leads to:

### 3.2 [PRODUCT] Remember fee terms per client; offer a cadence choice per client
The fee prompt is locked as per-invoice, and that's right — but the owner shouldn't retype "$25 after 7 days" for the same client every month. Prefill the prompt with that client's last fee terms (`FeePolicy` rows are already linked via invoice → client). Keep it per-invoice, just pre-filled.

Same for cadence. Six emails in 21 days is "firm." Some clients need "gentle" (T-3, due, T+7) and a big long-standing client needs "quiet" (due, T+14 only). Expose three presets — Gentle / Standard / Firm — stored per client with a per-invoice override, driven by the Settings toggles that already exist (2.3). This is the difference between "an agent that nags my clients" and "an agent that knows my clients."

### 3.3 [PRODUCT] Owner-approve / waive / resume as one-click links in the alert emails
The owner alerts already go out (`notify.ts`). Every alert should carry signed action links (`/actions/<token>`): Approve fee · Waive fee · Resume reminders · Snooze 7 days · Mark as paid offline. The owner then never has to log in for the common decisions — and you get the "pending fee UI" (HANDOFF step 8) for near-zero frontend work, before the dashboard exists. Tokens: HMAC of `invoiceId + action + expiry` with `SESSION_SECRET` (already in `.env.example`).

### 3.4 [PRODUCT] The "Proof pack" — the audit trail as a deliverable
`AuditEvent` + `Reminder` + `Reply` already record everything. Package it: `GET /invoices/:id/proof.pdf` (or a clean HTML page) — invoice terms as the client saw them, every reminder with timestamp and Resend message id, every reply, the fee invoice and when it was sent. This is what an owner attaches to a small-claims filing, forwards to a client who says "I never got a reminder," or hands to their accountant. Nobody in the competitor set (ChaseAI per your research) produces this. It also justifies the price on a bad month when nothing was "recovered" — you still have proof.

### 3.5 [PRODUCT] Define "recovered" honestly before it goes on the dashboard
The design brief makes "Watchtower recovered $X this month" the hero number. `reports.ts` `moneyIn` is every paid invoice — that's not recovery, and a bookkeeper will notice. Define it as: late-fee revenue collected + invoices that were past due and paid within 3 days of a Watchtower reminder (attribution window). Show the honest number big, and "total collected" smaller next to it. An honest small number that grows beats a big number the owner doesn't believe.

### 3.6 [PRODUCT] Owner-side controls that don't exist yet
- Mark as paid offline (check / Zelle / cash). Stripe supports `invoices.pay({paid_out_of_band:true})`. Without it, the client pays by check and keeps getting reminders.
- Change a due date after the fact (extension granted verbally) — needs `invoice.updated` handling (1.2) plus an owner action.
- Snooze an invoice N days (distinct from the client-reply pause).
- Owner email setting (`Settings.ownerEmail`) has no UI or endpoint — right now it can only be set by SQL.

### 3.7 [PRODUCT] Fee guidance in the prompt
The prompt asks "what's your late fee?" and most owners don't know a reasonable answer. Add a one-line hint under the options: "Common: $25 flat or 1.5% — some states cap late fees; check yours." Consider a default suggestion pre-filled based on invoice size (flat $25 under $1k, 1.5% above). Also validate the percent cap you already mention in HANDOFF's guardrails — the route allows 0–100% (`invoices.ts` line 59); a 100% late fee is a legal problem waiting to happen. Cap at something like 10% or 1.5%/month equivalent with an "I understand" override.

### 3.8 [TRUST] Stripe's own reminders + ours = double emails
A connected account with Stripe's "send reminders" enabled (Dashboard → Billing → Invoices) will email the client at Stripe's cadence too. Two systems nagging the same person about the same invoice looks broken. Either detect it (`account.settings.invoices` isn't exposed, so ask at onboarding) or tell the owner plainly at connect time: "Turn off Stripe's built-in reminders — Dunn handles them." One sentence prevents a support thread.

### 3.9 [TRUST] A tiny client-facing page ("why am I getting this?")
Every reminder footer links to `dunn-domain/about-this-email`: "Your vendor <Business> uses Dunn to send invoice reminders. Questions? Reply to the email and it goes straight to them." Three sentences, zero product surface, dramatically less "is this phishing" friction. Include the lighthouse — the brief promised the mascot in emails.

---

## 4. Growth and pricing notes (accountant channel)

### 4.1 [GROWTH] The accountant is the buyer; the product has no accountant seat
Your distribution plan is accountants → their small-business clients. But `Account` is one business, `findFirst()` everywhere, one owner email. An accountant with 12 clients would need 12 logins. Even before multi-tenant auth, the schema should allow a `Firm` that owns many `Account`s, and the owner alerts should be able to CC the accountant. The bookkeeper CSV (`/reports/export.csv`) is a great accountant hook; a monthly "AR health" email per client business sent to the accountant is the retention hook.

### 4.2 [GROWTH] Give the accountant a reason to bring you in: the monthly AR digest
On the 1st of each month, email the owner (and CC the accountant): invoices sent, collected, still open, days-late trend vs. last month, fees recovered, top 3 slowest payers. The data is all in `reports.ts` already. Accountants love being able to forward a thing that makes them look proactive.

### 4.3 [GROWTH] Pricing: $29.99/mo is fine — consider what unlocks it
Your rule is start high, adjust down, so keep $29.99. But the objection from a 3-invoice-a-month business is "I'll try it when I have a late client." Options that keep the price: (a) free while connected but only "watch + remind"; fees and proof packs are paid — the fee prompt converts them; or (b) "first recovered fee is on us" — free until Dunn recovers one late fee, then $29.99. Both make the price feel earned rather than asked. Also: there's no Stripe Billing for Dunn itself yet — the product can't charge for itself. That's fine pre-launch, just don't forget it's a whole subsystem (subscription, trial, dunning for your own dunning tool).

### 4.4 [GROWTH] The wedge is real — make it visible on day one
"Reminders before it's late" is the differentiator you found. The dashboard's first view should be tomorrow-facing: "Due in the next 7 days: 4 invoices, $6,100 — Dunn reminds them Tuesday." That's the thing Stripe and ChaseAI cannot show, and it should be the first thing the owner sees, not a chart.

---

## 5. Security / production hygiene (short, you already know most of it)
- No auth on any route; `GET /invoices`, `/reports/*`, `POST /invoices` are public. Known. Even a single shared bearer token in `.env` would let you deploy to Railway safely for your own use while the real auth is built.
- `inbound.ts` has no Svix signature check — anyone who guesses an invoice id can pause its reminders and inject a "reply." Known, listed in HANDOFF step 6.
- `webhook.ts` returns 200 on handler errors (intentional) but there's no dead-letter — errors are console.log only. Write failures to `AuditEvent` with `event: 'webhook_error'` so they're visible in the trail.
- Webhook handlers aren't idempotent by event id. Stripe retries; `onInvoicePaid` would send the owner two "paid" emails. Store `event.id` in a `WebhookEvent` table and skip duplicates.
- Every service file does `new PrismaClient()` — five clients in one process. Harmless locally; on Railway's small Postgres this eats the connection pool. One shared `db.ts`.
- `.env.example` shows `DATABASE_URL` without the username; the skill file notes it needs `bashirawebb@`. Sync them.
- No tests. Highest value first test (HANDOFF agrees): the reminder offset math with a fake `now`, including the catch-up logic from 1.3.

---

## 6. Suggested order of work (if DeepSeek picks this up)

1. **1.1** fee engine `stripeAccount` (a few lines; the product doesn't work without it)
2. **1.6 + 1.5** store `stripeNumber` + `hostedInvoiceUrl`; From = business name; real client name; sign the email
3. **1.4** email copy reads actual fee state
4. **1.2** handle voided / uncollectible / updated webhooks
5. **1.3** reminder catch-up logic + skip pre-due steps near creation
6. **1.7** description field on the form → Stripe line item
7. **2.1, 2.2** dedupe fee-pending alerts; resume-reminders action
8. **3.3** signed one-click action links in owner alerts (gets you approve/waive/resume without a dashboard)
9. **3.1** import open invoices on connect
10. **2.6, 3.5** fix lateness math; define "recovered"
11. **3.4** proof pack
12. Then the dashboard — with 3.1 and 3.3 done, the dashboard has real data and real actions to show on day one.

Everything in section 3 and 4 is a decision for Bashira, not the agent. Section 1 and 2 are just making the product do what HANDOFF already says it does.
