// Line items: several services on one invoice ("Logo design $500" +
// "Consulting, 3 × $90"). The invoice amount is always the sum of its lines.

export type InvoiceLine = { description: string; quantity: number; unitCents: number };

export const MAX_LINES = 50;

export function lineCents(l: InvoiceLine): number {
  return Math.round(l.quantity * l.unitCents);
}

export function linesTotalCents(lines: InvoiceLine[]): number {
  return lines.reduce((s, l) => s + lineCents(l), 0);
}

// Checks what the form sent. Quantity can be fractional (1.5 hours); price is
// dollars as typed. Returns cleaned lines or a plain-English error.
// A single line may have no description (a plain invoice, no breakdown): it
// gets `fallback` ("Invoice for Harbor & Vine"). With 2+ lines each needs one.
export function parseLines(raw: unknown, fallback = 'Invoice'): { lines: InvoiceLine[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { error: 'Add at least one line to the invoice.' };
  if (raw.length > MAX_LINES) return { error: `An invoice can have up to ${MAX_LINES} lines.` };
  const lines: InvoiceLine[] = [];
  for (const [i, r] of raw.entries()) {
    const n = i + 1;
    const description = String((r as any)?.description ?? '').trim().replace(/\s+/g, ' ') || (raw.length === 1 ? fallback : '');
    const quantity = Number((r as any)?.quantity ?? 1);
    const price = Number((r as any)?.price);
    if (!description) return { error: `Line ${n}: describe the service.` };
    if (description.length > 200) return { error: `Line ${n}: keep the description under 200 characters.` };
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 100_000) return { error: `Line ${n}: the quantity must be more than 0.` };
    if (Math.round(quantity * 100) !== quantity * 100) return { error: `Line ${n}: use at most 2 decimals for the quantity.` };
    if (!Number.isFinite(price) || price <= 0) return { error: `Line ${n}: the price must be more than $0.` };
    const unitCents = Math.round(price * 100);
    lines.push({ description, quantity, unitCents });
  }
  if (linesTotalCents(lines) > 99_999_999) return { error: 'The invoice total is too large.' };
  return { lines };
}

// What Stripe gets for one line: its total, with the math in the description
// when the quantity isn't 1 ("Consulting (3 × $90.00)"). One amount per line
// keeps Stripe's total exactly equal to Dunn's, fractional hours included.
export function stripeItemFor(l: InvoiceLine, fmt: (cents: number) => string): { description: string; amount: number } {
  const description = l.quantity === 1 ? l.description : `${l.description} (${l.quantity} × ${fmt(l.unitCents)})`;
  return { description, amount: lineCents(l) };
}

// When a fee change reissues the bill: the original lines again, if they
// still add up to what's owed (nothing partly paid); otherwise one line for
// the balance, as before line items.
export function reissueItems(stored: unknown, baseCents: number, number: string, fmt: (cents: number) => string): { description: string; amount: number }[] {
  const lines = Array.isArray(stored) ? (stored as InvoiceLine[]) : [];
  const valid = lines.length > 0 && lines.every((l) => l && typeof l.description === 'string' && l.quantity > 0 && l.unitCents > 0);
  if (valid && linesTotalCents(lines) === baseCents) return lines.map((l) => stripeItemFor(l, fmt));
  return [{ description: `Invoice ${number}`, amount: baseCents }];
}
