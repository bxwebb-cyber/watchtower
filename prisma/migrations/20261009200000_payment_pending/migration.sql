-- A bank (ACH) payment has started and is clearing (3-5 business days).
-- While set, Dunn sends no reminders and adds no fees.
ALTER TABLE "Invoice" ADD COLUMN "paymentPendingAt" TIMESTAMP(3);
