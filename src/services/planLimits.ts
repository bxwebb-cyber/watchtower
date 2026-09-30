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
