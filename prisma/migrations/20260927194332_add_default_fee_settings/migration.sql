-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "defaultFeeAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "defaultFeeKind" TEXT NOT NULL DEFAULT 'none',
ADD COLUMN     "defaultGraceDays" INTEGER NOT NULL DEFAULT 7;
