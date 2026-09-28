// Runs the daily sweep (reminders → fees → templates) inside the web server,
// once a day at RUN_HOUR_ET New York time. No separate cron service needed.
//
// Every job is safe to repeat (reminders are recorded per step, fees are
// marked applied / asked once, templates advance their next run date), so a
// restart or deploy after the run hour simply runs the sweep again and finds
// nothing new to do. At 9am ET the server's UTC date matches the New York
// date, so the jobs' "today" math lands on the right calendar day.
import type { LockOutcome } from './sweep';

export const RUN_HOUR_ET = 9;
const TICK_MS = 15 * 60_000;
const FIRST_TICK_MS = 30_000;
const MAX_ATTEMPTS_PER_DAY = 3;

const ET = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
});

export function easternClock(now: Date): { day: string; hour: number } {
  const p = Object.fromEntries(ET.formatToParts(now).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

export function isSweepDue(now: Date, lastRunDay: string | null): boolean {
  const { day, hour } = easternClock(now);
  return hour >= RUN_HOUR_ET && day !== lastRunDay;
}

// On in production (Railway), off in local dev so a dev server never emails
// real clients. SCHEDULER=on|off overrides either way.
export function schedulerEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env.SCHEDULER) return env.SCHEDULER === 'on';
  return env.NODE_ENV === 'production' || Boolean(env.RAILWAY_ENVIRONMENT_NAME);
}

export function startScheduler(sweep: () => Promise<LockOutcome<boolean>>): void {
  let lastRunDay: string | null = null;
  let failedDay = '';
  let failures = 0;
  let running = false;

  const tick = async () => {
    const now = new Date();
    if (running || !isSweepDue(now, lastRunDay)) return;
    const { day } = easternClock(now);
    running = true;
    try {
      const outcome = await sweep();
      if (!outcome.ran) {
        console.log('[scheduler] another run holds the job lock — will check again');
        return;
      }
      if (outcome.result) {
        lastRunDay = day;
        console.log(`[scheduler] daily sweep done for ${day}`);
        return;
      }
      throw new Error('one or more jobs failed (see above)');
    } catch (err) {
      failures = failedDay === day ? failures + 1 : 1;
      failedDay = day;
      if (failures >= MAX_ATTEMPTS_PER_DAY) {
        lastRunDay = day;
        console.error(`[scheduler] sweep failed ${failures}x on ${day} — giving up until tomorrow`, err);
      } else {
        console.error(`[scheduler] sweep failed on ${day} — retrying next tick`, err);
      }
    } finally {
      running = false;
    }
  };

  setTimeout(tick, FIRST_TICK_MS);
  setInterval(tick, TICK_MS);
  console.log(`[scheduler] on — daily sweep at ${RUN_HOUR_ET}:00 America/New_York`);
}
