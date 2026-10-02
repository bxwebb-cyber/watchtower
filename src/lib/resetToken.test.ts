import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import { makeResetToken, checkResetToken } from './resetToken';

const SECRET = 'test-secret-only';

describe('reset tokens', () => {
  it('works for the account it was made for', () => {
    const t = makeResetToken('acc1', 'hashA', SECRET);
    expect(checkResetToken(t, SECRET, () => 'hashA')).toBe('acc1');
  });
  it('stops working once the password has changed (single use)', () => {
    const t = makeResetToken('acc1', 'hashA', SECRET);
    expect(checkResetToken(t, SECRET, () => 'hashB')).toBeNull();
  });
  it('rejects expired, forged, or other-purpose tokens', () => {
    const expired = jwt.sign({ accountId: 'acc1', fp: 'x', purpose: 'password_reset' }, SECRET, { expiresIn: -10 });
    expect(checkResetToken(expired, SECRET, () => 'hashA')).toBeNull();
    expect(checkResetToken(makeResetToken('acc1', 'hashA', 'other-secret'), SECRET, () => 'hashA')).toBeNull();
    const session = jwt.sign({ accountId: 'acc1' }, SECRET);
    expect(checkResetToken(session, SECRET, () => 'hashA')).toBeNull();
  });
  it('rejects an unknown account', () => {
    expect(checkResetToken(makeResetToken('gone', 'h', SECRET), SECRET, () => undefined)).toBeNull();
  });
});
