# Watchtower client emails: Handlebars

Eight send-ready templates. Table-based layout, every style inline, no web fonts, Outlook fixes, a dark-mode meta tag, and a hidden preheader. Each file is under 12KB, well below Gmail's ~100KB clipping limit.

Render with Handlebars and send the output as the HTML body. The subject line is in each file's top comment and in its <title>. Render the title with the same data.

## Files
| File | Trigger | Subject |
|---|---|---|
| 01-upcoming-7-days-before.hbs.html | 7 days before due date | Invoice {{invoice_id}} is due next {{due_weekday}} |
| 02-upcoming-3-days-before.hbs.html | 3 days before due date | Invoice {{invoice_id}} is due {{due_weekday}} |
| 03-due-today.hbs.html | On the due date | Invoice {{invoice_id}} is due today |
| 04-past-due-3-days-after.hbs.html | 3 days after due date | Invoice {{invoice_id}} is a few days past due |
| 05-past-due-7-days-after.hbs.html | 7 days after due date | {{#if has_late_fee}}Invoice {{invoice_id}}: late fee applies after {{fee_deadline_short}}{{else}}Invoice {{invoice_id}} is a week past due{{/if}} |
| 06-fee-applied.hbs.html | When the owner approves a late fee (never sent if no fee) | A late fee has been added to invoice {{invoice_id}} |
| 07-past-due-14-days-after.hbs.html | 14 days after due date | Invoice {{invoice_id}} is two weeks past due |
| 08-paid.hbs.html | When payment clears | Payment received. Thank you |
| 10-cancelled.hbs.html | The owner cancels the invoice in Dunn | Invoice {{invoice_id}} has been cancelled |

`preview/` holds each email rendered with `sample-data.json`. Open them in a browser to check.

## Variables
| Variable | Example | Notes |
|---|---|---|
| business_name | Rivera Studio | The sender everywhere. Emails come from the business, not from Watchtower |
| business_email | billing@riverastudio.co | Also set it as Reply-To |
| business_address | 214 Harbor Street, Portland, ME 04101 | Footer |
| owner_name / owner_first_name | Marta Rivera / Marta | Sign-off |
| client_first_name | Dana | Greeting |
| invoice_id | WT-2241 | |
| amount_due | $3,240.00 | Pre-formatted with currency |
| fee_amount | $75.00 | The flat amount, or the computed % amount |
| balance_due | $3,315.00 | amount_due + fee |
| grace_days | 7 | |
| due_date_long | Monday, October 12 | |
| due_weekday | Monday | |
| fee_deadline_long / fee_deadline_short | Monday, October 19 / Oct 19 | due date + grace_days |
| paid_amount / paid_date_long / payment_method | $3,240.00 / October 7 / ACH | 08 only |
| pay_url / receipt_url | https://… | |
| mascot_url | https://… | **Must be a public HTTPS URL.** Use lighthouse-transparent.png (278×454). It displays at 25×40 in the header and 11×18 in the footer |
| has_late_fee | true/false | Invoice has fee terms (fee_type ≠ none) |
| fee_applied | true/false | Fee approved and added (07 only) |

## Rules
- Never send **06-fee-applied** when has_late_fee is false. It's sent only after the owner approves the fee.
- 04, 05 and 07 drop their fee sentences automatically when has_late_fee / fee_applied is false.
- There's no red anywhere. Status chips are ink, amber or warm tan; Paid is green.
- These are transactional emails, so there's no unsubscribe link. The business address is in the footer.
