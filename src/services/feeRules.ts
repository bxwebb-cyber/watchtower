// Late-fee amounts. The fee in the invoice terms is a ceiling: the owner can
// lower it or waive it, never raise it — the client was told that amount in
// writing, and "never a surprise" is the promise.

export function agreedFeeCents(invoiceAmountCents: number, policy: { kind: string; amount: number }): number {
  if (policy.kind === 'percent') return Math.round(invoiceAmountCents * (policy.amount / 100));
  if (policy.kind === 'flat') return Math.round(policy.amount * 100);
  return 0;
}

// The grace period is the OWNER's choice — Dunn never picks it for them.
// 0 = the fee applies the day after the due date. Returns null when missing
// or not a whole number from 0 to 90.
export function parseGraceDays(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 90) return null;
  return n;
}

export const GRACE_REQUIRED =
  'Choose when the late fee applies: the day after the due date (0), or after a number of days.';

// How every email, the invoice form and the Stripe invoice word the terms:
// "A $25 late fee applies <feeWhen>".
export function feeWhen(graceDays: number): string {
  if (graceDays <= 0) return "if it's not paid by the due date";
  return `if unpaid ${graceDays} day${graceDays === 1 ? '' : 's'} after the due date`;
}

// Returns a plain-English reason the change isn't allowed, or null if it is.
export function checkFeeChange(requestedCents: number, agreedCents: number): string | null {
  if (!Number.isFinite(requestedCents)) return 'Enter the late fee amount.';
  if (requestedCents <= 0) return 'To charge no late fee, waive it instead.';
  if (requestedCents > agreedCents) {
    return `The late fee can't be more than $${(agreedCents / 100).toFixed(2)}, the amount in the invoice terms.`;
  }
  return null;
}
