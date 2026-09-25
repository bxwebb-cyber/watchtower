# Watchtower — Design Handoff

Date: September 24, 2026
Status: design complete for dashboard, onboarding, reports, recurring invoices, settings, client emails, and landing page. Widget skipped for now.

The product name everywhere is **Watchtower**. (The recurring-invoice spec mentioned "Dunn". Please treat that as Watchtower.)

---

## 1. What's in this package

| File | What it is |
|---|---|
| `Watchtower Dashboard.html` | The whole signed-in app: Dashboard, Invoices, Recurring, Clients, Reports, Settings, onboarding, invoice quick view, New invoice form, Recurring invoice form. |
| `Watchtower Emails.html` | All 8 client emails, with final copy, subjects and preheaders. |
| `Watchtower Landing.html` | The marketing landing page (v4). |
| `static/` | **Plain HTML + CSS for the dashboard, recurring invoices and the onboarding success screen**, with real class names and CSS variables. Drop the folder into `public/`. See `static/README.md`. |
| `emails/` | **Production Handlebars templates** for all 8 client emails (`*.hbs.html`), with `preview/`, `sample-data.json` and a README listing every variable. |
| `lighthouse-transparent.png` | Mascot with a transparent background (278×454). |
| `WATCHTOWER-HANDOFF.md` | This document. |

Every file opens offline in a browser. Everything is clickable and runs on mock data held in the page. **Treat these files as the visual and behavior reference, not production code.** Rebuild them in your own stack and swap the mock data for the APIs listed below.

To view the prototype's onboarding: go to **Settings → Stripe → Disconnect**. You'll get the empty state; click **Connect Stripe** to see the success screen.

---

## 2. Design tokens

### Color
| Token | Hex | Use |
|---|---|---|
| ink | `#0F302E` | Primary buttons, headings, active nav, dark panels |
| ink-hover | `#164543` | Primary button hover |
| text | `#16302E` | Body text |
| text-muted | `#5D6E6B` | Secondary text |
| text-subtle | `#7C8B88` | Captions, meta |
| text-faint | `#9AA5A2` | Table headers, placeholders |
| paper | `#F3F0E8` | App background |
| paper-raised | `#FDFCF8` | Cards |
| paper-sidebar | `#FAF8F2` | Sidebar |
| white | `#FFFFFF` | Inputs, printable invoice |
| eyebrow | `#8A7A55` | Small uppercase labels |
| brick | `#B23A2E` | Overdue, errors, destructive actions |
| amber | `#C07A2C` | Due soon, pending fees, badges |
| amber-text | `#96631F` | Amber text on light backgrounds |
| green | `#2E6F53` | Paid, money received, success |
| on-ink | `#E4E9E4` / `#C9D4D0` / `#9FB3AE` | Text on dark ink panels |
| fee-gold | `#E8B26A` | Selected fee option / label on the dark fee panel |

Color rule: brick appears only where something is wrong, and green only where money came in. **Client emails never use brick.**

### Status pills
| Status | Background | Text |
|---|---|---|
| Paid | `rgba(46,111,83,.12)` | `#2E6F53` |
| Due soon | `rgba(192,122,44,.14)` | `#96631F` |
| Pending | `rgba(15,48,46,.07)` | `#46605C` |
| Overdue | `rgba(178,58,46,.11)` | `#B23A2E` |
| Fee applied | `#F0D9D3` | `#7A261D` |
| Active (recurring) | same as Paid | |
| Paused (recurring) | `rgba(15,48,46,.07)` | `#5D6E6B` |

### Type
- **Display:** Playfair Display 400, italic for emphasis ("Good evening, Marta. *2 overdue, 2 due this week.*"). Used for headings, money amounts and card titles.
- **UI / body:** Inter 400/500/600.
- Scale: page H1 `clamp(28px, 3.2vw, 40px)`; card title 20px; KPI value 34px; body 14px; captions 12.5px; eyebrow labels 11px uppercase, letter-spacing `.14–.22em`.

### Shape and depth
- Cards: radius 14px; shadow `0 0 0 1px rgba(15,48,46,.07), 0 10px 20px -12px rgba(15,48,46,.18)`
- Buttons: radius 10px, height 44–46px (primary); small actions 32–38px
- Inputs: radius 9px, height 42px, border `1px solid rgba(15,48,46,.18)`
- Pills: radius 999px
- Motion: 200ms transitions on all interactive elements. Modals pop in (300ms, `cubic-bezier(.16,1,.3,1)`); the quick view slides in from the right (350ms).

