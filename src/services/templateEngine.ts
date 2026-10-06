import { PrismaClient } from '@prisma/client';
import { createInvoice, stripeConfigured } from './invoiceCreator';
import { notifyOwner } from './notify';
import { usd } from '../lib/money';
import { createdSinceStart, stripeConnected } from '../jobs/startDate';
import { reportProblem } from './problems';
import { nyDayStart, addDays } from './reminderEngine';

const prisma = new PrismaClient();

// Run daily: find every active template whose nextRunDate is today or past,
// create the invoice, advance the schedule, log it.
export async function runTemplateJob(now = new Date()): Promise<number> {
  if (!stripeConfigured()) {
    console.warn('[job] Stripe not configured — templates skipped');
    return 0;
  }

  // The New York date, as midnight UTC like stored dates. Not the server's
  // own date: a catch-up run after an evening deploy (8pm+ ET) is already
  // "tomorrow" in UTC, and sent the next morning's invoices a night early.
  const today = nyDayStart(now);

  const templates = await prisma.invoiceTemplate.findMany({
    where: { active: true, nextRunDate: { lte: today }, ...createdSinceStart(), ...stripeConnected },
    include: { account: true },
  });

  let created = 0;
  // Updates use updateMany: an owner can delete a template while the run is
  // working on it, and that must not crash the run.
  for (const tmpl of templates) {
    try {
      // Due date: N days from the run date.
      const dueDate = addDays(today, tmpl.dueDays);

      const result = await createInvoice({
        accountId: tmpl.accountId,
        clientName: tmpl.clientName,
        clientEmail: tmpl.clientEmail,
        amountCents: tmpl.amount,
        currency: tmpl.currency,
        dueDate,
        fee:
          tmpl.feeKind !== 'none'
            ? { kind: tmpl.feeKind as 'flat' | 'percent', amount: tmpl.feeAmount, graceDays: tmpl.graceDays }
            : undefined,
        recurring: { frequencyLabel: FREQUENCY_LABELS[tmpl.frequency] ?? 'recurring' },
      });

      if (!result.ok) {
        console.error(`[template] failed for ${tmpl.id}: ${result.message}`);
        // The client isn't invoiced until this is fixed, so tell the owner
        // (once per new reason, not on every daily retry) and the founder.
        await reportProblem({
          kind: 'Recurring invoice not created',
          key: `template:${tmpl.id}:${result.code}`,
          accountId: tmpl.accountId,
          detail: `${tmpl.clientName} <${tmpl.clientEmail}>: ${result.code} — ${result.message}`,
        });
        if (tmpl.lastError !== result.message) {
          await notifyOwner(
            tmpl.accountId,
            `Recurring invoice for ${tmpl.clientName} not sent`,
            `Dunn didn't send ${tmpl.clientName}'s recurring invoice. ${result.message}\n\n` +
              (result.code === 'plan_limit'
                ? 'Upgrade in Settings and Dunn sends it on the next daily run. Otherwise it goes out when your plan resets on the 1st.'
                : result.code === 'no_plan'
                  ? 'Pick a plan in Settings and Dunn sends it on the next daily run.'
                  : 'Check that your Stripe account is still connected (Dunn → Settings). Dunn tries again every day until it goes through.')
          );
        }
        await prisma.invoiceTemplate.updateMany({
          where: { id: tmpl.id },
          data: { lastRunAt: now, lastRunOk: false, lastError: result.message },
        });
        await prisma.auditEvent.create({
          data: {
            invoiceId: '__template__',
            event: 'template_error',
            detail: `Template ${tmpl.clientName}: ${result.message}`,
          },
        });
        continue;
      }

      await prisma.invoice.updateMany({ where: { id: result.invoice.id }, data: { templateId: tmpl.id } });

      // Advance the schedule.
      const nextRun = advanceRunDate(tmpl.nextRunDate, tmpl.frequency, tmpl.customDay ?? undefined);

      await prisma.invoiceTemplate.updateMany({
        where: { id: tmpl.id },
        data: {
          nextRunDate: nextRun,
          lastRunAt: now,
          lastRunOk: true,
          lastError: null,
          sentCount: { increment: 1 },
          lastInvoiceId: result.invoice.id,
        },
      });

      await prisma.auditEvent.create({
        data: {
          invoiceId: result.invoice.id,
          event: 'template_invoice_created',
          detail: `From template ${tmpl.id}: ${result.invoice.amount} due ${result.invoice.dueDate}`,
        },
      });

      // Notify owner that a recurring invoice was sent.
      await notifyOwner(
        tmpl.accountId,
        `Recurring invoice sent to ${tmpl.clientName}`,
        `A recurring invoice for ${usd(tmpl.amount)} was created from your "${tmpl.clientName}" template and sent to ${tmpl.clientEmail}.`
      );

      created++;
    } catch (err) {
      console.error(`[template] error processing ${tmpl.id}`, err);
      await prisma.invoiceTemplate.updateMany({
        where: { id: tmpl.id },
        data: { lastRunAt: now, lastRunOk: false, lastError: (err as Error).message },
      });
      await reportProblem({
        kind: 'Recurring invoice crashed',
        key: `template:${tmpl.id}:crash`,
        accountId: tmpl.accountId,
        detail: `${tmpl.clientName} <${tmpl.clientEmail}>: ${(err as Error).stack ?? (err as Error).message}`,
      });
      await notifyOwner(
        tmpl.accountId,
        `Recurring invoice failed: ${tmpl.clientName}`,
        `Could not create the recurring invoice for ${tmpl.clientName} (${tmpl.clientEmail}). Reason: ${(err as Error).message}. The template is still active and will retry next cycle.`
      );
    }
  }

  console.log(`[job] template run: ${created} invoices created from templates`);
  return created;
}

