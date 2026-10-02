// Every failure that needs a human. Bashira 10/1: "I need to know about all
// the issues, it's up to me to fix." For each problem:
//   - the owner (if it's about their account) gets one plain email saying
//     what happened and what to do,
//   - the founder always gets an email, with the business and account,
//   - it's kept for the founder's daily summary.
// The same problem (same key) is reported at most once a day.
import { PrismaClient } from '@prisma/client';
import { notifyOwner, notifyFounder } from './notify';

const prisma = new PrismaClient();
const DAY = 24 * 60 * 60 * 1000;
const lastReported = new Map<string, number>();
const sinceSummary: { at: Date; kind: string; who: string; detail: string }[] = [];

export type Problem = {
  kind: string; // short label, e.g. "Email bounced"
  key: string; // what makes it "the same problem" for the once-a-day rule
  detail: string; // technical detail for the founder
  accountId?: string;
  owner?: { subject: string; text: string }; // omit for founder-only problems
};

export function shouldReport(key: string, now = Date.now(), seen = lastReported): boolean {
  const last = seen.get(key);
  if (last !== undefined && now - last < DAY) return false;
  seen.set(key, now);
  return true;
}

export async function reportProblem(p: Problem): Promise<void> {
  try {
    if (!shouldReport(p.key)) return;
    const account = p.accountId ? await prisma.account.findUnique({ where: { id: p.accountId } }) : null;
    const who = account ? `${account.businessName ?? '(no business name)'} <${account.email}>` : 'Dunn itself';
    sinceSummary.push({ at: new Date(), kind: p.kind, who, detail: p.detail });
    console.error(`[problem] ${p.kind} — ${who} — ${p.detail}`);
    if (p.owner && p.accountId) await notifyOwner(p.accountId, p.owner.subject, p.owner.text);
    await notifyFounder(
      `Issue: ${p.kind} — ${account?.businessName ?? 'Dunn'}`,
      `${p.kind}\nAccount: ${who}${p.accountId ? ` (id ${p.accountId})` : ''}\n\n${p.detail}\n\n${p.owner ? `The owner was emailed: "${p.owner.subject}"` : 'Founder-only: the owner was not emailed.'}`
    );
  } catch (err) {
    console.error('[problem] could not report', p.kind, err);
  }
}

// Problems reported since the last daily summary; clears the list.
export function takeProblemsForSummary() {
  return sinceSummary.splice(0, sinceSummary.length);
}
