import { describe, it, expect } from 'vitest';
import { soloLimitMessage, monthStart, clientsUsed, hasActivePlan, planRequired } from './planLimits';
import { countsTowardLimit } from './planLimits';

const weekly = (email: string, n: number) => Array.from({ length: n }, () => email);

describe('soloLimitMessage', () => {
  it('allows the first invoice of the month', () => {
    expect(soloLimitMessage([], 'a@x.com')).toBeNull();
  });

  it('allows five weekly clients (5 invoices each)', () => {
    const month = ['a', 'b', 'c', 'd'].flatMap((c) => weekly(`${c}@x.com`, 5)).concat(weekly('e@x.com', 4));
    expect(soloLimitMessage(month, 'e@x.com')).toBeNull();
  });

  it('blocks a sixth client', () => {
    const month = ['a', 'b', 'c', 'd', 'e'].map((c) => `${c}@x.com`);
    expect(soloLimitMessage(month, 'f@x.com')).toMatch(/5 clients a month/);
  });

  it('still lets an existing client be invoiced when 5 clients are in use', () => {
    const month = ['a', 'b', 'c', 'd', 'e'].map((c) => `${c}@x.com`);
    expect(soloLimitMessage(month, 'c@x.com')).toBeNull();
  });

  it('allows the 10th invoice for a client and blocks the 11th', () => {
    expect(soloLimitMessage(weekly('a@x.com', 9), 'a@x.com')).toBeNull();
    expect(soloLimitMessage(weekly('a@x.com', 10), 'a@x.com')).toMatch(/10 invoices per client/);
  });

  it('treats email case and spaces as the same client', () => {
    const month = ['a', 'b', 'c', 'd'].map((c) => `${c}@x.com`).concat(' E@X.com ');
    expect(soloLimitMessage(month, 'e@x.com')).toBeNull();
  });
});

describe('monthStart', () => {
  it('is the 1st of the month, UTC', () => {
    expect(monthStart(new Date('2026-09-29T15:00:00Z')).toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });
});

describe('clientsUsed', () => {
  it('counts different clients, not invoices', () => {
    expect(clientsUsed(['a@x.com', 'A@x.com ', 'b@x.com', null])).toBe(2);
  });
});

describe('hasActivePlan / planRequired', () => {
  it('needs a plan and a paying status', () => {
    expect(hasActivePlan({ plan: null, subscriptionStatus: null })).toBe(false);
    expect(hasActivePlan({ plan: 'solo', subscriptionStatus: 'active' })).toBe(true);
    expect(hasActivePlan({ plan: 'solo', subscriptionStatus: 'past_due' })).toBe(true);
    expect(hasActivePlan({ plan: 'solo', subscriptionStatus: 'canceled' })).toBe(false);
  });
  it('is required in production, not in local dev, and can be overridden', () => {
    expect(planRequired({ NODE_ENV: 'production' })).toBe(true);
    expect(planRequired({ RAILWAY_ENVIRONMENT_NAME: 'production' })).toBe(true);
    expect(planRequired({})).toBe(false);
    expect(planRequired({ REQUIRE_PLAN: 'on' })).toBe(true);
    expect(planRequired({ NODE_ENV: 'production', REQUIRE_PLAN: 'off' })).toBe(false);
  });
});

describe('countsTowardLimit (24-hour rule for cancelled invoices)', () => {
  const created = new Date('2026-10-03T14:00:00Z');
  const hours = (h: number) => new Date(created.getTime() + h * 3_600_000);
  it('open and paid invoices always count', () => {
    expect(countsTowardLimit({ status: 'open', createdAt: created, cancelledAt: null })).toBe(true);
    expect(countsTowardLimit({ status: 'paid', createdAt: created, cancelledAt: null })).toBe(true);
  });
  it('cancelled within 24 hours frees the slot', () => {
    expect(countsTowardLimit({ status: 'void', createdAt: created, cancelledAt: hours(1) })).toBe(false);
    expect(countsTowardLimit({ status: 'void', createdAt: created, cancelledAt: hours(24) })).toBe(false);
  });
  it('cancelled later still counts', () => {
    expect(countsTowardLimit({ status: 'void', createdAt: created, cancelledAt: hours(25) })).toBe(true);
    expect(countsTowardLimit({ status: 'deleted', createdAt: created, cancelledAt: hours(24 * 9) })).toBe(true);
  });
});
