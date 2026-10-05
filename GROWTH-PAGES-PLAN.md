# Dunn — Free tools + search pages plan

Idea from Starter Story (AngelMatch): boring painful B2B problem + free tools +
lots of template pages that match what people Google. Half his revenue came
from search. Pages take 3–6 months to rank, so start soon after go-live.

Already live: 5 guides in `public/guides/` (late fees, reminder emails, net 30,
what to say when a client pays late, Dunn vs FreshBooks vs Wave).

Order: go live → a few paying users → Tool #1 + first 20 pages → AppSumo.

---

## Free tool #1 — Late fee calculator  (`/tools/late-fee-calculator`)

**Why first:** "late fee calculator" is a real search, it's exactly Dunn's job,
and Dunn already has the math (fee type, grace days, when it lands).

**You type in:**
- Invoice amount
- Due date
- Fee: flat ($) or percent (%)
- Grace period (0, 7, 14, 30 days)

**It shows:**
- The fee amount and the new total
- The exact date the fee applies
- A ready-to-copy line for the invoice:
  "A $25 late fee applies if unpaid 7 days after the due date (Oct 10)."
- A ready-to-copy polite heads-up email for the client
- A soft warning if the fee looks high for the amount (and that some states limit fees)

**Ends with:** "Dunn sends the reminders and adds the fee for you — automatically,
with a heads-up to you the day before." → Start free

No sign-up, no saved data, works on phone. One page, no server needed.

## Free tool #2 — Payment reminder email writer  (`/tools/reminder-email`)

Pick: how late (not yet due / 1 day / 1 week / 30+ days), tone (friendly / firm /
final), your name, client name, amount → copy-ready email. Uses the same wording
Dunn's real reminders use.

## Free tool #3 (later) — "How late is this invoice?"

Due date + payment terms (net 15/30/60) → days late, and what to send today.

---

## Template pages (one design, many versions)

### Group A — Reminder emails by profession (start here: easy, low risk)
`/guides/payment-reminder-email-for-[profession]`
photographers, graphic designers, web designers, videographers, copywriters,
freelance writers, consultants, contractors, cleaners, landscapers, tutors,
coaches, therapists (private practice), bookkeepers, virtual assistants,
event planners, makeup artists, wedding vendors, musicians/DJs, developers
→ 20 pages

### Group B — Invoice late fee wording by profession
`/guides/late-fee-for-[profession]`
Same 20 professions: typical fee, grace period, exact wording for contract + invoice.

### Group C — Late fee rules by state  (high value, needs care)
`/guides/late-fee-laws-[state]` — 50 pages.
⚠️ Legal info: must be researched and cited per state, dated, and say
"not legal advice." Do these only after A and B, and check each one.

### Group D — "How to" questions people Google
- How to ask a client for payment politely
- What to do when a client won't pay
- How to follow up on an unpaid invoice after 30 / 60 / 90 days
- Can I charge interest on a late invoice?
- How to send a final notice before collections
- Net 15 vs net 30
- Should I require a deposit?

### Group E — Comparisons
Dunn vs: FreshBooks (done), Wave (done), QuickBooks reminders, Stripe's built-in
reminders, HoneyBook, Bonsai, Chaser, InvoiceSherpa.

---

## First batch (when ready)
1. Late fee calculator
2. Group A: first 10 professions
3. Group D: 5 pages
4. Add all to `sitemap.xml` + `/guides` index

Every page: real useful answer first, then one "Let Dunn do this for you" box.
No filler, no fake stats — only facts we can source.
