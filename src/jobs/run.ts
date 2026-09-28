// Manual job runner. In production the web server runs these daily on its own
// (see scheduler.ts); this is for dev and for forcing a run from a Railway shell.
// Usage: npm run job:reminders  |  npm run job:fees  |  npm run job:templates
// Built (no tsx): node dist/jobs/run.js [reminders|fees|templates]
import 'dotenv/config';
import { runReminderJob } from '../services/reminderEngine';
import { runFeeJob } from '../services/feeEngine';
import { runTemplateJob } from '../services/templateEngine';
import { withJobLock } from './sweep';

const job = process.argv[2];
async function main() {
  // Same lock as the scheduler, so a manual run never overlaps a scheduled one.
  const outcome = await withJobLock(async () => {
    if (job === 'reminders') {
      await runReminderJob();
    } else if (job === 'fees') {
      await runFeeJob();
    } else if (job === 'templates') {
      await runTemplateJob();
    } else {
      // all three: reminders → fees → templates
      await runReminderJob();
      await runFeeJob();
      await runTemplateJob();
    }
  });
  if (!outcome.ran) console.log('[job] another run is in progress — skipped');
  process.exit(0);
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
