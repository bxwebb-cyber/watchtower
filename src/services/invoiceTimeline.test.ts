import { describe, it, expect } from 'vitest';
import { buildTimeline } from './invoiceTimeline';

const at = (s: string) => new Date(`2026-10-${s}T13:00:00Z`);

describe('buildTimeline', () => {
  it('merges emails, replies and events oldest first, in plain words', () => {
    const t = buildTimeline({
      events: [
        { event: 'invoice_created', detail: null, createdAt: at('01') },
        { event: 'reminder_sent', detail: 't-4', createdAt: at('08') },
        { event: 'client_replied', detail: 'x', createdAt: at('09') },
        { event: 'invoice_paid', detail: null, createdAt: at('10') },
      ],
      reminders: [{ subject: 'Invoice 0001 is due in 4 days', sentAt: at('08') }],
      replies: [{ from: 'dana@x.com', subject: 'Re: invoice', body: 'Paying Friday!', createdAt: at('09') }],
    });
    expect(t.map((e) => e.text)).toEqual([
      'Invoice created and sent',
      'Email sent: "Invoice 0001 is due in 4 days"',
      'dana@x.com replied',
      'Paid',
    ]);
    expect(t[2].body).toBe('Paying Friday!');
  });

  it("keeps the owner's note on a waived fee, and names unknown events", () => {
    const t = buildTimeline({
      events: [
        { event: 'fee_waived', detail: 'Long-time client', createdAt: at('05') },
        { event: 'something_new', detail: null, createdAt: at('06') },
      ],
      reminders: [],
      replies: [],
    });
    expect(t[0]).toMatchObject({ kind: 'fee', text: 'Late fee waived', body: 'Long-time client' });
    expect(t[1].text).toBe('something new');
  });
});