### Mascot
✅ Use `lighthouse-transparent.png` (transparent background, cropped). You no longer need `mix-blend-mode: multiply` or the cream plate behind it on dark panels. It's 278×454 px, cut from a 512px source, so keep it at about 150px tall or smaller in the UI. For bigger uses (the landing hero at 360px), ask for a higher-resolution original. The yellow lamp glow was cut off at its edge rather than faded, so on dark backgrounds it shows as a pale disc with a hard rim. Until there's a proper transparent export from the original artwork, use it on paper and light backgrounds.

---

## 3. Screen by screen: what's designed, and the API behind it

### 3.1 Dashboard
**APIs:** `GET /invoices`, `GET /reports/revenue`

**Header**
- Eyebrow: today's date. Greeting: "Good evening, {firstName}." The italic line is generated from counts:
  - overdue > 0 and due soon > 0 → "{n} overdue, {m} due this week."
  - overdue only → "{n} overdue, the rest on watch."
  - due soon only → "{m} due this week."
  - neither → "All quiet tonight."
- ⚠️ The prototype hardcodes "Tuesday, September 23" and "Good evening". Use the real date and time of day (morning / afternoon / evening).

**Four KPI cards (in this order)**
| Card | Value | Subline |
|---|---|---|
| Overdue | count of Overdue + Fee applied | "$X owed, incl. fees" |
| Collected this month | sum paid this calendar month | "N invoices paid in {Month}" |
| Fee revenue | fees collected + fees billed | "$X collected · $Y billed" |
| Pending fees | sum of fees awaiting approval | "N awaiting your approval" or "Nothing to approve" |

