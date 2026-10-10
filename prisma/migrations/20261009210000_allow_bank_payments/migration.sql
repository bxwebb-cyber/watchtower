-- Offer bank transfer (ACH) next to card on every invoice Dunn creates.
ALTER TABLE "Settings" ADD COLUMN "allowBankPayments" BOOLEAN NOT NULL DEFAULT true;
