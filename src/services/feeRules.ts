// Late-fee amounts. The fee in the invoice terms is a ceiling: the owner can
// lower it or waive it, never raise it — the client was told that amount in
// writing, and "never a surprise" is the promise.

export function agreedFeeCents(invoiceAmountCents: number, policy: { kind: string; amount: number }): number {
  if (policy.kind === 'percent') return Math.round(invoiceAmountCents * (policy.amount / 100));
  if (policy.kind === 'flat') return Math.round(policy.amount * 100);
  return 0;
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
