import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { Webhook } from 'svix';
import { verifyInbound, isInboxMail } from './inbound';

// A throwaway secret in Resend's format — generated per run, never a real one.
const secret = 'whsec_' + randomBytes(24).toString('base64');

function signed(payload: string) {
  const id = 'msg_test';
  const at = new Date();
  const signature = new Webhook(secret).sign(id, at, payload);
  return {
    'svix-id': id,
    'svix-timestamp': String(Math.floor(at.getTime() / 1000)),
    'svix-signature': signature,
  };
}

// Key order and spacing that JSON.stringify would NOT reproduce — the exact
// case that broke when the route re-serialized a parsed body.
const reply = '{"type": "email.received",  "data": {"to": ["reply-abc123@getdunn.org"], "from": "client@example.com", "email_id": "e_1"}}';

describe('verifyInbound', () => {
  it('accepts a genuine webhook delivered as raw bytes (express.raw)', () => {
    const event = verifyInbound(Buffer.from(reply), signed(reply), secret);
    expect(event.type).toBe('email.received');
    expect(event.data.to[0]).toBe('reply-abc123@getdunn.org');
  });

  it('rejects a tampered body', () => {
    const forged = reply.replace('abc123', 'zzz999');
    expect(() => verifyInbound(Buffer.from(forged), signed(reply), secret)).toThrow();
  });

  it('rejects a webhook signed with a different secret', () => {
    const other = 'whsec_' + randomBytes(24).toString('base64');
    expect(() => verifyInbound(Buffer.from(reply), signed(reply), other)).toThrow();
  });

  it('rejects a webhook with no signature headers', () => {
    expect(() =>
      verifyInbound(Buffer.from(reply), { 'svix-id': undefined, 'svix-timestamp': undefined, 'svix-signature': undefined }, secret)
    ).toThrow();
  });
});

describe('isInboxMail', () => {
  const D = 'getdunn.org';
  it('forwards mail to hello@ and support@', () => {
    expect(isInboxMail(['hello@getdunn.org'], 'someone@gmail.com', D)).toBe(true);
    expect(isInboxMail(['Dunn Support <support@getdunn.org>'], 'x@y.com', D)).toBe(true);
  });
  it('leaves client replies to the invoice flow', () => {
    expect(isInboxMail(['reply-abc123@getdunn.org'], 'client@x.com', D)).toBe(false);
  });
  it('never forwards mail from our own domain (no loops)', () => {
    expect(isInboxMail(['hello@getdunn.org'], 'Dunn <reminders@getdunn.org>', D)).toBe(false);
  });
  it('ignores mail not addressed to our domain, or with no domain configured', () => {
    expect(isInboxMail(['someone@else.com'], 'x@y.com', D)).toBe(false);
    expect(isInboxMail(['hello@getdunn.org'], 'x@y.com', undefined)).toBe(false);
  });
});
