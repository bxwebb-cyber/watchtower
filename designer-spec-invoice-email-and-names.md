# Designer spec — Dunn sends the first invoice · owner name · Stripe name check
_2026-09-28 · Bashira's call: every email the client reads comes from Dunn. Stripe is only the cash register — the payment page, the PDF, the receipt._

## Why
Today the **first** email a client gets is Stripe's generic invoice email. Dunn's first email is "due next week" (template 01). That breaks three things:
- **Replies.** Dunn emails reply-to Dunn, so when a client answers ("I mailed a check"), Dunn pauses reminders and tells the owner. A reply to Stripe's email goes around Dunn — and the first email is when clients reply most.
- **Proof.** The late-fee terms are what make a later fee fair. Dunn can prove the client received them on day one only if Dunn sent them.
- **One voice.** First email from Stripe, next five from "Hudson Creative via Dunn" → Dunn reads like a stranger who showed up later.

---

## 1. New email — "New invoice" (template 00)
**Sent:** the moment the owner creates an invoice, and each time a recurring invoice is generated.
**Deliver as:** `00-new-invoice.hbs.html`, same format as 01–08 (subject lives in `<title>`).

**Must include**
- Greeting with the client's first name
- Invoice number, amount, due date (long form + weekday)
- **Pay** button → Stripe payment page (`{{pay_url}}`)
- **Late-fee terms, plainly, when there is a fee** — e.g. "If it's not paid by {{fee_deadline_long}}, a {{fee_amount}} late fee applies, as agreed." This is the heart of the product; it has to be visible on day one. No-fee version leaves it out (`{{#if has_late_fee}}`).
- "Questions? Just reply to this email." (replies route to Dunn)
- Footer like the others: "Sent by Dunn for {{business_name}}"
- Tone: warm, same family as 01–08 — an invoice, not a demand.

**Subject** — designer's call. Something like: "Invoice {{invoice_id}} from {{business_name}}: {{amount_due}} due {{due_date_long}}".

**Variables already available** (same as 01–08): `business_name`, `business_email`, `owner_name`, `owner_first_name`, `client_first_name`, `invoice_id`, `amount_due`, `due_date_long`, `due_weekday`, `has_late_fee`, `fee_amount`, `grace_days`, `fee_deadline_long`, `fee_deadline_short`, `pay_url`, `mascot_url`.
**Can add on request:** `invoice_pdf_url` (Stripe's PDF), `is_recurring` + `frequency_label` ("monthly") for a "This is your monthly invoice" line.

---

## 2. Signup — capture the owner's name
Signup asks for the business name only, so emails use the **first word of the business name** as the owner's first name: "Hudson Creative" emails end "Reply to reach Hudson"; "Blue Oak Studio" would say "Reply to reach Blue."

- Add **Your name** above **Business name**.
- Helper text under Business name: "The name your clients know you by — it's what they'll see in every email."
- Settings tab: both editable.

---

## 3. After connecting Stripe — name check
The Stripe payment page and receipt show the **public business name on the owner's Stripe account**, which can differ from the name they gave Dunn (legal entity vs. DBA). Right after Stripe connects, Dunn reads that name and compares.

Screens needed (on the post-connect success screen):
- **Match** — nothing extra, or a small ✓ "Your clients will see Hudson Creative everywhere."
- **Mismatch** — a card with both names side by side:
  - In Dunn's emails: **Hudson Creative**
  - On the Stripe payment page and receipt: **Defiance Media LLC**
  - "Want them to match? Change your public business name in your Stripe settings."
  - Buttons: **Open Stripe settings** · **It's fine, continue**
  - One line: "Your client's bank statement shows the name on your Stripe account — make sure it's one they'll recognize."
- **Couldn't read the Stripe name** — skip the card, continue.

---

## 4. Onboarding tip — turn off Stripe's own reminders
Stripe can email its own invoice reminders. If the owner has that on, clients get Stripe's reminders **on top of** Dunn's. One short line in onboarding (and in Settings/Help): "Turn off Stripe's invoice reminder emails — Dunn handles reminders for you." (Exact Stripe menu path confirmed at build time — Stripe renames menus.)

---

## Engineering, once these land
- Stop Stripe sending the initial invoice; Dunn sends template 00 on create and on each recurring run; delivery recorded (Resend).
- Owner name: signup + settings API, DB field, `owner_first_name` in every email.
- At Stripe connect: read the account's public business name, pass both names to the success screen.