**Fees awaiting your approval** (appears only when there's at least one)
- Row: client · invoice ID, a line with the reason ("9 days late · 7-day grace period passed · flat fee"), fee amount, and **Waive** / **Approve fee** buttons.
- **Approve** → fires the fee engine. The invoice's status becomes **Fee applied**.
- **Waive** → opens an inline note field, "Why are you waiving it? (optional — only you see this)", with **Cancel** and **Waive $X**. Send the note with the request. The note shows in the invoice's activity log as `Late fee waived by you — "note"`.
- The sidebar Dashboard item shows an amber badge with the pending count.

**Days to get paid** (bar chart, 12 months)
- The average number of days from issue to payment, per month. Bars before Watchtower are faded; bars after are ink. The headline shows the current month plus a "↓ from X" pill.
- ⚠️ **This needs an API field**: the monthly average days-to-paid. It isn't in `/reports/revenue` today. Either add it, or hide the card until it exists.

**Who's always late** (top 3 + "See all clients →")

**Recent invoices table** (also the full Invoices page)
- Columns: Invoice · Client (avatar initials, name, email) · Due (relative: "in 4 days", "9 days late", "Paid Sep 12") · Amount · Status pill
- Filters: All · Overdue · Fee applied · Due soon · Pending · Paid, each with its count
- Search matches client name, invoice ID and email
- Clicking a row opens the **Quick view** (3.2)

### 3.2 Invoice quick view (slide-over)
- A printable invoice: business header, bill-to, issued and due dates, line items, subtotal, tax, late fee (only if approved or collected), total, payment terms, and the "Sent and tracked by Watchtower" footer.
- **Payment terms** text comes from the invoice's fee settings: "A late fee of $75 applies if unpaid 7 days after the due date." (or "No late fee applies.")
- **Activity log** events: sent, reminder sent, fee pending approval, fee approved, fee waived (+ note), paid.
- Footer button depends on status: Paid → "Send receipt"; Overdue / Fee applied → "Send final notice"; otherwise → "Send reminder now". **Download PDF** uses the print stylesheet.
- ⚠️ Tax (8%) and the business address are hardcoded in the prototype. They should come from account settings.

### 3.3 Status model: please align with this
| Status | Rule |
|---|---|
| Pending | unpaid, due in more than 7 days |
| Due soon | unpaid, due within 7 days |
| Overdue | unpaid, past due, no fee applied |
| Fee applied | unpaid, past due, fee approved and added |
| Paid | paid (keeps any collected fee in the total) |

Each invoice also needs a `fee_state`: `none | pending | approved | waived | collected`, plus `waive_note` (nullable), `fee_type` (`none | flat | pct`), `fee_value`, and `grace_days`.

### 3.4 New invoice form: keep **your** form (`public/index.html`), with these additions
Your form stays the production form. Bring it in line with the design:
1. **Fee preview line** under the fee section, updating live:
   - none → `Your client sees: No late fee.`
   - flat → `Your client sees: "A $50 late fee applies if unpaid by October 30."` (due date + grace days)
   - pct → `Your client sees: "A 5% late fee ($60.00) applies if unpaid by October 30."`
2. **Returning-client notice**: when the email is recognized on blur and terms are prefilled, show a green note under the email fields: "Returning client. Terms from WT-2236 prefilled — change them if you like."
3. **"Bill this on a schedule? Make it recurring"** link at the bottom left. It opens the recurring invoice form with client, email, amount and fee terms carried over.
4. Restyle to the tokens above. The fee section is a dark ink panel (`#0F302E`) with three option tiles. The selected tile is cream with a gold border.
5. The submit button stays disabled (gray `#9AA5A2`) until client name, a valid email, amount > 0 and a due date are filled in, and the chosen fee has a value.

### 3.5 Recurring invoices (new page; your backend spec)
**UI naming (important):** on screen it's **Recurring invoices**, not "Templates". Sidebar: **Recurring**. Buttons: **New recurring invoice**, **Save recurring invoice**, **Delete recurring invoice**. Keep `templates` as the backend and table name if you like.

**Why a separate page (not a toggle on the invoice form):** sending now and setting a schedule are different commitments, and the list needs a home anyway. The invoice form only links to it.

**List columns**
| Column | Content |
|---|---|
| Client | name; amount + fee label ("$50 late fee" / "2% late fee" / "No late fee") |
| Schedule | frequency label + "Next Oct 1" (or "Paused") |
| Last invoice | date + result: **Sent** (green) / **Failed, will retry** (brick) / "None yet" |
| Status | Active / Paused pill |
| Actions | icon buttons: Edit (pencil), Pause ⇄ Resume (bars ⇄ play), Delete (trash) |

Paused rows are dimmed to about 60% opacity.

**Frequency labels:** `monthly` → "Monthly" · `biweekly` → "Every 2 weeks" · `weekly` → "Weekly" · `custom` → "Monthly, 15th" / "Monthly, last day"

**Form fields:** client name, client email, amount, frequency (`monthly | biweekly | weekly | custom`), custom day (`1–28 | last`, shown only for custom: "Send on the [15th] of every month"), next invoice date, status (Active / Paused), and the fee prompt (grace days + none / flat / pct), with the same live "Your client sees" preview.

**Next-date default:** today + interval (weekly +7 days, biweekly +14 days, monthly = same day next month, clamped to the month's length; custom = the next occurrence of that day). It recalculates when frequency or day changes, **until the owner edits the date by hand**. After that, keep their date.

**Edit mode** shows: "Changes apply to future invoices only. The {sent_count} already sent stay as they are." → the API needs `sent_count` per template.

**Delete** is an inline confirmation: "Delete the {client} recurring invoice? The {n} invoices already sent stay exactly as they are." → **Keep it** / **Delete recurring invoice**

**Failure banner** (top of the page, one per failed active template):
> **{Client}'s invoice couldn't be created on {date}.** {last_error}. It stays active and retries on {next_date}. We logged it and emailed you at {owner_email}. [Check Stripe connection]

→ The API needs `last_run_at`, `last_run_ok`, `last_error` per template.

**Decision needed from you:** when a paused template is resumed after its next date has passed, **skip to the next cycle** (recommended) rather than sending the missed invoice right away. Show the new "Next" date so the owner can change it.

### 3.6 Clients: Who's always late
- Columns: Client (name + industry · client since) · Paid late (bar + "8 of 9") · Avg days late · Fees paid · Open balance
- Bar color: brick when 50% or more are late, amber at 20–49%, green below 20%.
- ⚠️ **Needs an API**: per-client late count / total invoices, average days late, total fees paid and open balance. It's not in your ready list. Could it be `GET /clients/lateness`?

### 3.7 Reports
**APIs:** `GET /reports/revenue?month=YYYY-MM`, `GET /reports/export.csv`
- Month dropdown (12 months) and **Download CSV**
- Three stats: Invoice revenue · Fee revenue · Total collected (+ "↑ 10% vs Aug")
- A split bar showing invoice vs. fee share, and "Late fees were 2.5% of what came in."
- Breakdown rows: Invoices paid (count, $) · Late fees collected (count, $) · Fees waived ($, "not counted as revenue") · Total collected
- 12-month stacked bar trend (invoices in ink, fees in green). Clicking a bar selects that month.
- ⚠️ The prototype builds the CSV in the browser. **Point the button at `/reports/export.csv`.** The prototype's columns are Month, Invoices paid, Invoice revenue, Late fees collected, Fee revenue, Fees waived, Total. Please match them, or tell me yours and I'll update the design.
- The fields per month the design needs: `invoice_revenue`, `fee_revenue`, `invoices_paid_count`, `fees_collected_count`, `fees_waived_amount`.

### 3.8 Onboarding
- **Empty state** (no Stripe connection): a dark panel with the mascot, "The watch hasn't *started yet.*", a **Connect Stripe** button → `href="/auth/stripe/start"`, and "About two minutes. Watchtower only reads invoices and customers." Next to it: "What happens next" in 3 steps. Below: "No clients yet." with **Create your first invoice**.
- **Success screen** (after the Stripe callback): "Stripe connected" pill, "Watchtower is *on watch.*", three counts (open invoices · clients · already past due), then **Go to dashboard** and **Set default late-fee terms**.
- ⚠️ The success counts need data. Either count from `/invoices` after the sync, or have the callback return `{open_invoices, clients, past_due}`.
- While not connected, the header "Create new invoice" button is hidden and the pending-fee badge is suppressed.

### 3.9 Settings
- **Stripe card:** status ("Connected as {account name} · acct_…") with **Disconnect**, or "Not connected" with **Connect Stripe**.
- **Owner alerts:** owner email (where Watchtower sends alerts; clients never see it) plus three toggles:
  - "A late fee needs my approval" (default on)
  - "An invoice goes overdue" (default on)
  - "A client pays" (default off)
- **Save** → "Saved. Alerts go to {email}"
- ⚠️ **Needs an API**: `GET/PUT /settings` for `owner_email` and `alerts`.
- The sidebar profile shows the owner's name and email.

---

## 4. Client emails (8)

See `Watchtower Emails.html` for the final copy. Each one is sent **from the business** (Rivera Studio in the mock), signed by the owner, with a small "Sent by Watchtower for {business} · Reply to reach {owner}" footer.

| # | Trigger | Subject |
|---|---|---|
| 01 | T−7 | Invoice {id} is due next {weekday} |
| 02 | T−3 | Invoice {id} is due {weekday} |
| 03 | Due date | Invoice {id} is due today |
| 04 | T+3 | Invoice {id} is a few days past due |
| 05 | T+7 | Invoice {id}: late fee applies after today |
| 06 | Fee approved | A late fee has been added to invoice {id} |
| 07 | T+14 | Invoice {id} is two weeks past due |
| 08 | Paid | Payment received. Thank you |

Layout: single column, max 600px, 16px body text, full-width 50px button, a summary box (invoice / amount / due, or original / late fee / balance), and a terms line at the bottom (left off the Paid email).

Rules:
- No red anywhere in client emails. Status chips are ink, amber or warm tan; Paid is green.
- Email 05 must use the invoice's real grace days. The copy assumes a 7-day grace period, so "after today" only works when grace = 7. Otherwise say "after {date}".
- If an invoice has no fee, drop the fee sentences from 04, 05 and 07, and never send 06.
- ✅ **Production build done:** `emails/*.hbs.html` are send-ready Handlebars templates: table-based, inline styles, Outlook VML button, dark-mode meta, hidden preheader, about 9KB each. See `emails/README.md` for the variables. Host `lighthouse-transparent.png` at a public HTTPS URL and pass it as `mascot_url`.

---

## 5. Hardcoded in the prototype: replace with real data
- Date "Tuesday, September 23" and the "Good evening" greeting
- Owner "Marta Rivera", "Rivera Studio", the business address, billing email
- Sales tax 8%
- The days-to-paid chart values, the client lateness table, the report months
- Stripe account ID string

---

## 6. Open questions for you
1. Do per-client lateness data (3.6) and monthly days-to-paid (3.1) exist? If not, can they be added, or should those cards be hidden for v1?
2. Resuming a paused recurring invoice after its date has passed: OK to skip to the next cycle?
3. What columns does `/reports/export.csv` produce?
4. ~~Email template engine~~: Handlebars, done.
5. ~~Transparent mascot~~: done (see file).

Widget mockups: parked until you're ready.
