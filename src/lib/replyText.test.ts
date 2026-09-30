import { describe, it, expect } from 'vitest';
import { replyText } from './replyText';

describe('replyText', () => {
  it('keeps only what the client wrote in an iPhone HTML reply', () => {
    const html = '<html class="apple-mail"><head><meta charset="utf-8"><style>.x{}</style></head><body dir="auto">A 150 dollar late fee is preposterous!<br id="lineBreakAtBeginningOfSignature"><div dir="ltr">Sent from my iPhone</div><div dir="ltr"><br><blockquote type="cite">On Sep 29, 2026, at 10:40 PM, Dunn &lt;reminders@getdunn.org&gt; wrote:<br><br></blockquote></div><blockquote type="cite"><div dir="ltr"><!-- Dunn client email --><title>Invoice</title><p>Your invoice…</p></div></blockquote></body></html>';
    expect(replyText(html)).toBe('A 150 dollar late fee is preposterous!');
  });

  it('cuts a plain-text reply at the quote header', () => {
    const text = "Paying Friday, thanks!\n\nOn Tue, Sep 29, 2026 at 10:40 PM Dunn <reminders@getdunn.org> wrote:\n> Your invoice is due";
    expect(replyText(text)).toBe('Paying Friday, thanks!');
  });

  it('cuts Gmail HTML at its quote wrapper and decodes entities', () => {
    const html = '<div dir="ltr">Can we do $750 now &amp; the rest next week?</div><br><div class="gmail_quote"><div>On Tue… wrote:</div><blockquote>old</blockquote></div>';
    expect(replyText(html)).toBe('Can we do $750 now & the rest next week?');
  });

  it('leaves a short plain reply alone', () => {
    expect(replyText('Paid it just now.')).toBe('Paid it just now.');
    expect(replyText(null)).toBe('');
  });
});
