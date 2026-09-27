-- Subscription billing fields on Account (what the owner pays Dunn),
-- separate from the connected Stripe account (merchant-of-record for invoices).

-- AlterTable
ALTER TABLE "Account" ADD COLUMN "stripeCustomerId" TEXT,
ADD COLUMN "plan" TEXT,
ADD COLUMN "stripeSubscriptionId" TEXT,
ADD COLUMN "subscriptionStatus" TEXT,
ADD COLUMN "currentPeriodEnd" TIMESTAMP(3),
ADD COLUMN "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "Account_stripeCustomerId_key" ON "Account"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_stripeSubscriptionId_key" ON "Account"("stripeSubscriptionId");