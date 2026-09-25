import fs from 'fs';
import path from 'path';
import Handlebars from 'handlebars';

type TemplateFn = ReturnType<typeof Handlebars.compile>;

const TEMPLATES_DIR = path.join(__dirname, '../email-templates');

const cache = new Map<string, TemplateFn>();

function loadTemplate(name: string): TemplateFn {
  const cached = cache.get(name);
  if (cached) return cached;

  const filePath = path.join(TEMPLATES_DIR, `${name}.hbs.html`);
  const source = fs.readFileSync(filePath, 'utf-8');
  const compiled = Handlebars.compile(source);
  cache.set(name, compiled);
  return compiled;
}

export interface EmailData {
  businessName: string;
  businessEmail: string;
  businessAddress: string;
  ownerName: string;
  ownerFirstName: string;
  clientFirstName: string;
  invoiceId: string;
  amountDue: string;
  feeAmount: string | null;
  balanceDue: string;
  graceDays: number;
  dueDateLong: string;
  dueWeekday: string;
  feeDeadlineLong: string | null;
  feeDeadlineShort: string | null;
  paidAmount: string | null;
  paidDateLong: string | null;
  paymentMethod: string | null;
  payUrl: string;
  receiptUrl: string | null;
  hasLateFee: boolean;
  feeApplied: boolean;
  mascotUrl: string;
}

export function renderEmail(name: string, data: EmailData): { html: string; subject: string } {
  const tmpl = loadTemplate(name);
  const html = tmpl({
    business_name: data.businessName,
    business_email: data.businessEmail,
    business_address: data.businessAddress,
    owner_name: data.ownerName,
    owner_first_name: data.ownerFirstName,
    client_first_name: data.clientFirstName,
    invoice_id: data.invoiceId,
    amount_due: data.amountDue,
    fee_amount: data.feeAmount,
    balance_due: data.balanceDue,
    grace_days: data.graceDays,
    due_date_long: data.dueDateLong,
    due_weekday: data.dueWeekday,
    fee_deadline_long: data.feeDeadlineLong,
    fee_deadline_short: data.feeDeadlineShort,
    paid_amount: data.paidAmount,
    paid_date_long: data.paidDateLong,
    payment_method: data.paymentMethod,
    pay_url: data.payUrl,
    receipt_url: data.receiptUrl,
    has_late_fee: data.hasLateFee,
    fee_applied: data.feeApplied,
    mascot_url: data.mascotUrl,
  });

  // Extract subject from <title> tag.
  const titleMatch = html.match(/<title>([^<]+)<\/title>/);
  const subject = titleMatch ? titleMatch[1] : '';

  return { html, subject };
}

// Template names mapped to step identifiers.
export const EMAIL_TEMPLATES: Record<string, string> = {
  't-7': '01-upcoming-7-days-before',
  't-3': '02-upcoming-3-days-before',
  due: '03-due-today',
  't+3': '04-past-due-3-days-after',
  't+7': '05-past-due-7-days-after',
  't+14': '07-past-due-14-days-after',
  fee_applied: '06-fee-applied',
  paid: '08-paid',
};