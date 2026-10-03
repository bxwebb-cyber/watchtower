import { replyText } from '../lib/replyText';

// The story of one invoice, oldest first, in plain words for the owner's
// invoice view: what was sent, what the client said, what happened to the fee.
// Reminders and replies come from their own tables (they carry the subject and
// the client's words); the audit log fills in everything else.

export type TimelineEntry = { at: string; kind: 'sent' | 'reply' | 'fee' | 'paid' | 'problem' | 'note'; text: string; body?: string };

const EVENT_TEXT: Record<string, { kind: TimelineEntry['kind']; text: string } | null> = {
  invoice_created: { kind: 'sent', text: 'Invoice created and sent' },
  template_invoice_created: { kind: 'sent', text: 'Recurring invoice created and sent' },
  fee_pending_approval: { kind: 'fee', text: 'Late fee due, waiting for your approval' },
  fee_applied: { kind: 'fee', text: 'Late fee added to the bill' },
  fee_lowered: { kind: 'fee', text: 'Late fee changed' },
  fee_waived: { kind: 'fee', text: 'Late fee waived' },
  fee_paid: { kind: 'paid', text: 'Late fee paid' },
  fee_error: { kind: 'problem', text: "Late fee couldn't be added" },
  invoice_paid: { kind: 'paid', text: 'Paid' },
  payment_failed: { kind: 'problem', text: 'A payment attempt failed' },
  invoice_voided: { kind: 'note', text: 'Invoice voided in Stripe' },
  invoice_cancelled: { kind: 'note', text: 'You cancelled this invoice' },
  invoice_uncollectible: { kind: 'problem', text: 'Marked uncollectible' },
  email_failed: { kind: 'problem', text: "An email to the client couldn't be sent" },
  escalation_notified: { kind: 'note', text: 'Two weeks late: Dunn asked you what to do next' },
  escalation_send_reminder: { kind: 'note', text: 'You chose to send a final notice' },
  escalation_owner_calling: { kind: 'note', text: "You chose to call the client yourself" },
  // Shown from their own tables, or not useful to the owner here.
  reminder_sent: null,
  client_replied: null,
  invoice_updated: null,
  fee_skipped: null,
  missing_business_name: null,
};

export function buildTimeline(input: {
  events: { event: string; detail: string | null; createdAt: Date }[];
  reminders: { subject: string; sentAt: Date }[];
  replies: { from: string; subject: string; body: string; createdAt: Date }[];
}): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  for (const r of input.reminders) out.push({ at: r.sentAt.toISOString(), kind: 'sent', text: `Email sent: "${r.subject}"` });
  for (const r of input.replies) {
    out.push({ at: r.createdAt.toISOString(), kind: 'reply', text: `${r.from} replied`, body: replyText(r.body) || r.subject });
  }
  for (const e of input.events) {
    const known = EVENT_TEXT[e.event];
    if (known === null) continue;
    const text = known?.text ?? e.event.replace(/_/g, ' ');
    const kind = known?.kind ?? 'note';
    // The owner's own note (e.g. why a fee was waived) is worth showing.
    const body = e.event === 'fee_waived' || e.event === 'fee_lowered' ? e.detail ?? undefined : undefined;
    out.push({ at: e.createdAt.toISOString(), kind, text, ...(body ? { body } : {}) });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}
