-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "feeAmountCents" INTEGER,
ADD COLUMN     "feeDueDate" TIMESTAMP(3),
ADD COLUMN     "feeIssuedAt" TIMESTAMP(3),
ADD COLUMN     "feePaidAt" TIMESTAMP(3),
ADD COLUMN     "feeStatus" TEXT;