// "Your monthly invoice." — custom runs monthly on a set day.
const FREQUENCY_LABELS: Record<string, string> = {
  monthly: 'monthly',
  weekly: 'weekly',
  biweekly: 'biweekly',
  custom: 'monthly',
};

// Advance the nextRunDate based on frequency.
export function advanceRunDate(current: Date, frequency: string, customDay?: number): Date {
  const next = new Date(current);

  switch (frequency) {
    case 'monthly': {
      // Use UTC to avoid local-timezone day drift.
      const y = next.getUTCFullYear();
      const m = next.getUTCMonth() + 1; // 1-indexed for arithmetic
      const d = next.getUTCDate();
      // Move to next month, then clamp day to the month length.
      const targetMonth = m + 1; // 1-indexed, may be 13
      const yearOffset = Math.floor((targetMonth - 1) / 12);
      const mm = ((targetMonth - 1) % 12); // 0-indexed
      const daysInTarget = new Date(Date.UTC(y + yearOffset, mm + 1, 0)).getUTCDate();
      const clampedDay = Math.min(d, daysInTarget);
      next.setUTCFullYear(y + yearOffset, mm, clampedDay);
      next.setUTCHours(0, 0, 0, 0);
      break;
    }
    case 'weekly': {
      next.setUTCDate(next.getUTCDate() + 7);
      break;
    }
    case 'biweekly': {
      next.setUTCDate(next.getUTCDate() + 14);
      break;
    }
    case 'custom': {
      // Move to next month on the specified customDay.
      const y = next.getUTCFullYear();
      const m = next.getUTCMonth(); // 0-indexed
      const targetMonth = m + 1; // next month (0-indexed, may be 12)
      const yearOffset = Math.floor(targetMonth / 12);
      const mm = targetMonth % 12; // 0-indexed
      const daysInTarget = new Date(Date.UTC(y + yearOffset, mm + 1, 0)).getUTCDate();
      const clampedDay = Math.min(customDay ?? next.getUTCDate(), daysInTarget);
      next.setUTCFullYear(y + yearOffset, mm, clampedDay);
      next.setUTCHours(0, 0, 0, 0);
      break;
    }
  }

  return next;
}

// Given a start date and frequency, compute the initial nextRunDate.
// The run fires ON the start date (lte: today), so the first invoice
// creates on that day. Then advances.
export function computeInitialNextRun(
  startDate: Date,
  frequency: string,
  customDay?: number
): Date {
  if (frequency === 'custom' && customDay) {
    const start = new Date(startDate);
    const y = start.getUTCFullYear();
    const m = start.getUTCMonth(); // 0-indexed
    const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const candidateDay = Math.min(customDay, daysInMonth);
    const candidate = new Date(Date.UTC(y, m, candidateDay));

    // If candidate is before the start date, advance to next month.
    if (candidate < startDate) {
      const targetMonth = m + 1;
      const yearOffset = Math.floor(targetMonth / 12);
      const mm = targetMonth % 12;
      const nextDaysInMonth = new Date(Date.UTC(y + yearOffset, mm + 1, 0)).getUTCDate();
      const clamped = Math.min(customDay, nextDaysInMonth);
      return new Date(Date.UTC(y + yearOffset, mm, clamped));
    }
    return candidate;
  }

  // For monthly/weekly/biweekly, the start date IS the first run date.
  return new Date(startDate);
}

// When a paused template is resumed after its nextRunDate has passed,
// advance it to the next cycle instead of firing immediately.
export function skipToNextCycle(
  currentNextRun: Date,
  frequency: string,
  customDay?: number,
  now: Date = new Date()
): Date {
  let next = new Date(currentNextRun);
  // Keep advancing until nextRunDate is in the future.
  while (next <= now) {
    next = advanceRunDate(next, frequency, customDay);
  }
  return next;
}