// Password-reset links: a signed token naming the account, good for 1 hour,
// and tied to the CURRENT password hash, so it stops working the moment the
// password changes (single use, no table needed).
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const fingerprint = (passwordHash: string | null) =>
  crypto.createHash('sha256').update(passwordHash ?? '').digest('hex').slice(0, 16);

export function makeResetToken(accountId: string, passwordHash: string | null, secret: string): string {
  return jwt.sign({ accountId, fp: fingerprint(passwordHash), purpose: 'password_reset' }, secret, { expiresIn: '1h' });
}

// Returns the account id if the token is genuine, unexpired, and still
// matches that account's current password hash; otherwise null.
export function checkResetToken(token: string, secret: string, currentHash: (accountId: string) => string | null | undefined): string | null {
  try {
    const p = jwt.verify(token, secret) as { accountId?: string; fp?: string; purpose?: string };
    if (p.purpose !== 'password_reset' || !p.accountId) return null;
    const hash = currentHash(p.accountId);
    if (hash === undefined || p.fp !== fingerprint(hash)) return null;
    return p.accountId;
  } catch {
    return null;
  }
}

export function readResetAccount(token: string, secret: string): string | null {
  try {
    const p = jwt.verify(token, secret) as { accountId?: string; purpose?: string };
    return p.purpose === 'password_reset' && p.accountId ? p.accountId : null;
  } catch {
    return null;
  }
}
