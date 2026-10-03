// Solo ($39) plan limits (Bashira 9/29): up to 5 clients a month, and up to
// 10 invoices per client a month. Weekly billing fits (4–5 a month), so the
// cap sorts owners by how many clients they have, not how often they bill.
// Unlimited ($59) has no cap. Counted per calendar month (UTC), like before.
export const SOLO_CLIENTS_PER_MONTH = 5;
export const SOLO_INVOICES_PER_CLIENT = 10;

export function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

const norm = (email: string | null | undefined) => (email ?? '').trim().toLowerCase();

// clientEmailsThisMonth: one entry per invoice created this month (repeats
// are expected). Returns the message to show, or null when it's allowed.
export function soloLimitMessage(clientEmailsThisMonth: (string | null | undefined)[], clientEmail: string): string | null {
  const email = norm(clientEmail);
  const clients = new Set(clientEmailsThisMonth.map(norm).filter(Boolean));
  const forThisClient = clientEmailsThisMonth.filter((e) => norm(e) === email).length;

  if (!clients.has(email) && clients.size >= SOLO_CLIENTS_PER_MONTH) {
    return `Your plan covers ${SOLO_CLIENTS_PER_MONTH} clients a month, and you've invoiced ${clients.size} this month. Upgrade to Unlimited to add another client.`;
  }
  if (forThisClient >= SOLO_INVOICES_PER_CLIENT) {
    return `Your plan covers ${SOLO_INVOICES_PER_CLIENT} invoices per client a month, and this client has ${forThisClient}. Upgrade to Unlimited to keep invoicing them this month.`;
  }
  return null;
}

// How many different clients have been invoiced this month (for "3 of 5").
export function clientsUsed(clientEmailsThisMonth: (string | null | undefined)[]): number {
  return new Set(clientEmailsThisMonth.map(norm).filter(Boolean)).size;
}

// A plan is required to send invoices (Bashira 10/1: no free use, no trial).
// past_due still counts: Stripe is retrying the card and the owner keeps
// working meanwhile. Off in local dev (test accounts have no plan) unless
// REQUIRE_PLAN=on; on in production, where REQUIRE_PLAN=off can override.
const PAYING = new Set(['active', 'trialing', 'past_due']);
export function hasActivePlan(account: { plan: string | null; subscriptionStatus: string | null }): boolean {
  return !!account.plan && PAYING.has(account.subscriptionStatus ?? '');
}
export function planRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.REQUIRE_PLAN === 'on') return true;
  if (env.REQUIRE_PLAN === 'off') return false;
  return env.NODE_ENV === 'production' || !!env.RAILWAY_ENVIRONMENT_NAME;
}
export const NO_PLAN_MESSAGE = 'Choose a plan to start sending invoices: getdunn.org/#pricing';

// A cancelled invoice gives its client slot back only if it was cancelled
// within 24 hours of being created: that covers a typo (wrong amount or
// email), not "let Dunn chase them for weeks, get paid in cash, cancel"
// (Bashira 10/3). Voided or deleted in Stripe counts as cancelled too.
export const FREE_CANCEL_HOURS = 24;
export function countsTowardLimit(inv: { status: string; createdAt: Date; cancelledAt: Date | null }): boolean {
  if (inv.status !== 'void' && inv.status !== 'deleted') return true;
  if (!inv.cancelledAt) return true;
  return inv.cancelledAt.getTime() - inv.createdAt.getTime() > FREE_CANCEL_HOURS * 3_600_000;
}
