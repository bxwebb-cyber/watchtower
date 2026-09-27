import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import type { Request } from 'express';

const prisma = new PrismaClient();

// Resolve the signed-in account id from the auth cookie / bearer token, or
// null when the request isn't authenticated. This is the per-account source of
// truth that replaces the old single-account `findFirst()` assumption.
export function resolveAccountId(req: Request): string | null {
  const authHeader = req.headers.authorization || '';
  const token =
    req.cookies?.auth_token || (authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '');
  if (!token) return null;
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  try {
    const payload = jwt.verify(token, secret) as { accountId: string };
    return payload.accountId;
  } catch {
    return null;
  }
}

// Load the signed-in account, or null when unauthenticated/not found.
export async function getAccount(req: Request) {
  const accountId = resolveAccountId(req);
  if (!accountId) return null;
  return prisma.account.findUnique({ where: { id: accountId } });
}