// Stripe wants a moment, not a date. Midnight UTC on the due date is already
// in the past on the evening before in the US (8pm New York), so an invoice
// "due tomorrow" made after 8pm was refused. Use the END of the due date in
// New York (03:59:59 UTC the next morning in summer, 22:59:59 the day itself in
// winter), which is still the same calendar date everywhere in the US.
export function dueTimestamp(dueDate: Date): number {
  const day = Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate());
  return Math.floor(day / 1000) + 28 * 3600 - 1;
}

// The reverse: a due date as Stripe reports it → the calendar date (stored as
// midnight UTC). Dunn's own invoices are due at the END of the day in New York
// (dueTimestamp), which is already the next day in UTC; invoices made before
// that, or in Stripe's dashboard at midnight UTC, are read as that UTC date.
export function dueDateFromStripe(sec: number): Date {
  const moment = new Date(sec * 1000);
  if (moment.getUTCHours() === 0 && moment.getUTCMinutes() === 0 && moment.getUTCSeconds() === 0) return moment;
  const [y, m, d] = moment.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
