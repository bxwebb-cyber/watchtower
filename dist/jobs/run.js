"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Manual job runner — for dev and cron (Railway cron or a scheduler).
// Usage: npm run job:reminders  |  npm run job:fees
require("dotenv/config");
const reminderEngine_1 = require("../services/reminderEngine");
const feeEngine_1 = require("../services/feeEngine");
const job = process.argv[2];
async function main() {
    if (job === 'reminders') {
        await (0, reminderEngine_1.runReminderJob)();
    }
    else if (job === 'fees') {
        await (0, feeEngine_1.runFeeJob)();
    }
    else {
        // both, in order (reminders first, then fees so the t+7 notice
        // and the fee land in the same day's work)
        await (0, reminderEngine_1.runReminderJob)();
        await (0, feeEngine_1.runFeeJob)();
    }
    process.exit(0);
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=run.js.map