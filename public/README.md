# Watchtower: plain HTML + CSS screens

Drop the whole folder into `public/`. There's no build step and no framework.

| File | What it is |
|---|---|
| `watchtower.css` | All styles. Every color, font, radius and shadow is a CSS variable in `:root`. |
| `watchtower-ui.js` | UI-only behavior (tabs, the waive note, the modal, the fee options, the next-date default). **Makes no API calls.** It fires events for you to handle. |
| `dashboard.html` | KPI cards, fees awaiting approval (approve / waive with note), invoice list with the Fee applied status, filters and search |
| `recurring.html` | Recurring invoices list, failure banner, delete confirmation, and the New/Edit recurring invoice form (modal) |
| `onboarding-success.html` | Screen shown after the Stripe callback |
| `invoice-form-additions.html` | Snippets for your existing `index.html`: the "Make it recurring" link, the returning-client notice and the fee preview line |
| `lighthouse-transparent.png` | Mascot |

## How to wire it
- **Single values:** elements with `data-bind="field_name"`. Replace their text.
- **Lists:** containers with `data-list="…"`, plus a matching `<template id="tpl-…">`. Clone the template per row, replace the `{placeholders}`, then delete the sample rows.
- **Status → class:** mapping tables are in HTML comments at the top of each list.
- **Events:** listen on `document`:

```js
document.addEventListener('wt:approve-fee', e => api.post(`/invoices/${e.detail.invoiceId}/fee/approve`));
document.addEventListener('wt:waive-fee',   e => api.post(`/invoices/${e.detail.invoiceId}/fee/waive`, { note: e.detail.note }));
document.addEventListener('wt:filter',      e => loadInvoices({ status: e.detail.status }));
document.addEventListener('wt:search',      e => loadInvoices({ q: e.detail.query }));
document.addEventListener('wt:open-invoice', e => openQuickView(e.detail.id));
document.addEventListener('wt:recurring-save',   e => api.save('/templates', e.detail.data));
document.addEventListener('wt:recurring-toggle', e => api.patch(`/templates/${e.detail.id}`, { status: e.detail.active ? 'active' : 'paused' }));
document.addEventListener('wt:recurring-delete', e => api.del(`/templates/${e.detail.id}`));
document.addEventListener('wt:recurring-edit',   e => fillRecurringForm(e.detail.id));
```

The endpoint paths above are examples. Use yours.

- **Open the modal from code:** `WatchtowerUI.openModal('wt-recurring-modal')`

## States you control
- `.is-active` on `.wt-filter`: the current filter
- `.is-waiving` on `.wt-fees__row`: the note field is showing (the JS sets this)
- `.is-paused` on `.wt-recurring__item`: dimmed row. Also swap the toggle icon to play and its label to "Resume"
- `.is-deleting` on `.wt-recurring__item`: the delete confirmation is showing (the JS sets this)
- `[hidden]`: the empty states, the recurring failure banner, the edit-only note, the custom-day row, the flat/% inputs

## Recurring form field names (FormData)
`id`, `client_name`, `client_email`, `amount`, `frequency` (`monthly|biweekly|weekly|custom`), `custom_day` (`1–28|last`), `next_invoice_date` (YYYY-MM-DD), `status` (`active|paused`), `grace_days`, `fee_type` (`none|flat|pct`), `fee_flat`, `fee_pct`

When editing, set `next_invoice_date`'s `data-touched="true"` after filling it, so the JS doesn't overwrite the saved date.

The full behavior rules are in `../WATCHTOWER-HANDOFF.md`, sections 3.1–3.8.
