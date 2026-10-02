# Watchtower — Handoff Sheet
_Last updated: 2026-09-28 (v1.8 — scheduler + one-bill late fees + webhook fix DEPLOYED; scheduler switched OFF in production pending invoice review) · working name = "Watchtower"; real name = "Dunn" (accounting term). Keep calling it Watchtower in code/docs until the domain is bought._

---

## ▶▶ START HERE — SESSION 9/29–9/30 (night). EVERYTHING BELOW IS LIVE on getdunn.org.

**Done tonight (all deployed, Stripe still TEST mode, scheduler still OFF):**
- **Client replies work end to end (verified live):** Resend webhook → getdunn.org; `RESEND_WEBHOOK_SECRET` on Railway; fixed signature check (raw bytes) + body fetch (`emails.receiving.get`). Reply pauses reminders, saved as evidence, owner alerted. Alert's Reply goes straight to the client (`replyTo`). Replies cleaned to just the client's words (`src/lib/replyText.ts`: strips HTML + quoted original).
- **hello@getdunn.org inbox:** any non-`reply-` address forwards to `FORWARD_INBOX_TO` = bmwxcf@gmail.com (set on Railway, verified). Gmail "Send mail as" not set up yet.
- **Pricing:** yearly added (Solo $390/yr, Unlimited $540/yr, toggle on landing; Railway `STRIPE_PRICE_*_YEARLY` set). **$39 plan = up to 5 clients/month, 10 invoices per client** (`planLimits.ts`); warning at 4 and 5 of 5 on the dashboard + "X of 5" in Settings; blocked recurring invoice emails the owner once.
- **Landing:** phone layout (`scripts/phone-layout.cjs`, re-run on designer exports), Monthly/Yearly toggle, "Up to 5 clients" copy, **FAQ (7 Qs, FAQPage schema)**, footer: Guides · Terms · Privacy.
- **Guides (SEO):** `/guides` + 5 pages built by `scripts/guides.cjs` (late fees, reminder templates, client pays late, Dunn vs FreshBooks vs Wave, Net 30). In sitemap.
- **Legal:** `/terms`, `/privacy` (operator: **Defiance Media LLC**, NY law, contact hello@getdunn.org). Not lawyer-reviewed — get a flat-fee review (SCORE / NYC Bar clinic) before real money.
- **Dashboard:** click an invoice → Dunn's own invoice box (amount, due, fee, timeline of emails/replies/fee changes, Download PDF, Copy payment link; `GET /invoices/:id`). **Sign out** link (sidebar). "Manage plan" works (`GET /billing/portal`).
- **Money:** amounts typed with commas parse right (`public/money.js`; "1,500" used to become $1!), boxes format to 1,500.00, and every email/alert/dashboard amount reads $1,500.00 (`src/lib/money.ts`).
- **Bugs fixed:** Stripe connect used to overwrite the owner's email with `unknown@stripe.com` and, when the strict cookie wasn't sent on Stripe's redirect, invent a stray account (no name/password). Now: signed `state` (15 min) identifies the account, cookie is SameSite=Lax, email never touched, stray account's data moves over. Invoice form says "Connect Stripe first" instead of a raw Stripe error. Typed client name wins over the saved one (same email). `trust proxy` so login rate limits are per visitor.
- Tests: 108 passing.

**Bashira's account:** signed-up account is connected to Stripe test; owner email = buhshyruh@gmail.com (Settings → Owner email to change). Old stray account (`unknown@stripe.com`, "Your Business") may still exist in the DB, emptied of its Stripe link — harmless.

**DONE 10/1:** Search Console verified (URL prefix, meta tag in landing.html outer head; property owned by bmwxcf@gmail.com), sitemap submitted (showed "Couldn't fetch" at first — re-submit if it persists). Landing stats: "14 hrs" (mid-sized firms) → "47% of small businesses owed money have invoices 30+ days late", labels tightened, sources linked. Gmail (bmwxcf) can send as hello@getdunn.org via smtp.resend.com. GitHub: remote URL no longer holds a token — pushes use `gh` CLI login (bxwebb-cyber, keyring); old PATs "Hermy Deploy" + "hermy access" deleted (Hermes may need a new token if it pushed anywhere).

**LIVE TEST-MODE CHECKS (before Stripe live):**
- ✅ #1 Client pays an invoice (10/1): WSCZXZZZ-0001 $50 paid with 4242 → connected-account webhooks verified (invoice.paid etc.), owner alert "Invoice paid — WSCZXZZZ-0001 ($50.00)". Proves `STRIPE_WEBHOOK_SECRET_2`.
- ✅ #2 Subscribe (10/1): checkout → founder email "New subscription: Unlimited, monthly" (after the webhook-events fix).
- ◐ #3 Manage plan: portal opens (configured via API, test mode). Switch + cancel not yet confirmed — Bashira didn't click the final Confirm; re-test, expect founder "Cancelled" email.
- ✅ #4 6th client blocked (10/1): "Your plan covers 5 clients a month, and you've invoiced 5 this month…"
- ⬜ #5 Recurring invoice sends on its own (needs SCHEDULER_START ≤ creation date).
- ⬜ #6 Late fee fires automatically (invoice created ≥ Oct 2, short due date).
- ✅ #7 Brand-new user (10/1): sign up with plan → checkout → connect Stripe (test bank) → invoices.

**10/1 later:** Billing fixed — Stripe test webhook (platform) now sends checkout.session.completed + customer.subscription.*; both endpoints send invoice.voided/marked_uncollectible/deleted (**redo this on the LIVE webhooks at launch**). `/billing/confirm` saves the plan from Stripe right after checkout (backup for missed webhooks). invoice.created only mirrors connected-account invoices with a due date onto THAT owner (was: any invoice → first account, bad date). **A plan is required to send invoices** (no free use/trial, Bashira 10/1): `hasActivePlan` (active/trialing/past_due), on in production (`REQUIRE_PLAN=off` overrides), dashboard banner "Choose a plan". All "Start watching"/"Get started" buttons → /#pricing.

**Reports → "Who you waive fees for" (10/1, the third data view in ~/Desktop/gettdunn-product-notes.md):** `GET /reports/waivers` (`src/services/waivers.ts`, 3 tests) — fees waived per month (dated by the waive, from the audit log) as a 12-month strip, and clients ranked by fees waived with "paid late X of Y" (red at ≥50%), how often a fee came due, and the owner's own waive notes. Never guesses the why. Monthly "Fees waived" line now shows the count.

**Founder emails (10/1):** `notifyFounder` → FOUNDER_EMAIL else FORWARD_INBOX_TO (bmwxcf). Sent on new subscription (plan, monthly/yearly, price) and on cancel (the moment they schedule it, with the end date; no duplicate when it actually ends). NOT on sign-up (Bashira: not needed). **Sign-up has its own plan picker** (both plans + Monthly/Yearly, on /login; writes ?plan=&billing= for checkout; Create account blocked until a plan is picked). Cross-page links to /#pricing don't scroll (the landing bundle draws after load), so the demo + guides buttons go to /login?mode=signup. Sign-in page also fixed to fit a 375px phone.
**Waived-fee estimate (10/1):** "Who you waive fees for" leads with "Up to about $X a month" = exact waived fees + late invoices that had NO fee, priced at the owner's usual fee rate for that invoice size (<$500, $500–2K, $2K–10K, $10K+; else Settings default; else not estimated), averaged over the months Dunn has seen. Worded as an upper bound, never "money lost". `feeOpportunity` in `src/services/waivers.ts`.

