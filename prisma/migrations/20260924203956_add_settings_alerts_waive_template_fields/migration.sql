-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "waiveNote" TEXT;

-- AlterTable
ALTER TABLE "InvoiceTemplate" ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "lastRunOk" BOOLEAN,
ADD COLUMN     "sentCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "alertFeeApproval" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "alertOverdue" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "alertPayment" BOOLEAN NOT NULL DEFAULT false;
