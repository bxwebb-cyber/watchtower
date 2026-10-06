import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { dueDateFromTerms, lateFee, lateness, reminderEmail, isDate } from './tools';
import { buildServer } from './server';

describe('dueDateFromTerms', () => {
  it('net 30', () => expect(dueDateFromTerms('2026-10-05', 'Net 30')).toMatchObject({ dueDate: '2026-11-04', days: 30 }));
  it('due on receipt', () => expect(dueDateFromTerms('2026-10-05', 'due on receipt')).toMatchObject({ dueDate: '2026-10-05' }));
  it('EOM', () => expect(dueDateFromTerms('2026-02-10', 'EOM')).toMatchObject({ dueDate: '2026-02-28' }));
  it('net 30 EOM', () => expect(dueDateFromTerms('2026-10-05', 'net 30 eom')).toMatchObject({ dueDate: '2026-11-30' }));
  it('2/10 net 30 has a discount date', () => {
    const r = dueDateFromTerms('2026-10-05', '2/10 net 30');
    expect(r).toMatchObject({ dueDate: '2026-11-04', discount: { percent: 2, byDate: '2026-10-15' } });
  });
  it('rejects nonsense', () => expect(dueDateFromTerms('2026-10-05', 'whenever')).toHaveProperty('error'));
  it('rejects bad dates', () => { expect(isDate('2026-02-30')).toBe(false); expect(dueDateFromTerms('10/5/2026', 'net 30')).toHaveProperty('error'); });
});

describe('lateFee', () => {
  it('flat, no grace: applies the day after the due date', () => {
    const r = lateFee({ amount: 1000, dueDate: '2026-10-03', feeKind: 'flat', feeValue: 25, graceDays: 0 });
    expect(r).toMatchObject({ feeCents: 2500, totalCents: 102500, lastFeeFreeDay: '2026-10-03', appliesOn: '2026-10-04' });
  });
  it('percent with 7 grace days, matching Dunn', () => {
    const r = lateFee({ amount: 25000, dueDate: '2026-10-03', feeKind: 'percent', feeValue: 5, graceDays: 7 });
    expect(r).toMatchObject({ feeCents: 125000, appliesOn: '2026-10-11' });
  });
  it('flags a high fee', () => {
    const r = lateFee({ amount: 100, dueDate: '2026-10-03', feeKind: 'flat', feeValue: 50, graceDays: 0 });
    expect('fairness' in r && r.fairness).toMatch(/high/);
  });
});

describe('lateness', () => {
  it('due today is not late', () => expect(lateness('2026-10-05', '2026-10-05')).toMatchObject({ stage: 'due_today', daysLate: 0 }));
  it('4 days before is due soon', () => expect(lateness('2026-10-10', '2026-10-06')).toMatchObject({ stage: 'due_soon' }));
  it('5 days late', () => expect(lateness('2026-10-01', '2026-10-06')).toMatchObject({ stage: 'late', daysLate: 5 }));
  it('45 days late is final', () => expect(lateness('2026-08-22', '2026-10-06')).toMatchObject({ stage: 'final' }));
});

describe('reminderEmail', () => {
  it('writes a check-in for a late invoice', () => {
    const r = reminderEmail({ clientName: 'Sam', senderName: 'Marta', amount: 500, dueDate: '2026-10-01', today: '2026-10-06', invoiceNumber: 'RS-0007' });
    expect(r).toMatchObject({ stage: 'late', subject: 'Checking in on invoice RS-0007' });
    expect('body' in r && r.body).toMatch(/^Hi Sam,[\s\S]*\$500\.00[\s\S]*Marta$/);
  });
});

describe('MCP server', () => {
  it('lists 4 read-only tools with titles and answers a call', async () => {
    const [a, b] = InMemoryTransport.createLinkedPair();
    const server = buildServer();
    const client = new Client({ name: 'test', version: '1' });
    await Promise.all([server.connect(a), client.connect(b)]);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['how_late_is_this_invoice', 'invoice_due_date', 'late_fee_calculator', 'payment_reminder_email']);
    for (const t of tools) expect(t.annotations).toMatchObject({ readOnlyHint: true, title: expect.any(String) });
    const r = await client.callTool({ name: 'invoice_due_date', arguments: { invoice_date: '2026-10-05', terms: 'net 30' } });
    expect((r.content as { text: string }[])[0].text).toMatch(/November 4, 2026/);
    await client.close();
  });
});