**Password reset (10/1):** "Forgot password?" on sign-in → /login/forgot → POST /auth/forgot (same answer whether or not the email exists; rate-limited) emails a link → /login/reset → POST /auth/reset sets it and signs in. Token (`src/lib/resetToken.ts`, 4 tests) = signed, 1 hour, tied to the current password hash so it works once.
**Settings → Plan with no plan:** plan buttons → GET /billing/start → Stripe checkout (Manage plan used to bounce to the homepage). **Stripe customer portal configured in TEST mode** (cancel at period end, switch among the 4 prices, no quantity changes, card + invoice history) — **recreate in LIVE mode at launch.**

**Problem alerts (10/1, Bashira: "I need to know about all the issues"):** `src/services/problems.ts` `reportProblem()` — owner gets one plain email (what happened + what to do), founder (FOUNDER_EMAIL / FORWARD_INBOX_TO) gets every issue with the business + account id, same issue max once a day. Wired to: client email not sent, client email **bounced / marked spam** (Resend webhook now also sends email.bounced + email.complained → `/webhooks/resend/inbound`, matched to the invoice via Reminder.messageId), late fee not added, recurring invoice not created (any reason; owner email wording per reason) or crashed, client payment failed, Stripe webhook handler crash, daily-run step crash, daily run giving up. **Daily summary** to the founder from the 9am run (counts + every issue since the last summary); catch-up runs after a deploy only email if something failed. Test a bounce: invoice to `bounced@resend.dev`.

**Stripe product names (test, 10/1):** renamed "Watchtower — Up to 10 invoices" / "Watchtower — Unlimited" → "Dunn — Up to 5 clients" / "Dunn — Unlimited clients" (customers see these in checkout, the billing portal and receipts). Use these names when creating LIVE products. Founder also gets "Plan changed" emails (old → new plan, monthly↔yearly).

**LEFT:**
- ✅ Automatic emails ON (10/1, 14:10): `SCHEDULER=on`, `SCHEDULER_START=2026-10-02`; boot log confirms both. Daily sweep 9:00 ET; invoices created before Oct 2 are never touched.
- `/demo` phone layout: done 10/1 (`scripts/phone-layout.cjs` now patches landing + demo).
- Launch: Stripe LIVE (keys, Connect client ID, 4 prices, webhooks) + one real-money test.
- Later: guides → more pages, reviews/Product Hunt/Reddit for AI findability; route owner replies through Dunn (optional).

**FUTURE — Dunn as a ChatGPT app (after launch, Bashira 9/30). PURPOSE = DISCOVERY: reach owners who've never heard of Dunn.** ChatGPT apps run on MCP. The app = a free "late-payment helper": when someone asks ChatGPT about a client who won't pay / what late fee to charge / a reminder email, it writes the email, suggests fair fee terms, and ends with "want this sent automatically, fee added if they don't pay? Try Dunn" → signup. No login, ~1–2 days. (Optional much later: existing customers manage Dunn inside ChatGPT via OAuth, ~1–2 weeks; not the point.) Check OpenAI's current app rules + review first; the "1.2B users / mid-chat recommendations" claim came from a social post, unverified. **Build it once as an MCP server, list it everywhere:** ChatGPT apps, Claude's connectors directory, Hermes Agent (and any MCP client). Same code; only the listing/review differs per platform.

---

## ▶ DECISION (9/29/26) — WHAT MAIL DUNN HANDLES

- Dunn only receives mail sent to its own addresses: `reply-<id>@getdunn.org` (client replies) and hello@/support@ (forwarded to `FORWARD_INBOX_TO`). It never reads anyone's inbox.
- A client reply pauses reminders, is forwarded to the owner (Reply goes straight to the client, `replyTo`), and **the client's text is kept as evidence** (Bashira: keep it, for fee disputes). The owner's answers go from their own email and are not seen by Dunn.

---

## ▶ v2.6 (9/29/26) — DUNN'S OWN INBOX (hello@getdunn.org → Bashira's Gmail).

- All `@getdunn.org` mail lands in Resend (root MX → Resend inbound), so a normal mailbox provider would fight the client-reply routing. Instead: any `@getdunn.org` address that isn't `reply-<id>@` is forwarded to `FORWARD_INBOX_TO` (Railway variable — Bashira adds it) with **Reply-To = the sender**. Mail from our own domain is never forwarded (no loops). Attachments aren't carried over yet (text/HTML body only).
- Resend's built-in `receiving.forward()` wasn't used: it sets no Reply-To, so replying in Gmail would bounce back into Dunn.
- To send AS hello@getdunn.org from Gmail: Gmail → Settings → Accounts → "Send mail as", SMTP `smtp.resend.com`, port 465 SSL, user `resend`, password = a **sending-only** Resend API key made for this.
- Live reply test 9/29: Resend received the reply, but it was to a LOCAL test invoice (GVKYOQ2S-0001) that production doesn't have, so production correctly ignored it. Re-test with an invoice created on getdunn.org.

---

## ▶ v2.5 (9/29/26) — $39 PLAN = UP TO 5 CLIENTS. DEPLOYED.

- **Bashira's call:** the $39 plan is **"Up to 5 clients"** (was "10 invoices / month"), billed as often as weekly; $59 is **"Unlimited clients"**. Why: the old cap charged weekly billers (cleaners, tutors, trainers — often one-person, small invoices) for how OFTEN they bill; Dunn can't tell a solo owner from a team, so the cap sorts by clients, not who you are.
- **Rule (`src/services/planLimits.ts`, 7 tests):** per calendar month, max 5 distinct clients (by email, case-insensitive) and 10 invoices per client (a guardrail nobody should feel — weekly is 4–5). Existing clients can still be invoiced when 5 are in use. Replaces `SOLO_MONTHLY_INVOICE_LIMIT`.
- **No more silent misses:** a recurring invoice blocked by the cap now emails the owner once ("Recurring invoice for X not sent" + how to fix), not on every daily retry.
- **Copy:** landing cards, "Both plans include" ("Unlimited clients" → "Weekly, monthly or one-off invoices"), SEO schema offer names, sign-up plan strip, Settings plan label. Never show "solo"/"business" to customers.

---

## ▶ v2.4 (9/29/26) — YEARLY PRICING. DEPLOYED (Railway variables set).

