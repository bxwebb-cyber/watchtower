import { describe, it, expect } from 'vitest';
import { dueTimestamp } from './invoiceCreator';

const nyDate = (sec: number) =>
  new Date(sec * 1000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const laDate = (sec: number) =>
  new Date(sec * 1000).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

describe('dueTimestamp', () => {
  it('is still in the future on the evening before, in New York (the Oct 2, 11:45pm bug)', () => {
    const now = Date.UTC(2026, 9, 3, 3, 45) / 1000; // Oct 2, 11:45pm EDT
    expect(dueTimestamp(new Date('2026-10-03T00:00:00Z'))).toBeGreaterThan(now);
  });
  it('lands on the same calendar date in New York and Los Angeles, summer and winter', () => {
    for (const d of ['2026-10-03', '2026-12-15', '2027-03-01', '2027-07-04']) {
      const sec = dueTimestamp(new Date(`${d}T00:00:00Z`));
      expect(nyDate(sec)).toBe(d);
      expect(laDate(sec)).toBe(d);
    }
  });
  it('ignores the time of day (recurring runs pass "now + N days")', () => {
    expect(dueTimestamp(new Date('2026-10-10T13:00:00Z'))).toBe(dueTimestamp(new Date('2026-10-10T00:00:00Z')));
  });
});

import { dueDateFromStripe, daysLateAt } from '../lib/dueDate';

describe('dueDateFromStripe (Stripe → the date the owner picked)', () => {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  it('round-trips Dunn\'s own due dates (end of the day in New York)', () => {
    for (const d of ['2026-10-03', '2026-12-15', '2027-03-14', '2027-11-07']) {
      expect(day(dueDateFromStripe(dueTimestamp(new Date(`${d}T00:00:00Z`))))).toBe(d);
    }
  });
  it('the 10/3 bug: Oct 3 came back as Oct 4', () => {
    expect(day(dueDateFromStripe(dueTimestamp(new Date('2026-10-03T00:00:00Z'))))).toBe('2026-10-03');
  });
  it('older invoices due at midnight UTC keep that date', () => {
    expect(day(dueDateFromStripe(Date.UTC(2026, 9, 3) / 1000))).toBe('2026-10-03');
  });
});

describe('daysLateAt', () => {
  const due = new Date('2026-10-05T00:00:00Z');
  it('paid at 3pm New York on the due date is on time', () => expect(daysLateAt(new Date('2026-10-05T19:00:00Z'), due)).toBe(0));
  it('paid at 11pm New York on the due date is on time (already Oct 6 in UTC)', () => expect(daysLateAt(new Date('2026-10-06T03:00:00Z'), due)).toBe(0));
  it('paid the next day is 1 day late', () => expect(daysLateAt(new Date('2026-10-06T14:00:00Z'), due)).toBe(1));
  it('paid early is 0', () => expect(daysLateAt(new Date('2026-10-01T14:00:00Z'), due)).toBe(0));
});
