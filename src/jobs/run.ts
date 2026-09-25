// Manual job runner — for dev and cron (Railway cron or a scheduler).
// Usage: npm run job:reminders  |  npm run job:fees  |  npm run job:templates
import 'dotenv/config';
import { runReminderJob } from '../services/reminderEngine';
import { runFeeJob } from '../services/feeEngine';
import { runTemplateJob } from '../services/templateEngine';

const job = process.argv[2];
async function main() {
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
  process.exit(0);
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
