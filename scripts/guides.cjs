#!/usr/bin/env node
// Builds the Guides section (public/guides/*.html): answer pages for what
// small-business owners search ("how to charge a late fee", "invoice reminder
// email"). Each page answers first, then shows how Dunn does it.
// Edit the content here and run: node scripts/guides.cjs
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '../public/guides');
const UPDATED = 'September 30, 2026';
const ORG = { '@type': 'Organization', name: 'Dunn', url: 'https://getdunn.org/' };

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function page({ slug, title, description, body, faq = [] }) {
  const url = `https://getdunn.org/guides/${slug}`;
  const schema = [
    { '@context': 'https://schema.org', '@type': 'Article', headline: title, description, dateModified: '2026-09-30', author: ORG, publisher: ORG, mainEntityOfPage: url },
  ];
  if (faq.length) {
    schema.push({
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
    });
  }
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Dunn</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="article">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="https://getdunn.org/lighthouse-transparent.png">
<link rel="icon" href="/lighthouse-transparent.png">
<link rel="stylesheet" href="/legal.css">
<script type="application/ld+json">${JSON.stringify(schema.length === 1 ? schema[0] : schema)}</script>
</head>
<body>
<header class="lg-head"><a href="/" class="lg-brand"><img src="/lighthouse-transparent.png" alt="">Dunn</a></header>
<main class="lg">
<p class="lg-crumb"><a href="/guides">Guides</a></p>
<h1>${esc(title)}</h1>
<p class="lg-date">Updated ${UPDATED}</p>
${body.trim()}
${faq.length ? `<h2>Quick answers</h2>\n${faq.map(([q, a]) => `<p><strong>${esc(q)}</strong><br>${esc(a)}</p>`).join('\n')}` : ''}
<div class="lg-cta">
<h2>Let Dunn do the chasing</h2>
<p>Dunn sends the reminder before the due date, adds the late fee you agreed on, and keeps the record. Works with your Stripe. From $39 a month.</p>
<a class="lg-btn" href="/#pricing">Start watching</a>
</div>
</main>
<footer class="lg-foot">© 2026 Defiance Media LLC · <a href="/">Dunn</a> · <a href="/guides">Guides</a> · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a></footer>
</body>
</html>
`;
}

const GUIDES = [
  {
    slug: 'how-to-charge-a-late-fee-on-an-invoice',
    title: 'How to charge a late fee on an invoice',
    blurb: 'How much to charge, when it applies, and how to make it stick.',
    description: 'How to charge a late fee on an invoice: typical amounts, grace periods, what to put in writing first, and how to apply it without damaging the client relationship.',
    body: `
<p class="lg-lede">You can charge a late fee on an invoice if your client agreed to it before the work started. Put the fee and when it applies in your contract and on every invoice, then apply it the same way every time.</p>
<div class="lg-answer"><strong>The short version:</strong> agree on the fee up front, show it on the invoice ("A $25 late fee applies if unpaid 7 days after the due date"), send a reminder before it hits, and apply it on the day you said.</div>

<h2>1. Agree on it before the work</h2>
<p>A late fee works when it's a term your client already said yes to, not a surprise. Add a line to your contract, proposal or quote. If you don't use contracts, put it in writing in the email where they accept your price.</p>

<h2>2. Pick an amount</h2>
<ul>
<li><strong>Flat fee:</strong> a set amount, like $25 or $50. Simple and easy to understand. Good for smaller invoices.</li>
<li><strong>Percentage:</strong> often 1% to 2% of the unpaid amount. Scales with bigger invoices.</li>
</ul>
<p>Keep it proportionate. A fee that feels like a penalty invites a fight; one that feels fair gets paid. Some states limit late fees and interest, and rules are stricter when your client is a consumer rather than a business, so check what applies where you and your clients are.</p>

<h2>3. Decide when it applies</h2>
<p>Choose between the day after the due date or a short grace period, like 7 days. A grace period gives good clients room for a slow bank transfer. Whatever you pick, say it plainly on the invoice.</p>

<h2>4. Show it on every invoice</h2>
<p>Write the terms in the invoice notes, for example: <em>"Payment due October 15. A $25 late fee applies if unpaid 7 days after the due date."</em> This is your proof the client was told.</p>

<h2>5. Remind before it hits</h2>
<p>Most late payments are forgetfulness, not refusal. A friendly reminder a few days before the due date gets many invoices paid on time, so you never need the fee. If it does go late, send one notice saying when the fee will be added.</p>

<h2>6. Apply it, or waive it on purpose</h2>
<p>When the deadline passes, add the fee as a new line on the invoice. If you decide to waive it for a good client, do it deliberately and say so. Apply your terms consistently, or clients learn they're optional.</p>

<h2>How Dunn handles it</h2>
<p>You set the fee (flat or percentage) and when it applies. Dunn writes the terms onto the invoice, sends a reminder 4 days before the due date and a warning before the fee lands, then puts one updated bill in front of your client. You can approve, lower or waive any fee, and every email and reply is kept as your record.</p>`,
    faq: [
      ['Can I charge a late fee if it was not in my contract?', 'It is much harder to enforce. Add late fee terms to your contract or quote before the work, and show them on every invoice.'],
      ['How much is a normal late fee?', 'Commonly a flat $25 to $50, or 1% to 2% of the unpaid amount. Check the limits where you and your clients are.'],
      ['Should I give a grace period?', 'Many businesses give 7 days. Whatever you choose, state it on the invoice so the client knows exactly when the fee applies.'],
    ],
  },
  {
    slug: 'invoice-reminder-email-templates',
    title: 'Invoice reminder email templates (before and after the due date)',
    blurb: 'Copy-and-paste reminders that get paid without sounding pushy.',
    description: 'Friendly invoice reminder email templates to send before the due date, on the day, and after it is late, plus how many reminders to send so clients do not feel nagged.',
    body: `
<p class="lg-lede">The best reminder is short, friendly, and arrives before the invoice is late. Here are templates for each stage. Swap in your details and keep your own voice.</p>
<div class="lg-answer"><strong>How many to send:</strong> one reminder a few days before the due date, then one or two after. More than that starts to read as nagging.</div>

<h2>A few days before it's due</h2>
<div class="lg-template"><b>Subject: Invoice 1042 is due Friday</b>Hi Dana,

Just a heads-up that invoice 1042 for $1,500.00 is due this Friday, October 15. You can pay it here: [payment link]

No action needed if it's already scheduled. Thank you!
Marta</div>

<h2>On the due date</h2>
<div class="lg-template"><b>Subject: Invoice 1042 is due today</b>Hi Dana,

A quick reminder that invoice 1042 for $1,500.00 is due today. Here's the link to pay: [payment link]

Thanks so much,
Marta</div>

<h2>A few days late</h2>
<div class="lg-template"><b>Subject: Invoice 1042 is past due</b>Hi Dana,

Invoice 1042 for $1,500.00 was due on October 15 and is still open. As agreed on the invoice, a $25 late fee applies if it's unpaid by October 22.

You can pay here: [payment link]. If something's holding it up, just reply and let me know.

Thank you,
Marta</div>

<h2>Two weeks late</h2>
<div class="lg-template"><b>Subject: Final notice: invoice 1042</b>Hi Dana,

Invoice 1042 is now two weeks past due. The balance is $1,525.00, including the $25 late fee in our terms.

Please pay by [date] here: [payment link], or reply so we can sort it out together.

Thank you,
Marta</div>

<h2>What makes reminders work</h2>
<ul>
<li><strong>Send one before the due date.</strong> Most late invoices are forgotten, not disputed.</li>
<li><strong>Put the payment link in every email.</strong> One click beats "log in and find it."</li>
<li><strong>Say the amount and date.</strong> No guessing, no back-and-forth.</li>
<li><strong>Stay warm.</strong> No red text, no legal threats. You want to keep the client.</li>
<li><strong>Stop when they reply.</strong> A reminder landing after they've answered feels robotic.</li>
</ul>

<h2>How Dunn handles it</h2>
<p>Dunn sends these for you, in your business's name: the invoice, one reminder 4 days before the due date, and notices after. When a client replies, Dunn pauses the reminders and forwards the reply to you.</p>`,
    faq: [
      ['When should I send an invoice reminder?', 'A few days before the due date works best, since most late payments are simply forgotten. Then send one or two after the due date.'],
      ['How many payment reminders is too many?', 'More than three or four, or more than one a week, starts to feel like nagging. One before and one or two after the due date is usually enough.'],
    ],
  },
  {
    slug: 'what-to-say-when-a-client-pays-late',
    title: 'What to say when a client pays late',
    blurb: 'Polite scripts for emails and calls, from first nudge to final notice.',
    description: 'Exactly what to say when a client pays late: polite scripts for the first follow-up, a phone call, a payment plan, and a final notice, without losing the client.',
    body: `
<p class="lg-lede">Assume good faith first, be specific about the amount and date, and make paying easy. Most clients who pay late aren't trying to stiff you; they're busy, and your invoice slipped.</p>
<div class="lg-answer"><strong>The formula:</strong> friendly opener + the invoice number, amount and date + a payment link + an easy way to tell you what's wrong.</div>

<h2>The first follow-up</h2>
<div class="lg-template"><b>Email</b>Hi Dana, I'm following up on invoice 1042 for $1,500.00, which was due October 15. Could you let me know when it's scheduled? Here's the payment link in case it's easier: [link]. Thanks!</div>

<h2>If they don't answer: a quick call</h2>
<div class="lg-template"><b>Phone</b>"Hi Dana, it's Marta. I'm calling about invoice 1042 from October. I wanted to check it reached the right person and see if anything's holding it up."</div>
<p>A call often works where emails don't, because it's harder to put off.</p>

<h2>If they can't pay it all</h2>
<div class="lg-template"><b>Offer a plan</b>I understand things are tight. Could we do $750 now and $750 on November 15? If that works, reply and I'll send the first invoice.</div>
<p>Getting paid in parts beats not getting paid. Put the plan in writing.</p>

<h2>If there's a dispute</h2>
<p>Ask what's wrong before you push. "Is there anything about the work or the invoice you'd like to talk through?" Fix real problems fast; it's cheaper than a standoff.</p>

<h2>The final notice</h2>
<div class="lg-template"><b>Email</b>Hi Dana, invoice 1042 is now 30 days past due, with a balance of $1,525.00 including the late fee in our terms. Please pay by November 20 or reply so we can agree on a plan. After that I'll need to pause new work until it's settled.</div>

<h2>What not to say</h2>
<ul>
<li>Threats you won't follow through on.</li>
<li>Anything angry or sarcastic in writing.</li>
<li>Vague asks like "just checking in." Say the amount and the date.</li>
</ul>

<h2>How Dunn handles it</h2>
<p>Dunn sends the follow-ups for you, in your name. When a client replies, reminders pause and the reply comes straight to you, so you can answer personally. At two weeks late, Dunn asks you whether to send a final notice or call them yourself.</p>`,
    faq: [
      ['How do I politely ask a client for late payment?', 'Be friendly and specific: name the invoice number, amount and due date, include a payment link, and ask if anything is holding it up.'],
      ['When should I stop working for a client who pays late?', 'Many businesses pause new work once an invoice is about 30 days late. Say so in your final notice, and in your contract up front.'],
    ],
  },
  {
    slug: 'dunn-vs-freshbooks-vs-wave',
    title: 'Dunn vs FreshBooks vs Wave: which is right for getting paid on time?',
    blurb: 'An honest comparison for small businesses that use Stripe.',
    description: 'Dunn vs FreshBooks vs Wave compared for invoice reminders and late fees. Which to choose depending on whether you need full accounting or just want late invoices chased.',
    body: `
<p class="lg-lede">FreshBooks and Wave are full accounting and invoicing apps. Dunn does one job: making sure your invoices get paid on time. Which is right depends on what you need.</p>
<div class="lg-answer"><strong>The short version:</strong> want bookkeeping, expenses and taxes in one place? Pick FreshBooks or Wave. Already take payments with Stripe and just want late invoices chased, fees applied and a record kept? That's what Dunn is for.</div>

<div class="lg-table-wrap"><table>
<tr><th></th><th>Dunn</th><th>FreshBooks</th><th>Wave</th></tr>
<tr><td>What it is</td><td>Invoice follow-up and late fees</td><td>Accounting + invoicing</td><td>Accounting + invoicing</td></tr>
<tr><td>Payment reminders</td><td>Yes: one before the due date, then after</td><td>Yes, up to three</td><td>Yes, on paid plans or with Wave payments</td></tr>
<tr><td>Late fees</td><td>Yes, with your approval</td><td>Yes</td><td>Check current plan</td></tr>
<tr><td>Replies pause reminders</td><td>Yes</td><td>—</td><td>—</td></tr>
<tr><td>Payments</td><td>Your own Stripe account</td><td>FreshBooks payments</td><td>Wave payments</td></tr>
<tr><td>Bookkeeping, expenses</td><td>No</td><td>Yes</td><td>Yes</td></tr>
</table></div>
<p>Features and plans change; check each company's site for current details.</p>

<h2>Choose FreshBooks if…</h2>
<p>You want one app for invoices, expenses, time tracking and reports, and you're happy to move your invoicing into it.</p>

<h2>Choose Wave if…</h2>
<p>You want free basic accounting and invoicing, and you'll upgrade for automatic reminders.</p>

<h2>Choose Dunn if…</h2>
<ul>
<li>You already use Stripe and don't want to switch systems.</li>
<li>Your real problem is clients paying late, not bookkeeping.</li>
<li>You want a reminder before the due date, late fees you approve, and reminders that stop when a client replies.</li>
<li>You want a record of every reminder, fee and reply in case a fee is questioned.</li>
</ul>
<p>Dunn costs $39 a month for up to 5 clients, or $59 for unlimited clients, and works alongside whatever accounting you already use.</p>`,
    faq: [
      ['Does FreshBooks charge late fees automatically?', 'FreshBooks can add a flat or percentage late fee automatically after a set time, and send up to three payment reminders.'],
      ['Does Wave send payment reminders?', 'Wave can send automatic payment reminders when you accept payments through Wave or are on its Pro plan.'],
      ['Can I use Dunn with FreshBooks or Wave?', 'Dunn works with invoices in your Stripe account. If your invoices live in Stripe, Dunn can chase them whatever you use for bookkeeping.'],
    ],
  },
  {
    slug: 'net-30-payment-terms-explained',
    title: 'Net 30 payment terms, explained',
    blurb: 'What Net 30 means, the common alternatives, and which to use.',
    description: 'What Net 30 means on an invoice, how it compares to Net 15, Net 60, due on receipt and 2/10 Net 30, and how to choose payment terms that get you paid faster.',
    body: `
<p class="lg-lede">"Net 30" means the full invoice amount is due 30 days after the invoice date. It's the most common payment term between businesses, but it isn't the only option, and it isn't always the best one for a small business.</p>
<div class="lg-answer"><strong>Example:</strong> an invoice dated October 1 with Net 30 terms is due October 31.</div>

<h2>Common payment terms</h2>
<div class="lg-table-wrap"><table>
<tr><th>Term</th><th>What it means</th></tr>
<tr><td>Due on receipt</td><td>Pay as soon as you get the invoice.</td></tr>
<tr><td>Net 7 / Net 15</td><td>Due 7 or 15 days after the invoice date.</td></tr>
<tr><td>Net 30</td><td>Due 30 days after the invoice date.</td></tr>
<tr><td>Net 60 / Net 90</td><td>Due 60 or 90 days after. Common with large companies.</td></tr>
<tr><td>2/10 Net 30</td><td>2% discount if paid within 10 days; otherwise the full amount is due in 30.</td></tr>
<tr><td>EOM</td><td>Due at the end of the month the invoice is sent.</td></tr>
</table></div>

<h2>Which should you use?</h2>
<ul>
<li><strong>Shorter terms get you paid sooner.</strong> Many freelancers and small businesses use Net 14 or Net 15.</li>
<li><strong>Match the client.</strong> Big companies often insist on Net 30 or longer; agree on it before you start.</li>
<li><strong>Put it on the invoice as a date.</strong> "Due October 31" is clearer than "Net 30."</li>
<li><strong>Pair it with a late fee.</strong> Terms without consequences are suggestions.</li>
</ul>

<h2>How Dunn handles it</h2>
<p>You set the due date on each invoice, and Dunn shows it as a plain date, reminds your client 4 days before, and applies your late fee if it passes. For clients you bill every week or month, Dunn creates and sends recurring invoices on schedule.</p>`,
    faq: [
      ['What does Net 30 mean on an invoice?', 'The full amount is due 30 days after the invoice date. For an invoice dated October 1, payment is due October 31.'],
      ['What does 2/10 Net 30 mean?', 'The client can take a 2% discount by paying within 10 days; otherwise the full amount is due within 30 days.'],
      ['Is Net 15 better than Net 30?', 'For a small business, shorter terms usually mean faster payment and steadier cash flow. Agree on terms with each client before the work starts.'],
    ],
  },
];

fs.mkdirSync(OUT, { recursive: true });
for (const g of GUIDES) fs.writeFileSync(path.join(OUT, `${g.slug}.html`), page(g));

const index = page({
  slug: '',
  title: 'Guides to getting paid on time',
  description: 'Practical guides for small businesses: late fees, invoice reminder emails, what to say when a client pays late, payment terms, and invoicing tools compared.',
  body: `<p class="lg-lede">Plain answers to the questions every small business hits when invoices go late.</p>
<ul class="lg-list">
${GUIDES.map((g) => `<li><a href="/guides/${g.slug}">${esc(g.title)}</a><span>${esc(g.blurb)}</span></li>`).join('\n')}
</ul>`,
}).replace('<p class="lg-crumb"><a href="/guides">Guides</a></p>\n', '').replace('https://getdunn.org/guides/"', 'https://getdunn.org/guides"').replace(/https:\/\/getdunn\.org\/guides\/</g, 'https://getdunn.org/guides<');
fs.writeFileSync(path.join(OUT, 'index.html'), index);

console.log('guides written:', GUIDES.length + 1);
module.exports = { GUIDES };
