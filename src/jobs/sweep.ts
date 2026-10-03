import { PrismaClient } from '@prisma/client';
import { runReminderJob } from '../services/reminderEngine';
import { runFeeJob } from '../services/feeEngine';
import { runTemplateJob } from '../services/templateEngine';
import { reportProblem, takeProblemsForSummary } from '../services/problems';
import { notifyFounder } from '../services/notify';
import { easternClock, RUN_HOUR_ET } from './scheduler';

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
// earlier one failed. Returns true only when all three succeeded. A failed
// step alerts the founder at once; every run ends with the founder's summary.
export async function runSweep(now = new Date()): Promise<boolean> {
  const jobs: [string, string, (now: Date) => Promise<number>][] = [
    ['reminders', 'Reminder emails sent', runReminderJob],
    ['fees', 'Late fees added', runFeeJob],
    ['templates', 'Recurring invoices created', runTemplateJob],
  ];
  const day = easternClock(now).day; // New York date, like the scheduler
  const lines: string[] = [];
  let ok = true;
  for (const [name, label, job] of jobs) {
    try {
      lines.push(`${label}: ${await job(now)}`);
    } catch (err) {
      ok = false;
      lines.push(`${label}: FAILED`);
      console.error(`[job] ${name} failed`, err);
      await reportProblem({
        kind: 'Daily run step failed',
        key: `sweep:${name}:${day}`,
        detail: `The ${name} step of the ${day} daily run crashed. It retries on the next check (up to 3 times today).\n\n${(err as Error).stack ?? (err as Error).message}`,
      });
    }
  }
  // The summary comes from the scheduled 9am run. A catch-up run after a
  // deploy stays quiet unless something went wrong.
  const scheduledHour = easternClock(now).hour === RUN_HOUR_ET;
  const problems = scheduledHour || !ok ? takeProblemsForSummary() : [];
  if (!scheduledHour && ok && !problems.length) return ok;
  await notifyFounder(
    `Daily run ${day}: ${ok ? 'all good' : 'something failed'}${problems.length ? `, ${problems.length} issue${problems.length === 1 ? '' : 's'}` : ''}`,
    `${ok ? 'Every step ran.' : 'At least one step failed (you were emailed about it).'}\n\n${lines.join('\n')}\n\n` +
      (problems.length
        ? `Issues since the last summary (each was emailed when it happened):\n${problems.map((p) => `- ${p.kind} — ${p.who}: ${p.detail.split('\n')[0]}`).join('\n')}`
        : 'No issues since the last summary.')
  );
  return ok;
}
