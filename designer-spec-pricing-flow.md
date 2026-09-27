# Watchtower — Designer Update Spec
Pricing change + signup flow. Send to the designer; everything below replaces what's on the current landing page.

---

## 1. The pricing change (landing page)

The landing page currently shows **one tier: "$29.99 / month per business."** That is now wrong. Replace it with **two tiers** that name what you get, not who you are.

| Tier | Price | What it says |
|---|---|---|
| 1 | $39 / month | **Up to 10 invoices / month** |
| 2 | $59 / month | **Unlimited invoices** |

Rules:
- Do NOT use "Solo" / "Business" labels. Name the cap. Reason: a business will always self-select the cheaper tier if the split is "are you a business?" — the only way to sort buyers honestly is by how many invoices they actually send. So the labels describe the invoice count, and the price tiers sort themselves.
- The value line must lead with **money recovered**, not "send invoices." Examples: "Watchtower chases late invoices so you don't have to — and adds the late fee you agreed on." The $39/$59 price only holds because of the late-fee/recovery wedge; plain invoice-sending apps cost $7–$23, so leading with "send invoices" makes Watchtower look overpriced.
- "Most popular" badge / which tier to emphasize: your call (recommend no badge, or mark the $39 tier as the default).

## 2. Tier → button mapping

Each tier card has a CTA button ("Start watching" or similar). The two buttons differ ONLY by the `plan` values they carry:

- $39 card → `plan: "solo"`
- $59 card → `plan: "business"`

(Those are internal code keys; the visible labels are "up to 10 invoices" and "unlimited" — don't show "solo"/"business" anywhere.)

## 3. How the button behaves

Two cases:

- **Visitor is signed out** → link to `/login?plan=solo` or `/login?plan=business`. The `plan` carries through the signup form; after the account is created, checkout starts automatically.
- **Visitor is signed in** → call `POST /billing/checkout` with `{ plan: "solo" | "business" }`, get back `{ url }`, then do a full-page redirect to that url (it's Stripe's hosted checkout page — not a fetch, not an iframe).

After checkout succeeds, Stripe returns the user to `/dashboard?checkout=success`. There is nothing to design for checkout itself — it's Stripe's page.

If the account already has a plan, the buttons are replaced by a single **"Manage plan"** link that calls `POST /billing/portal` and redirects to the returned url.

## 4. Landing page routing — currently broken, fix to:

- "See how it works" (×2) → currently points at a local prototype file (404 in production). Change to `/demo`.
- "Pricing" (nav) → currently `#how`. Point to the pricing section.
- "Privacy" (nav) → currently `#how`. Point to the privacy section.
- "create your first invoice" → currently `#` (dead). Point to `/login` (or `/dashboard` if signed in).

## 5. Signup → Connect Stripe → dashboard (backend now correct)

The whole flow now works end-to-end on the backend. The designer's screens just need to match:

1. Landing → sign up / sign in at `/login`.
2. Connect Stripe → the OAuth callback now links the Stripe account to the signed-up account (no more duplicate account).
3. After connecting, the browser lands on **`/onboarding-success.html?open_invoices=N&clients=N&past_due=N`**. Bind those three values from the URL query string into the success screen's three count cards.
4. Success screen buttons:
   - "Go to dashboard" → `/dashboard`
   - "Set default late-fee terms" → open the **Settings tab** inside the dashboard (`/dashboard#settings`). Do NOT link to a separate settings.html.

## 6. In-app pages: everything is one dashboard

`Settings`, `Clients`, and `Reports` are **tabs inside `dashboard.html`**, matching your original single-file prototype (Dashboard · Invoices · Recurring · Clients · Reports · Settings in the sidebar). Do not build separate `settings.html` / `clients.html` / `reports.html` files — wire them as tabs/views within the existing dashboard, with the sidebar items switching views.

## 7. Already handled by the developer — no design needed

- 10-invoice cap on the $39 tier, auto-blocked with an upgrade prompt.
- Subscription checkout, Stripe webhooks, and account linking.
- Login/signup session handling (http-only cookie).

---

Questions for the designer, if any, respond in this thread. Otherwise proceed and hand back the updated landing page + any new pages from §6.