// SCHEDULER_START=YYYY-MM-DD: the automatic jobs (reminders, late fees,
// recurring invoices) only touch invoices and templates created on or after
// this date. Lets production turn the scheduler on without emailing anything
// left over from testing. Unset = everything is eligible.
export function jobsStartDate(env: NodeJS.ProcessEnv = process.env): Date | null {
  const raw = (env.SCHEDULER_START ?? '').trim();
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error(`SCHEDULER_START must look like 2026-10-01, got "${raw}"`);
  return new Date(raw + 'T00:00:00Z');
}

// Prisma `where` fragment: {} when unset, else createdAt >= start.
export function createdSinceStart(env: NodeJS.ProcessEnv = process.env): { createdAt?: { gte: Date } } {
  const start = jobsStartDate(env);
  return start ? { createdAt: { gte: start } } : {};
}
