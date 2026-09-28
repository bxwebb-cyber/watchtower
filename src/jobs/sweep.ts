import { PrismaClient } from '@prisma/client';
import { runReminderJob } from '../services/reminderEngine';
import { runFeeJob } from '../services/feeEngine';
import { runTemplateJob } from '../services/templateEngine';

const prisma = new PrismaClient();

// Several processes can try to run jobs at once: the web server's scheduler,
// a manual `npm run job:*`, or the old and new instance overlapping during a
// deploy. A Postgres advisory lock lets exactly one through, so a reminder or
// late fee can never go out twice. The lock is transaction-scoped: it releases
// by itself when the run ends, even if the process dies mid-run.
const MAX_RUN_MS = 30 * 60_000;

export type LockOutcome<T> = { ran: true; result: T } | { ran: false };

export async function withJobLock<T>(fn: () => Promise<T>): Promise<LockOutcome<T>> {
  return prisma.$transaction(
    async (tx) => {
      const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(7426011) AS locked`;
      if (!locked) return { ran: false as const };
      return { ran: true as const, result: await fn() };
    },
    { maxWait: 10_000, timeout: MAX_RUN_MS }
  );
}

// The daily sweep: reminders → fees → templates. Each job still runs if an
// earlier one failed. Returns true only when all three succeeded.
export async function runSweep(now = new Date()): Promise<boolean> {
  const jobs: [string, (now: Date) => Promise<number>][] = [
    ['reminders', runReminderJob],
    ['fees', runFeeJob],
    ['templates', runTemplateJob],
  ];
  let ok = true;
  for (const [name, job] of jobs) {
    try {
      await job(now);
    } catch (err) {
      ok = false;
      console.error(`[job] ${name} failed`, err);
    }
  }
  return ok;
}
