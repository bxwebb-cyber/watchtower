import { describe, it, expect } from 'vitest';
import { decodeEntities } from './emailRenderer';

describe('decodeEntities (email subject lines)', () => {
  it('turns a Handlebars-escaped business name back into plain text', () => {
    expect(decodeEntities('Invoice 0001 from Hudson &amp; Co.: $250.00 due October 5, 2026'))
      .toBe('Invoice 0001 from Hudson & Co.: $250.00 due October 5, 2026');
  });

  it('decodes every entity Handlebars escapes', () => {
    expect(decodeEntities('&lt;&gt;&quot;&#x27;&#x60;&#x3D;')).toBe('<>"\'`=');
  });

  it('decodes &amp; last, so an escaped entity stays literal text', () => {
    expect(decodeEntities('Ben&amp;lt;Jerry')).toBe('Ben&lt;Jerry');
  });
});