- **Bashira's call:** monthly unchanged ($39 / $59). Yearly: **Solo $390/yr** (2 months free, ~17%), **Unlimited $540/yr** ($45/mo, 24% off). The bigger Unlimited discount nudges people up a plan.
- **Stripe (test mode):** yearly prices on the same products — `STRIPE_PRICE_SOLO_YEARLY=price_1UL71HRve8cRy3m39KgK3Axn`, `STRIPE_PRICE_BUSINESS_YEARLY=price_1UL71IRve8cRy3m3KHuhiTqI`. In local `.env`; **must be added on Railway by hand before deploying** (Claude's write was blocked). Recreate both in LIVE mode at launch.
- **Code:** `/billing/checkout` takes `billing: monthly|yearly` (default monthly); webhook maps yearly prices to the same plan; `/login?plan=…&billing=yearly` shows "$390 a year" and passes it to checkout; Settings plan label no longer shows a monthly price.
- **Landing:** Monthly / Yearly toggle above the plan cards (edited inside the bundle's template + DC logic: `yearly` state, `payMonthly/payYearly`, `goSolo/goBusiness`). ⚠ A new designer landing.html won't have it — send the designer this spec or re-apply.
- **Verified:** toggle switches $39→$390 / $59→$540 with "works out to" lines, 0 overflow at 375px, yearly button → `/login?plan=solo&billing=yearly`; test-mode checkout sessions total $390 and $540. 90 tests.

---

## ▶ v2.3 (9/29/26) — LANDING PAGE WORKS ON A PHONE. DEPLOYED.

- **What was wrong:** `public/landing.html` (designer bundle) had zero phone rules. At 375px the hero buttons were cut off, the 3/4-column sections were squeezed into slivers ("$17,5…"), and the "always late" table was unreadable.
- **Fix:** `scripts/phone-layout.cjs` tags elements inside the bundle's embedded template (`dm-*` classes, found by a unique piece of their inline style) and adds one `<style id="dunn-phone">` with rules under `@media (max-width: 760px)`. It has to go INSIDE the template: the bundle redraws the whole document from it on load, so outside styles are thrown away.
- **Proof:** at 375px, 0 elements outside the screen (was dozens). At 1280px, all 304 elements are in the identical position and size before vs after, so desktop is untouched.
- **⚠ When the designer sends a new landing.html:** run `node scripts/phone-layout.cjs` on it. It refuses to write if the page changed shape (each rule expects an exact match count), so it can't silently mis-tag. Better long-term: ask the designer to build the phone layout in their tool.
- **Still not phone-friendly:** `/demo` (separate designer bundle, sidebar eats half the screen) — the landing page's "See how it works" goes there. The signed-in dashboard has phone rules in `watchtower.css` but hasn't been checked on a phone.

---

## ▶ v2.2 (9/28/26, night) — CLIENT REPLIES REACH DUNN IN PRODUCTION. DEPLOYED 9/28 (commit d08e154). Secret set 9/29; replies verified end to end.

- **Resend webhook repointed (done 9/28):** the `email.received` webhook now goes to `https://getdunn.org/webhooks/resend/inbound` (was the dead ngrok tunnel from 9/23). Only the URL changed, so its signing secret is the same one as `RESEND_WEBHOOK_SECRET` in the local `.env`.
- **Bashira does by hand:** put that signing secret on Railway as `RESEND_WEBHOOK_SECRET` (Claude doesn't handle secrets). Until it's set, production answers every reply with 500 "webhook not configured"; Resend retries, so replies in the gap aren't lost right away.
- **🔴 Fixed: every signed reply would have failed the signature check.** Since v1.8 the route gets raw bytes (a Buffer) but still did `JSON.stringify(req.body)`, which never matches what Resend signed → 401 on every real reply. New `verifyInbound()` checks the exact bytes. `inbound.test.ts` signs payloads with a throwaway secret (genuine / tampered / wrong secret / no headers). **Replies stay broken in production until this deploys.**
- **Fixed: the owner's "Client replied" alert had no message.** The body was fetched with `emails.get()` (sent mail only); received mail is `emails.receiving.get()`.
- Also in v2.1's commit 40601cd: no owner email in any signature, and `/webhooks/*` is never behind `API_TOKEN`.
- **To prove it after deploy:** reply to a Dunn email from `bashira.webb+client@gmail.com` → owner inbox gets "Client replied" with the text, and that invoice's reminders pause.

---

## ▶ v2.1 (9/28/26, late) — FEWER EMAILS + THE OWNER CHOOSES WHEN THE FEE APPLIES. DEPLOYED 9/28 (commit d08e154).

**Bashira's calls (after research, see below):** clients must never feel nagged, and Dunn never picks the grace period for the owner.

**The schedule now (`scheduleFor()` in reminderEngine.ts):**
- the invoice itself when it's created (from Dunn, template 00)
- ONE reminder 4 days before the due date (`t-4`, template 02). **No 7-days-before, no 3-days-before, no due-today email.**
- with a late fee: ONE warning 3 days before the fee lands — "still unpaid after <deadline>" (`fee_warning`, template 04), never before the due date has passed; with grace 0 there's no separate warning (the invoice + the reminder state the terms). Without a fee: ONE "past due" nudge at 3 days late (`t+3`, template 04).
- the "late fee added" email the morning after the deadline (fee job; owner approves unless auto-apply)
- at 14 days late the owner decides (escalation — final notice or call).
Simulated Oct 6–27 for a $250 invoice due Oct 12: no grace → reminder Oct 8, fee Oct 13 · 7-day grace → reminder Oct 8, warning Oct 17 ("…still unpaid after October 19"), fee Oct 20 · 1-day grace → reminder Oct 8, warning Oct 13, fee Oct 14 · no fee → reminder Oct 8, nudge Oct 15 · all: owner asked Oct 26. On-time client = 2 emails; latest payer ≤ 4.

**Grace period = the owner's choice, no default:** `Settings.defaultGraceDays` is now nullable with no default (migration `20260928210000_grace_days_owner_choice`; existing values kept). 0 is allowed everywhere (0 = the fee applies the day after the due date) — before, the server forced min 1 AND every form turned 0 into 7 (`parseInt(x) || 7`). `feeRules.parseGraceDays` / `GRACE_REQUIRED` enforce it on invoices, recurring invoices and Settings (a fee without a chosen grace period → 400). Sign-up's default-fee step now asks "When does the late fee apply?" — "The day after it's due" / "Give them extra days" — nothing pre-picked, hidden when "No late fee". Invoice form, Settings and recurring forms start blank and refuse a fee without a choice.

**Wording:** `feeRules.feeWhen()` → "if it's not paid by the due date" (0) / "if unpaid 1 day after…" / "if unpaid N days after…". Used in all 9 emails' terms line (`{{fee_when}}` replaced "if unpaid {{grace_days}} days after the due date"), the invoice-form preview, sign-up preview and the Stripe invoice note. Email 04 lost its hard-coded "3 days past due"/"a few days past due" → "past due" (it now fires on the owner's grace-dependent day). Pending-fee row says "due date passed" for 0.

**Verified 9/28 (browser + Stripe test, throwaway DB):** sign-up fee step (hidden for no fee; nothing pre-picked; save blocked without a choice; "day after it's due" → preview + saved 0) · invoice form pre-fills 0 from the owner's default, "1 day" singular, blank blocks submit · invoice created with grace 0: Stripe note "Late fee: $25.00 applies if it's not paid by the due date.", Dunn email delivered with "A $25.00 late fee applies if it's not paid by the due date, as agreed on the invoice." · schedule walk above (record-only) · API: fee + no grace → 400 on invoices/recurring/settings; no fee + no grace → ok; 0 → ok. 85 tests.

**For the designer:** 04's wording change; the pre-due reminder uses 02 ("due this Thursday") — fine for 4 days out; the no-grace case has no dedicated warning, so 02/00 could say the fee more prominently than the footer; a future "Reminder schedule" Settings section (days before due, due-date email on/off, fee-warning days, 14-day behavior, per-client pause) is the next owner-control step (DB still has unused `remindT7…remindT14` switches).

**Research used (9/28):** one pre-due reminder 3–7 days out is the norm (Trove, Chaser: 70% of their best collectors use one); Xero defaults to only after-due reminders (7/14/21, max 5, one schedule for all — a known complaint); FreshBooks max 3 with per-client on/off; RCTs: a pre-due SMS raised on-time loan payment 7–9% (Cadena & Schoar, NBER 2011); weekly reminders helped tax compliance but twice-weekly reduced effectiveness (ZEW RCT).

---

## ▶ v2.0 (9/28/26, night) — DESIGNER DELIVERY MERGED: DUNN SENDS THE FIRST INVOICE · "YOUR NAME" · STRIPE NAME CHECK. DEPLOYED 9/28 (commit d08e154).

**What's in:**
- **Dunn sends the first invoice email** (designer's `00-new-invoice`) on create and on every recurring run; `invoiceCreator` no longer calls Stripe `sendInvoice` — Stripe sends only if Dunn's email fails, so the client gets it exactly once. Recurring passes `is_recurring` + `frequency_label` ("Your monthly invoice"); `invoice_pdf_url` = Stripe's PDF.
- **"Your name"**: `Account.ownerName` (migration `20260928200000_owner_name`, nullable). Required at signup; editable in Settings ("You & your business"). Emails sign off "Reply to reach <first name>"; accounts without one fall back to the full business name (never its first word).
- **Stripe name check**: `src/lib/stripeName.ts` reads the connected account's public name (`business_profile.name` → `settings.dashboard.display_name`). The OAuth callback now lands on the designer's `/onboarding-success.html?open_invoices&clients&past_due&dunn_name&stripe_name` (was `/onboarding?connected=1`); its "Set default late-fee terms" button → `/dashboard#settings`. Settings shows the mismatch note + "Connected as <Stripe name>". Reminders-off tip on both.
- **New sign-in / sign-up page** (designer's `login.html`) + `public/login.js` (the API side: validation, /auth/signup|login, ?plan= → checkout, signup → /onboarding). Kept from the old page: **show/hide password eye** and the 12-character rule hint. "Forgot password?" is **hidden** — no reset page exists yet.
- **Fixes:** email subjects decode HTML entities ("Rivera &amp; Sons" → "Rivera & Sons"); **escalation "send final notice" now sends** (once); voided/uncollectible invoices show "Void"/"Uncollectible" and no longer count as overdue/due-soon; sidebar shows the real owner on every view (was the designer sample "Marta Rivera" on direct #settings loads); scheduler-off log says why.
- 3 new tests (81 total).

**NOT taken from the designer's files (tell the designer):** their `static/dashboard.html` was built on an older copy — it renamed the working list templates (`tpl-invoices`/`tpl-recurring`/`tpl-clients`/`tpl-pending_fees` → `-row`/`-fee` names, so lists render nothing), reverted placeholders (`{avatar}`, `{late_class}`, `{client_sub}`, a broken `{`), and **removed `<script src="api.js">`**. Only their genuinely new parts were brought over (Settings "You & your business", Stripe-name note, tip, "DUNN" comment). `watchtower.css` 3-way merged cleanly. Mascot unchanged. Copy notes: 00's recurring line says "this month's invoice" even for weekly/biweekly; the name check treats "Rivera & Sons" vs "Rivera and Sons" as different (their normalizer strips "&" but not "and"); `09-fee-updated` (engineering-built) still wants a designer pass. The `dunn-update-sep-28/` folder is left untracked (not committed).

**E2E PASSED 9/28 (browser + Stripe test + Resend, throwaway DB):** signup page → no name: "Add your name. Emails sign off with it." · weak password: "…at least 12 characters." · eye shows password · real signup → /onboarding, `ownerName` + `businessName` saved · connected page: mismatch card (Rivera & Sons vs Defiance Media LLC), match ("rivera & sons"), no Stripe name → nothing; sidebar shows the real owner · test Stripe account's public name read live = "Defiance Media LLC" · Settings: connected note + mismatch note + names load; save "Alexandra Rivera" persists · new invoice P1Z3LUW2-0001: **Dunn's email delivered, subject "Invoice P1Z3LUW2-0001 from Rivera & Sons: $250.00 due October 12, 2026", "Reply to reach Alexandra", fee terms, PDF link; 0 Stripe `invoice.sent` events** · recurring $120 monthly → "Your monthly invoice… as usual" delivered, next run Oct 28 · escalation "send" → "Invoice P1Z3LUW2-0001 is two weeks past due" delivered once, flag cleared, second run 0 · 0 webhook errors.

**Deploy note:** the new migration runs automatically on Railway start (`prisma migrate deploy`). Scheduler stays off in production (`SCHEDULER=off`).

---

## ▶ v1.9 (9/28/26, evening) — OWNER APPROVE / CHANGE / WAIVE LATE FEES. DEPLOYED 9/28 16:47 (commit 8d918aa).

**Bashira's rules (9/28):** the owner can **lower** a late fee (never raise it above the fee in the invoice terms — the client was told that amount), approve it, or waive it — **both while it's pending and after it's on the bill**. Changing a billed fee reissues the bill and emails the client the new amount.

**How it works:**
- Fee job (auto-apply off, the default): the day after the deadline it marks the invoice `feeStatus:'pending'` + `feeAmountCents` = terms amount (was only an audit event, so the dashboard never saw it) and emails the owner once.
- `POST /invoices/:id/fee/approve {amount?}` (pending → bill; optional lower amount) · `POST /invoices/:id/fee/change {amount}` (billed → reissue at the new fee) · `POST /invoices/:id/waive {note?}` (pending → just recorded, nothing billed or emailed; billed → reissue without the fee). All in `feeEngine.ts` (`approveFee` / `changeBilledFee` / `waiveFee`), sharing `reissueBill()` — the void-and-replace swap from v1.8, now with an optimistic check (`updateMany where stripeInvoiceId = the one we read`) so an owner click and the morning run can't both swap the same bill.
- `feeRules.ts`: `agreedFeeCents` (flat/percent) + `checkFeeChange` ("can't be more than $25.00, the amount in the invoice terms"; $0 → "waive it instead"). 7 tests (78 total).
- New client email **09-fee-updated** ("Good news: the late fee is waived/reduced… new balance, the old payment link no longer works") — built by engineering from 06, **designer to polish**. `feeStatus:'waived'` → balance excludes the fee; footer shows the original terms amount.
- Webhook: paying a reissued bill only marks the fee paid if `metadata.includes_fee !== 'false'` (a waived bill stays `feeStatus:'waived'`).
- Reports: "Fees waived" now counts every waived fee — before, only waives with a typed reason counted (`waiveNote`).
- Dashboard: pending rows get **Change** (amount box, max = terms, button live-updates "Approve $10.00"); new **"Late fees on the bill"** section (Lower / Waive), hidden when empty; pending section hidden when empty. **Fixed a dashboard-wide bug:** `fillTpl` only filled placeholders *inside* a row, never the row's own attributes, so every row carried the literal `data-invoice-id="{invoice_id}"` — approve/waive (and any row-id click) could never have hit the right invoice.

**E2E PASSED 9/28 on the real dashboard (browser), Stripe test + Resend, throwaway DB, auto-apply off:** 3 invoices 8 days late → all `pending` (A $25, B $18 = 10% of $180, C $30), owner alerted ×3, nothing charged → A: typed $30 → refused "can't be more than $25.00…"; $10 → approved → Stripe 0001 void, 0004 $260 (Invoice $250 + "Late fee (lowered from $25.00)" $10), "late fee added" email delivered → B: waived with note → Stripe untouched, no client email, `waived` + note stored → C: approved $30 ($330) → lowered $15 ($315, "has been reduced" email) → waived ($300, "has been waived" email) — Stripe chain 0003 → 0005 → 0006 → 0007, only the last open; all 4 client emails `delivered`; C's audit trail reads approve → lowered → waived → forced fee run: 0 changes → paid C's $300 → Dunn `paid`, fee stays `waived`, owner "Invoice paid — GGD7WHWS-0003 ($300.00)". 0 webhook errors.

**⚠️ DESIGNER DELIVERY `dunn-update-sep-28/` (arrived 9/28 16:31) — MERGE, DON'T COPY.** It implements the next-batch brief (00-new-invoice email, "Your name" signup, Stripe name check, reminders tip, Watchtower→Dunn copy). Its README says "replace the matching files", but its `static/dashboard.html` + `static/watchtower.css` are based on the pre-v1.9 files — copying them deletes the Change/Lower/Waive UI. Use a 3-way merge (`git merge-file`, base = commit before v1.9). Also: it renames `tpl-pending_fees` → `tpl-pending-fee`, which would make the pending-fee list render nothing (api.js looks up `tpl-pending_fees`) — keep the old id or update api.js.

**Still open (as of v1.9; escalation + void display FIXED in v2.0):** Template filler doesn't HTML-escape values (client names come from the owner's own input — low risk).

---

## ▶ v1.8 (9/28/26) — DEPLOYED (commit d9bd8fc, live 16:15 ET) WITH THE SCHEDULER SWITCHED OFF.

**Live state:** Railway variable `SCHEDULER=off` (set before the push, on Bashira's call) — the new code is live but sends nothing automatically, because the open invoices in the production DB haven't been reviewed (earlier tests used made-up client addresses, e.g. `billing@hudsonco.com`, that may belong to real companies; Claude's read of production data was blocked by the permission classifier). **Verified live:** `/health` ok · boot log `[scheduler] off` · Stripe webhooks now pass: `[webhook] payment_intent.* verified` (was 15/15 rejected before). The connected-accounts destination (`STRIPE_WEBHOOK_SECRET_2`) isn't proven yet — watch for `verified` on the next connected-account event.

**To turn the scheduler on:** (1) review open invoices on getdunn.org (or allow a one-time production DB read) and void any test invoices with non-owned addresses, (2) `railway variables --set SCHEDULER=on` (or delete the variable — production defaults to on), (3) confirm `[scheduler] on — daily sweep at 9:00 America/New_York` in the Railway logs. Cosmetic: the off-message says "(local dev)" even in production — reword in the next batch.

**The go-live blocker is fixed in code.** The web server now runs the daily sweep (reminders → fees → templates) itself at **9:00am New York time** — no separate Railway cron service. `src/jobs/scheduler.ts` (clock, checks every 15 min, catches up after a restart/deploy, retries a failed sweep up to 3x/day) + `src/jobs/sweep.ts` (Postgres advisory lock so two runs can never overlap — web server, a manual `job:*`, or old+new instance mid-deploy). On in production (`NODE_ENV=production` or Railway's `RAILWAY_ENVIRONMENT_NAME`), off in local dev; `SCHEDULER=on|off` overrides. Boot log says `[scheduler] on — daily sweep at 9:00 America/New_York` — check for it in Railway logs after deploy, then `[scheduler] daily sweep done for <date>` after 9am ET.

**Found + fixed while wiring it (all would have misfired the moment jobs ran on a timer):**
1. **Reminder emails crashed in production.** `tsc` never copied `src/email-templates/*.hbs.html` into `dist/`, so the renderer threw ENOENT on every reminder under `node dist/…`. Hidden until now because jobs were only ever run through `tsx` (reads from `src/`). Fix: `build` script now copies the templates into `dist/`.
2. **Reminders back-filled stale steps.** The picker chose the latest *unsent* step whose day had arrived, so an invoice that missed its early reminders got "due today" → next run "due in 3 days" → next run "heads up, coming due" — after the due date. Now it only ever sends the *current* step; a missed day still catches up, older steps are skipped. (Replaced the test that encoded the old behavior; 3 new tests.)
3. **Fee job re-asked the owner on every run.** With auto-apply off (the default), each run wrote another `fee_pending_approval` + emailed the owner again. Now asked once per invoice.
4. **A waived fee could be re-charged.** Waive resets `feeApplied=false`, so with auto-apply ON the next run would issue the fee invoice again. Fee job now skips any invoice with a `fee_waived` event.
5. **`railway.json` `"cron"` block removed** — not a real Railway key (schema has only `deploy.cronSchedule`, which would turn the web service itself into a cron job). It never ran.
6. **🔴 Every Stripe webhook failed signature verification — in PRODUCTION too.** `app.use(express.json())` ran before the webhook route's `express.raw()`, so the body was already parsed and `constructEvent` could never verify it. Railway logs showed 15/15 recent webhooks rejected, 0 accepted. Consequence: paid invoices were never marked paid (with the scheduler on, clients who'd PAID would have kept getting past-due reminders + late fees) and subscription checkouts never activated a plan. Fix in `src/index.ts`: JSON parser skips `/webhooks/*` (covers the Resend inbound webhook too).
7. **The t+7 email's subject was broken for clients:** "Invoice X: late fee applies after " (date blank). `reminderEngine` only computed the fee deadline *after* a fee was applied — backwards; the t+7 email needs it before. Now computed whenever the invoice has a late fee. All 8 templates re-rendered with/without a fee — every subject fills in.

**Verified 9/28 (local, scratch DB, email dry-run):** tsc clean · 62 tests pass (48 → 62) · clean `npm run build` includes `dist/email-templates/` · 3 sweeps over a 10-days-late invoice with no prior reminders → exactly one `t+7` sent, no back-fill next day, owner asked about the fee exactly once, waived fee on an auto-apply account never re-issued · second run while lock held → turned away · real server boot with `SCHEDULER=on` ran the sweep and logged done; default local boot logs scheduler off.

**✅ Full end-to-end test PASSED 9/28 (local, real Stripe TEST mode + real Resend, throwaway copy of the dev DB):** Hudson Creative (connected test acct `acct_1UJ2SIR…`, auto-apply ON, owner alerts → bashira.webb@gmail.com) → created invoice NCYWKDBJ-0001 ($250, $25 fee after 7d) to bashira.webb+client@gmail.com via `POST /invoices` → flipped due date to 10 days ago → restarted server → **scheduler fired on its own 30s after boot**: t+7 reminder delivered (Resend `delivered`, from "Hudson Creative via Dunn"), $25 fee invoice created + sent in Stripe (test mode, linked via `parent_invoice`), owner got past-due + fee-applied alerts → second sweep: no duplicate fee → marked the invoice paid in Stripe → `invoice.paid` webhook verified (200) → Dunn marked it paid + owner got "Invoice paid" → forced sweep with the invoice 15 days late: **0 reminders** (paid stops reminders). Throwaway DB + temp secrets deleted afterwards. Leftover in Stripe test mode: the $25 fee invoice (open) on the test account — harmless.

**✅ ONE-BILL LATE FEE built + e2e PASSED 9/28 (Bashira tested the first pass and caught it: the "late" email said pay $250 and the $25 bill never arrived).** Root causes: Pattern B put the fee on a separate Stripe invoice that Dunn left to Stripe to email (Stripe test mode never does); the "late fee added" email (template 06) was never sent by any code; and the fee fired ON the deadline while the t+7 email promised "pay by <deadline> to avoid it". Now (`feeEngine.ts` `replaceWithFeeInvoice`, `reminderEngine.ts` `sendClientEmail`/`isPastFeeDeadline`/`isStaleFeeWarning`, `webhook.ts`):
- Fee lands the morning AFTER the deadline (`dayOffset > graceDays`).
- t+3/t+7 "fee is added if unpaid after X" warnings are skipped once X has passed or the fee is on — the fee email replaces them.
- Fee = create + finalize new invoice (original `amount_remaining` + fee, `auto_advance:false` so Stripe doesn't send its own generic email) → repoint the Dunn row (keeps number/due date) → void original (row already repointed, so the `invoice.voided` webhook matches nothing) → Dunn emails template 06 via Resend; if that fails, Stripe `sendInvoice` as fallback. If the void fails (client paid the original seconds ago), it voids the replacement and points the row back.
- Webhook: paying a replacement (`metadata.replaces_invoice`) also stamps `feeStatus:'paid'` + `feePaidAt` (reports' fee revenue); `invoice.updated`/`finalized` from a replacement never re-anchor the due date. Owner "paid" alert now reads "Invoice paid — J2OMWGMR-0001 ($275.00)". `onInvoiceFinalized` uses `updateMany` (was throwing when Stripe's event beat the creator's DB write).
- 9 new tests (71 total).
- **E2E (real Stripe test + Resend, throwaway DB copy):** J2OMWGMR-0001 $250 +$25/7d → **day 7** (deadline): scheduler sent only the warning "late fee applies after Sep 28" (delivered), no fee → **day 8**: no repeat warning; Stripe: 0001 → void, J2OMWGMR-0002 open $275.00 (lines: "Invoice J2OMWGMR-0001" $250 + "Late fee ($25.00)" $25); "A late fee has been added to invoice J2OMWGMR-0001" delivered; Dunn row same number/due date, still open → paid $275 in Stripe → webhook: row paid + fee paid; owner alert "($275.00)" → forced run 15 days late: 0 emails. All 19 webhooks 200. Hosted page shows "Invoice paid $275.00".
- Known limit: the Stripe page shows the NEW number (…-0002); Dunn's emails keep the number the client knows (…-0001), and the Stripe invoice says "Replaces invoice …-0001".

**Still unproven until deploy:** only Railway-specific bits — scheduler auto-detecting Railway (look for `[scheduler] on` in logs) and the Linux build copying the email templates. Everything else above ran on the same built code.

**Manual run on Railway** (for the e2e test — flip a due date, then force a sweep): in a Railway shell, `node dist/jobs/run.js` (all three) or `node dist/jobs/run.js reminders|fees|templates`. Don't rely on `npm run job:*` there — those use `tsx`, a devDependency.

**NEXT BATCH (agreed 9/28) — designer brief: `designer-spec-invoice-email-and-names.md`:**
1. Designer: new "New invoice" email (template 00), "Your name" at signup + Settings, post-Stripe-connect name check (Dunn name vs. Stripe public name, side by side when they differ), onboarding line to turn off Stripe's own reminder emails.
2. Engineering: stop Stripe sending the initial invoice (`invoiceCreator` `sendInvoice` → Dunn sends template 00; same for recurring), owner-name field (API + DB + `owner_first_name` in emails — today it's the first word of the business name: "Reply to reach Hudson"), read the connected account's public business name at OAuth callback.

**🔴 NEW — found 9/28, NOT fixed (next build work):**
- ~~Fee approval broken~~ — FIXED in v1.9 (approve / change / waive, pending and billed). Original note: **Fee approval is broken end-to-end under the default setting (auto-apply off).** The dashboard's Approve button calls `POST /invoices/:id/fee/approve` — that route does not exist (404). The "fees awaiting approval" list filters `feeStatus === 'open'`, which is only set *after* a fee is issued, so a pending fee never shows there. And `/waive` returns 400 for a pending (un-issued) fee. Net: with auto-apply off, a late fee is flagged + emailed to the owner, then can be neither approved nor waived. The late fee is the product's wedge — fix before real customers.
- **Escalation "send final notice" never sends.** At T+14 the escalation writes a `t+14` Reminder row; when the owner picks "send", the next run finds `t+14` already sent and skips. The owner's choice is silently dropped.
- **Waiving an already-applied fee doesn't touch Stripe** — the DB says waived, but the client's open Stripe bill is still the $275 one-bill invoice. Under one-bill, waive-after-apply must issue a fresh invoice for the original balance and void the $275 one (same swap as the fee engine, in reverse).
- ~~t+7 timing vs. copy~~ — FIXED 9/28 (fee lands the day after the deadline).
- ~~Owner "paid" alert reads "250 usd"~~ — FIXED 9/28.
- **One clock for everyone:** reminders go out on New York dates at 9am ET for every account. Fine while customers are US East; per-account timezone is a later upgrade.
- **Security: the git remote URL embeds a GitHub personal access token** (`.git/config`, `origin`). Revoke it at github.com → Settings → Developer settings → Tokens, then `git remote set-url origin https://github.com/bxwebb-cyber/watchtower.git` and push via `gh auth login`.

---

## ▶ STATUS — v1.7 DEPLOYED + VERIFIED. FULL UI RE-INTEGRATED. REMAINING = CREDENTIALS + DOMAIN.

**Current state (verified 9/27/26):** LIVE on Railway — project "carefree-education" / service "valiant-miracle" under **bashira.webb@gmail.com**; URL https://valiant-miracle-production-16b0.up.railway.app. 11 Prisma migrations applied. Node pinned to 24 (`.nvmrc` + `engines`); deploy runs `prisma migrate deploy` + build on every push; `@prisma/client` in real deps; node_modules/dist untracked.

**Full UI re-integration done 9/27/26:** the new 69KB designer dashboard (six views — Dashboard / Invoices / Recurring / Clients / Reports / Settings) is swapped in and fully wired via a rewritten `api.js` (the designer's `{placeholder}` templates + `wt:*` events). `/invoices` and `/clients` enriched with the fields the new UI displays (client email, fee state, paid-at; client "since" year). **Onboarding built:** signup → `/onboarding` (connect Stripe + set a default late-fee, stored on Settings) → dashboard. **Invoice form rebuilt** at `/index.html` — fee prompt with live preview, prefills the account's default fee, and remembers a returning client's last terms. Landing `/` serves the $39/$59 page (correct — a route fix stopped it from serving the stale prototype). Login has an eye toggle + the real 12-char password rule. Demo "back to site" fixed.

**End-to-end test (9/27 night) — connect + create VERIFIED; reminder-fire + late fee still UNVERIFIED (blocked on the missing scheduler, below).** Stripe Connect OAuth was exercised against a real test account and WORKS, after two fixes: (1) enable **Standard OAuth** in Stripe → Connect → Onboarding options → OAuth ("OAuth for Stripe Dashboard accounts"), and (2) correct `STRIPE_CLIENT_ID` to the real **Test client ID** `ca_VAHzDu75xzYwP6yKU9Ez3QiD3bJjSCbH` (it had been stale, from the old ProspectAI account). Invoice creation works — a real invoice lands on the connected Stripe account. **The reminder→late-fee half is NOT yet proven** because (a) production Postgres is Railway-internal (`postgres.railway.internal:5432`, unreachable from a local shell), so the due-date can't be flipped to "past" from here, and (b) **there is NO cron/scheduler wired** — `job:reminders`/`job:fees` are manual-only and would never auto-fire at launch. **Stripe also rejects a past `due_date` at invoice creation** (must create future-dated, then flip in DB to simulate "late").

**What exists:** Everything. Invoice creator, pre-due reminders, late-fee engine with owner-approval gate, per-invoice fee prompts, inbound client replies, recurring invoice templates, dashboard (KPI cards + invoice list with 5 statuses + fee approval), settings (owner email + 3 alert toggles), per-client lateness view, reports (revenue + CSV export), HTML email templates (8 Handlebars, designer-delivered), Stripe Connect OAuth, bearer token auth, 62 passing tests, Railway deploy config (its old "cron" block was invalid — the daily scheduler now lives in the web server, see v1.8). Landing page (designer prototype) at /. Login/signup page at /login. Dashboard protected behind JWT auth. Pain point validation research + NSF SBIR pitch drafted.
- **Location:** `~/Desktop/watchtower/`
- **Stack:** Node 24 + TypeScript + Express + Stripe SDK + Prisma 6 (Postgres 16, local) + Resend (email). Railway-ready.
- **Verified (2026-08-29):** `tsc --noEmit` clean · server boots · `/health` ok · `/invoices/status` now returns `stripeConfigured:true` · OAuth start URL builds correctly with the real client_id · webhook pipeline returns 200 (was 404 — see bug fix below).
- **`.env` now contains (all TEST mode):** `STRIPE_SECRET_KEY` (sk_test), `STRIPE_CLIENT_ID` (ca_), `STRIPE_REDIRECT_URI`, `STRIPE_WEBHOOK_SECRET` (whsec, from `stripe listen`). Plus existing `DATABASE_URL`/`PORT`/`RESEND_API_KEY`/`APP_URL`.
|- **Stripe Standard OAuth is ENABLED (confirmed by user).** Test OAuth flow worked end-to-end in v1.3.

## 🚀 GO-LIVE CHECKLIST — remaining (verified 9/27/26)

Deployed + healthy. Everything below is config/creds, not code:

1. ✅ **Resend API key** — DONE. New key set on Railway + local .env, verified (getdunn.org already verified in Resend; sending enabled).
2. **Resend inbound webhook secret** — resend.com → Domains → getdunn.org → Inbound → set `RESEND_WEBHOOK_SECRET` (only if inbound client replies matter now).
3. ✅ **Stripe products/prices** — DONE (test mode). $39/$59 created, set as `STRIPE_PRICE_SOLO` / `STRIPE_PRICE_BUSINESS`; checkout verified (returns a Stripe checkout URL). Recreate in LIVE mode at launch.
4. ✅ **Stripe webhook (two destinations)** — DONE. "Your account" (billing) + "Connected accounts" (invoices), both at `https://getdunn.org/webhooks/stripe`, each with its own `whsec_`. Set as `STRIPE_WEBHOOK_SECRET` + `STRIPE_WEBHOOK_SECRET_2`; `webhook.ts` verifies against both.
5. ✅ **Stripe OAuth redirect URI** — DONE. `https://getdunn.org/auth/stripe/callback` added to the redirect list.
6. ✅ **Domain** — DONE. getdunn.org pointed at Railway (CNAME `@` → `ad6zexbx.up.railway.app`, DNS-only; `_railway-verify` TXT), verified + SSL issued, serving the live landing. `APP_URL` / `STRIPE_REDIRECT_URI` / `MASCOT_URL` swapped to getdunn.org. *(Optional: add `www`.)*
7. **Go live** — switch `STRIPE_SECRET_KEY` from `sk_test` to `sk_live` (and use live Connect client_id + price IDs) when ready to take real payments.
8. ✅ **Structural SEO + rebrand** — DONE. Brand resolved to **"Dunn"** (user-facing: title/meta/og/twitter/schema/robots/sitemap + full "Watchtower"→"Dunn" copy sweep across landing, internal pages, email templates, and the notify/webhook sender strings). Code/filenames keep `watchtower` (codename). *Follow-ups: proper 1200x630 og:image; verify "see how it works" demo nav; `pay.watchtower.app` sample URLs in email previews are stale.*
9. ◐ **Wire a cron/scheduler for the reminder + fee jobs** — BUILT + verified locally 9/28 (v1.8, in-process daily sweep at 9am ET). Remaining: push to deploy, then confirm `[scheduler] on` in the Railway logs.
10. **Finish the real-data e2e test** — flip the created invoice's `dueDate` to the past (via Railway shell — production Postgres is `postgres.railway.internal`, unreachable locally), force a sweep with `node dist/jobs/run.js`, and watch reminder → late-fee → paid stop the reminders. Set **auto-apply fees ON** for the test account first — with it off, the fee can't be approved yet (see v1.8 🔴).
11. **Content SEO + AEO (findability) — NOT DONE.** Only the *structural* SEO side (label + crawlability — title/meta/schema/robots/sitemap, item 8) is live. The actual findability work is still ahead: content clusters targeting real search queries ("automatic invoice reminders", competitor-comparison pages, "get paid faster", etc.) and AEO/GEO so ChatGPT/Claude/Perplexity/Gemini surface Dunn as the answer. Follow the `seo-geo-aeo-content-system` skill (mine reviews → map queries → cluster → publish → Search Console loop). ASO is N/A (web SaaS, no mobile app).

**Railway access note:** project lives under **bashira.webb@gmail.com** (NOT bmwxcf@gmail.com — that account only has prospectai). The local CLI is logged in as bashira.webb; the bmwxcf login is backed up at `~/.railway/config.json.bmwxcf.bak`. Local repo is linked to carefree-education/valiant-miracle.

## The Product (locked decisions — do not drift from these)
- **Tagline (locked 8/21/26): "We keep watch so you don't have to."** The whole pitch in one sentence — the lighthouse keeps watch so the ships don't have to, Watchtower keeps watch so the owner doesn't have to chase.
- **Mascot (locked 8/21/26): the lighthouse.** Hand-drawn sketch / tattoo-flash style: bold black ink linework, red-and-white striped tower, kind face, tiny waves + sailboat at base, warm glowing lantern, small flag on top. Black ink with sparse red/gold accents, white background, no ground shadow. Drafts: ~/Desktop/watchtower-mascot-dude.png (rejected) and ~/Desktop/watchtower-mascot-lighthouse.png (WINNER). Deliberately NOT TIB style — this brand is sketch/tattoo, not Sanrio-kawaii. Mascot must appear in reminder emails (warm, never threatening) + dashboard logo.
- **Mascot final (locked 8/21/26, night): WOODCUT version won.** ~/Desktop/watchtower-mascot-v5-woodcut.png (original, with boat) → ~/Desktop/watchtower-mascot-v5-woodcut-noboat.png (FINAL, boat removed, regenerated same style). Animation: ~/Desktop/watchtower-lighthouse-beam.gif (12-frame rotating beam + lantern pulse, 344KB — good for web; need an email-size <150KB version before using in reminder emails).
- **Price: tiered, two tiers (locked 9/26/26).** $39/mo Solo (up to 10 invoices/mo), $59/mo Business (unlimited). **The 10-invoice cap is now ENFORCED in `src/services/invoiceCreator.ts`** — a Solo account cannot create an 11th invoice until the calendar month rolls over (returns `plan_limit`, HTTP 402). This sorts buyers by usage, not self-declared "solo vs business" (Bashira's call — identity tiers are unenforceable). Confirmed by pricing research: 10 invoices is the industry's exact small-tier anchor (Invoice Simple Plus, SolidInvoice entry both = 10); FreshBooks tops out by client count (5/50/unlimited). One late fee covers the month — the dashboard must show recovered money to justify the premium over commodity invoice apps ($7–$23/mo) — the premium rests solely on the late-fee/recovery wedge.
- **The wedge:** reminders BEFORE the invoice is late (nobody else does this — Stripe's built-ins are due/past-due only, ChaseAI chases only after overdue).
- **Stripe does the invoice; we are the front door + the brain.** User creates the invoice in OUR form (with the fee prompt), we hand it to Stripe via API. Stripe stores, sends, collects. We watch, remind, fee, and keep the proof.
- **The fee prompt (Bashira's design, the heart of the product):** at invoice creation, the owner is asked "if not paid in N days, what's your late fee?" — flat $, %, or $0/none, per invoice per client. Fee is written into the invoice terms the client sees. Never a surprise, never a global-only setting.
- **Dunn sends EVERY client email, including the first invoice (Bashira's call 9/28/26).** Stripe is the cash register only — payment page, PDF, receipt. If Stripe sends the first invoice email: client replies bypass Dunn's reply detection (reminders keep going to someone who already answered), Dunn can't prove the fee terms were delivered, and Dunn reads like a third party. Today Stripe still sends it (`invoiceCreator` → `sendInvoice`) — see NEXT BATCH. Honest note: this is necessary, not the moat — the moat is pre-due reminders, enforced late fees with owner approval, reply-pausing, the late-payer view, and the proof trail.
- **Late fee mechanics — ONE BILL (Bashira's call 9/28/26, replaces Pattern B):** the morning AFTER the fee deadline (due + grace days, default 7), Dunn replaces the original invoice with ONE Stripe invoice for original balance + fee (void original → new invoice with two lines, "Replaces invoice X"), and Dunn itself emails the client the designer's "late fee has been added — Pay $275" email (template 06). The client never sees two bills. The Dunn invoice row stays the same (number, due date, history); only the Stripe invoice behind it changes. ~~Pattern B (separate fee invoice)~~ was retired because the client got a "$250" pay button and a separate $25 bill they might never see.
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

## NEXT SESSION (Sept 26) — polish & ship
1. ✅ **All build work** — DONE 9/25/26
2. **Resend API key** — GitHub secret scanning revoked it. Generate a new key at resend.com, add to Railway env vars, and verify email sending.
3. **Subscription billing (Stripe Checkout)** — ✅ CODE BUILT 9/26/26. New `src/routes/billing.ts` (GET /billing/status, POST /billing/checkout, POST /billing/portal), Account subscription fields (plan, stripeCustomerId, stripeSubscriptionId, subscriptionStatus, currentPeriodEnd, cancelAtPeriodEnd), 3 new webhook handlers (checkout.session.completed, customer.subscription.updated/deleted). tsc clean + 48 tests pass. REMAINING (config, not code): create the $39/mo + $59/mo products/prices in the Stripe dashboard, set STRIPE_PRICE_SOLO / STRIPE_PRICE_BUSINESS in .env + Railway. **Designer update spec: `designer-spec-pricing-flow.md`.**

**⚠️ CO-DEPENDENCY FIXED 9/26/26 — auth was completely broken.** `app.use('/auth', authRouter)` passed the factory *function* as middleware (never called `next()`), so every `/auth/*` request (login, signup, OAuth, /me) hung forever. Fixed to `app.use('/auth', authRouter())`. Also removed the broken `keyGenerator` from `authLimiter` (express-rate-limit v8 `ERR_ERL_KEY_GEN_IPV6`). Login/signup now set the `auth_token` cookie (previously they only returned the token in the body and the frontend put it in a `?token=` query param — now an httpOnly cookie, consistent with OAuth). Billing routes now resolve the account from the JWT (cookie/Bearer), not `findFirst()`. Verified end-to-end: signup → cookie set → checkout returns the price-config error (auth resolved), no-cookie checkout → 401. `JWT_SECRET` still missing from local `.env` — add it.

**MULTI-ACCOUNT FIXED 9/26/26 — all API routes resolve the signed-in account from the JWT.** Replaced `prisma.account.findFirst()` (single-account assumption) with `getAccount(req)` from `src/lib/account.ts` across settings, clients, templates, invoices (list, waive, escalate, escalations, status, fee-default), and reports (revenue + both CSVs). `createInvoice()` now takes an `accountId` (callers: invoices POST + templateEngine). Verified live with two accounts (Alpha Studio / Beta Co.) — each sees only its own settings, and no-cookie requests return 401. REMAINING single-account spot: `webhook.ts` `onInvoiceCreated` still uses `findFirst()` — it needs Stripe-Connect routing (match the event's connected account id → `Account.stripeAccountId`), which is a separate, deferred fix.

**BUSINESS NAME — required at signup, editable in Settings.** Signup now requires `businessName` (400 without it); stored on the Account and returned on login/signup/me. PUT /settings accepts `businessName`. Wired into the email From line (`clientMailFrom` → "{DBA} via Dunn") and the signature. Reminder engine blank-guards: if `businessName` is empty it skips the send and flags the owner once (`missing_business_name` audit event). This is the fix for "clients ignore emails from a business they don't recognize" — the DBA is the recognition token, so it's captured from the owner rather than guessed from Stripe's legal-entity name.
4. **Website flow audit** — ✅ AUDITED 9/26/26. Fixed (code): **#8** signup→Connect Stripe created two accounts (now the OAuth callback links to the signed-in account instead of upserting a new one); **#6** OAuth callback now redirects to `/onboarding-success.html?open_invoices=N&clients=N&past_due=N` instead of skipping to `/dashboard`. REMAINING = designer-owned, all consolidated in `designer-spec-pricing-flow.md`: two-tier pricing ($39/10 invoices + $59/unlimited, no "Solo/Business" labels), "Start watching" → `/login?plan=solo|business`, "See how it works" → `/demo`, "Pricing"/"Privacy" nav anchors, "create your first invoice" dead link, and "Set default late-fee terms" → `/dashboard#settings`. Settings/Clients/Reports are tabs inside dashboard.html (Bashira's call), not separate files.
5. ✅ **Pricing research** — DONE 9/26/26. Locked at **$39/mo Solo / $59/mo Business** (raised from $29/$49). Verdict: $29 priced against ChaseAI's $9 "chase emails" toy while capability matches Paidnice's $69 AR tier. Solo $39 undercuts Paidnice $69 + Chaser $49-$250; Business $59 targets freelancers stepping up from ChaseAI $19 Pro.
6. **Domain setup** — Add `getdunn.org` as a custom domain in Railway's Networking settings. Add the DNS records Railway provides (at your domain registrar). Get email working at `getdunn.org` (Resend handles sending from reminders@getdunn.org).
7. **Hobby plan budget alert** — In Railway Settings → Usage, set a notification at $4 spend so you're warned before hitting the $5 threshold.
8. **Deploy for real** — Once subscription billing, domain, and emails are solid, add the public domain back and ship.

## DEPLOY (v1.4 — extensions built, ready to ship)

1. `railway link` this project to your Railway account
2. Set these in Railway env vars — copy from `.env`:
   - `PORT`, `DATABASE_URL` (Railway Postgres), `STRIPE_SECRET_KEY` (live), `STRIPE_CLIENT_ID`, `STRIPE_REDIRECT_URI` (production URL), `RESEND_API_KEY`, `MAIL_FROM`, `SENDING_DOMAIN`, `APP_URL` (production URL), `API_TOKEN` (generate one), `MASCOT_URL` (production URL + /lighthouse-transparent.png)
3. Set `NODE_VERSION=24` in Railway env
4. Push → Railway builds from `railway.json` and deploys
5. Set `NODE_ENV=production` if needed for Stripe live mode
6. The web server runs reminders → fees → templates daily at 9am ET on its own (v1.8 scheduler); no cron service to set up

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
