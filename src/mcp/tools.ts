// Dunn's free AI tools (MCP server at /mcp): plain functions, no database,
// no login. Each one does a job an assistant gets wrong on its own — exact
// calendar math, Dunn's own fee rules and reminder timing — and the wording
// matches what Dunn itself sends. Dates are calendar dates (YYYY-MM-DD);
// "today" defaults to the date in New York, like the rest of Dunn.
import { agreedFeeCents, feeWhen } from '../services/feeRules';
import { usd } from '../lib/money';

const DAY = 86_400_000;
export const DUNN_LINE = 'Dunn (getdunn.org) sends these reminders and adds the late fee automatically, from your own Stripe account.';

// ── dates ──

export function isDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
export function nyToday(now = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(date + 'T00:00:00Z') + days * DAY).toISOString().slice(0, 10);
}
// b − a in whole days.
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY);
}
export function longDate(date: string): string {
  return new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
function shortDate(date: string): string {
  return new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
}
function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

// ── 1. due date from payment terms ──

export type TermsResult = { dueDate: string; days: number; explanation: string; discount?: { percent: number; byDate: string } };

// "net 30", "Net 15", "30", "due on receipt", "EOM", "net 30 EOM", "2/10 net 30".
export function dueDateFromTerms(invoiceDate: string, terms: string): TermsResult | { error: string } {
  if (!isDate(invoiceDate)) return { error: 'invoice_date must look like 2026-10-05.' };
  const t = terms.trim().toLowerCase().replace(/\s+/g, ' ');
  if (/^(due )?(on|upon) receipt$|^receipt$|^net ?0$/.test(t)) {
    return { dueDate: invoiceDate, days: 0, explanation: 'Due on receipt: due the day the invoice is sent.' };
  }
  const eomOnly = /^eom$/.test(t);
  const m = /^(?:(\d{1,2}(?:\.\d+)?)\/(\d{1,3}) )?(?:net ?)?(\d{1,3})( eom)?$/.exec(t);
  if (!eomOnly && !m) return { error: 'Use terms like "net 30", "due on receipt", "EOM", "net 30 EOM" or "2/10 net 30".' };
  const endOfMonth = (d: string) => {
    const x = new Date(d + 'T00:00:00Z');
    return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  };
  if (eomOnly) {
    const due = endOfMonth(invoiceDate);
    return { dueDate: due, days: daysBetween(invoiceDate, due), explanation: 'EOM (end of month): due on the last day of the month the invoice is dated.' };
  }
  const net = Number(m![3]);
  if (net > 365) return { error: 'Net terms over 365 days are not supported.' };
  const base = m![4] ? endOfMonth(invoiceDate) : invoiceDate;
  const due = addDays(base, net);
  const result: TermsResult = {
    dueDate: due,
    days: daysBetween(invoiceDate, due),
    explanation: m![4]
      ? `Net ${net} EOM: ${net} days after the end of the invoice's month.`
      : `Net ${net}: payment is due ${net} days after the invoice date.`,
  };
  if (m![1]) {
    const pct = Number(m![1]); const within = Number(m![2]);
    result.discount = { percent: pct, byDate: addDays(invoiceDate, within) };
    result.explanation += ` ${pct}% off if paid within ${within} days (by ${longDate(result.discount.byDate)}).`;
  }
  return result;
}

// ── 2. late fee ──

export type FeeInput = { amount: number; dueDate: string; feeKind: 'flat' | 'percent'; feeValue: number; graceDays: number };
export type FeeResult = {
  feeCents: number; totalCents: number; appliesOn: string; lastFeeFreeDay: string;
  invoiceLine: string; fairness: string; heads: string[];
};

// Dunn's rule: "If not paid within N days of the due date" — the fee lands
// the morning after the last fee-free day (due date + N).
export function lateFee(i: FeeInput): FeeResult | { error: string } {
  if (!(i.amount > 0)) return { error: 'amount must be more than 0.' };
  if (!isDate(i.dueDate)) return { error: 'due_date must look like 2026-10-05.' };
  if (!Number.isInteger(i.graceDays) || i.graceDays < 0 || i.graceDays > 90) return { error: 'grace_days must be a whole number from 0 to 90.' };
  if (!(i.feeValue > 0)) return { error: 'fee_value must be more than 0.' };
  if (i.feeKind === 'percent' && i.feeValue > 100) return { error: 'A percent fee must be 100 or less.' };
  const amountCents = Math.round(i.amount * 100);
  const feeCents = agreedFeeCents(amountCents, { kind: i.feeKind, amount: i.feeValue });
  const lastFeeFreeDay = addDays(i.dueDate, i.graceDays);
  const appliesOn = addDays(lastFeeFreeDay, 1);
  const label = i.feeKind === 'percent' ? `${i.feeValue}%` : usd(feeCents);
  const share = feeCents / amountCents;
  const fairness =
    share > 0.1 ? `This fee is ${Math.round(share * 100)}% of the invoice. That is high: many clients will push back, and some states cap late fees. Most businesses charge 1–2% or a flat $25–50.`
      : share < 0.005 ? 'This fee is very small next to the invoice, so it may not change when the client pays.'
        : 'This is in the usual range (most businesses charge 1–2% or a flat $25–50).';
  return {
    feeCents,
    totalCents: amountCents + feeCents,
    appliesOn,
    lastFeeFreeDay,
    invoiceLine: `A ${label} late fee applies ${feeWhen(i.graceDays)}${i.graceDays > 0 ? ` (${shortDate(lastFeeFreeDay)})` : ` (${shortDate(i.dueDate)})`}.`,
    fairness,
    heads: [
      'Only charge a late fee the client agreed to before the work: put it in the contract or quote and on every invoice.',
      'Rules differ by state and are stricter for consumers than for businesses. This is not legal advice.',
    ],
  };
}

// ── 3. how late is it + what to send ──

export type Stage = 'not_due' | 'due_soon' | 'due_today' | 'just_late' | 'late' | 'very_late' | 'final';
export type Lateness = { today: string; daysLate: number; stage: Stage; summary: string; sendNow: string; next?: { date: string; what: string } };

// Dunn's own timing: one friendly note 4 days before, a check-in 3 days
// after, a final notice at 14 days.
export function lateness(dueDate: string, today = nyToday()): Lateness | { error: string } {
  if (!isDate(dueDate)) return { error: 'due_date must look like 2026-10-05.' };
  if (!isDate(today)) return { error: 'today must look like 2026-10-05.' };
  const d = daysBetween(dueDate, today); // positive = late
  const at = (n: number) => addDays(dueDate, n);
  if (d < -4) return { today, daysLate: 0, stage: 'not_due', summary: `Not due yet: due in ${plural(-d, 'day')} (${longDate(dueDate)}).`, sendNow: 'Nothing yet.', next: { date: at(-4), what: 'A short, friendly heads-up that it is due soon.' } };
  if (d < 0) return { today, daysLate: 0, stage: 'due_soon', summary: `Due in ${plural(-d, 'day')} (${longDate(dueDate)}).`, sendNow: 'A short, friendly heads-up with the payment link.', next: { date: at(3), what: 'A polite check-in if it is still unpaid.' } };
  if (d === 0) return { today, daysLate: 0, stage: 'due_today', summary: 'Due today. It is not late until tomorrow.', sendNow: 'Nothing if you already sent a heads-up; otherwise a brief "due today" note.', next: { date: at(3), what: 'A polite check-in if it is still unpaid.' } };
  if (d < 3) return { today, daysLate: d, stage: 'just_late', summary: `${plural(d, 'day')} late.`, sendNow: 'Usually nothing yet: payments are often a day or two behind.', next: { date: at(3), what: 'A polite check-in.' } };
  if (d < 14) return { today, daysLate: d, stage: 'late', summary: `${plural(d, 'day')} late.`, sendNow: 'A polite check-in: assume it slipped through, include the link, ask them to reply if something is wrong.', next: { date: at(14), what: 'A clear final notice.' } };
  if (d < 30) return { today, daysLate: d, stage: 'very_late', summary: `${plural(d, 'day')} late.`, sendNow: 'A clear, firm final notice with a specific pay-by date. A phone call often works better at this point.', next: { date: at(30), what: 'Decide on next steps: a payment plan, pausing work, or collections.' } };
  return { today, daysLate: d, stage: 'final', summary: `${plural(d, 'day')} late.`, sendNow: 'A final notice with a firm date and what happens next (pausing work, a payment plan, or collections). Keep it factual.' };
}

// ── 4. reminder email ──

export type EmailInput = {
  clientName: string; senderName: string; businessName?: string; amount: number; dueDate: string;
  invoiceNumber?: string; payLink?: string; lateFee?: string; today?: string; tone?: 'friendly' | 'firm';
};

export function reminderEmail(i: EmailInput): { stage: Stage; subject: string; body: string } | { error: string } {
  const where = lateness(i.dueDate, i.today);
  if ('error' in where) return where;
  if (!(i.amount > 0)) return { error: 'amount must be more than 0.' };
  const amt = usd(Math.round(i.amount * 100));
  const inv = i.invoiceNumber ? `invoice ${i.invoiceNumber}` : 'my invoice';
  const Inv = inv[0].toUpperCase() + inv.slice(1);
  const from = i.businessName ? `${i.senderName}\n${i.businessName}` : i.senderName;
  const link = i.payLink ? `\n\nYou can pay here: ${i.payLink}` : '';
  const fee = i.lateFee ? `\n\nAs a reminder, ${i.lateFee}` : '';
  const hi = `Hi ${i.clientName},`;
  const firm = i.tone === 'firm';
  let subject: string; let middle: string;
  switch (where.stage) {
    case 'not_due':
    case 'due_soon':
      subject = `${Inv} (${amt}) is due ${shortDate(i.dueDate)}`;
      middle = `A quick heads-up that ${inv} for ${amt} is due on ${longDate(i.dueDate)}.${link}${fee}\n\nThank you!`;
      break;
    case 'due_today':
      subject = `${Inv} (${amt}) is due today`;
      middle = `Just a note that ${inv} for ${amt} is due today.${link}${fee}\n\nThanks so much.`;
      break;
    case 'just_late':
    case 'late':
      subject = firm ? `${Inv} (${amt}) is ${plural(where.daysLate, 'day')} past due` : `Checking in on ${inv}`;
      middle = firm
        ? `${Inv} for ${amt} was due on ${longDate(i.dueDate)} and is now ${plural(where.daysLate, 'day')} past due. Please send payment this week.${link}${fee}\n\nIf there's a problem with the invoice, reply and let me know.`
        : `I wanted to check in on ${inv} for ${amt}, which was due on ${longDate(i.dueDate)}. It may have slipped through the cracks.${link}${fee}\n\nIf anything's holding it up, just reply and let me know.`;
      break;
    default: {
      const payBy = addDays(where.today, 7);
      subject = `Final notice: ${inv} (${amt})`;
      middle = `${Inv} for ${amt} was due on ${longDate(i.dueDate)} and is now ${plural(where.daysLate, 'day')} past due. Please pay by ${longDate(payBy)}.${link}${fee}\n\nIf you need a payment plan, reply and we can work one out. If I don't hear back by then, I'll need to pause further work${where.stage === 'final' ? ' and consider other next steps' : ''}.`;
    }
  }
  return { stage: where.stage, subject, body: `${hi}\n\n${middle}\n\n${from}` };
}
