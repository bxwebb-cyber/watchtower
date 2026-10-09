// Stripe wants a moment, not a date. Midnight UTC on the due date is already
// in the past on the evening before in the US (8pm New York), so an invoice
// "due tomorrow" made after 8pm was refused. Use the END of the due date in
// New York (03:59:59 UTC the next morning in summer, 22:59:59 the day itself in
// winter), which is still the same calendar date everywhere in the US.
export function dueTimestamp(dueDate: Date): number {
  const day = Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate());
  return Math.floor(day / 1000) + 28 * 3600 - 1;
}

// The moment Dunn gives Stripe as the due date. Stripe prints its PDF dates
// in UTC, so the end of the NY day (03:59 UTC the next day) showed "due
// Oct 10" for an invoice due Oct 9. 23:59:59 UTC is the same calendar date
// in UTC and every US time zone (7:59pm New York, 4:59pm Los Angeles), so
// use it — unless it has already passed (an invoice due today, made after
// 8pm New York time), then the end of the NY day, which Stripe accepts.
export function stripeDueTimestamp(dueDate: Date, nowMs = Date.now()): number {
  const day = Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate()) / 1000;
  const endUtc = day + 86_399;
  return endUtc * 1000 > nowMs + 60_000 ? endUtc : dueTimestamp(dueDate);
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

// Whole days late as of a moment (a payment, or now): the New York calendar
// day of the moment minus the due date. 0 = on or before the due date — a
// payment at 3pm on the due day is on time, though it's after midnight UTC.
export function daysLateAt(moment: Date, dueDate: Date): number {
  const [y, m, d] = moment.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).split('-').map(Number);
  const day = Date.UTC(y, m - 1, d);
  const due = Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate());
  return Math.max(0, Math.round((day - due) / 86_400_000));
}
