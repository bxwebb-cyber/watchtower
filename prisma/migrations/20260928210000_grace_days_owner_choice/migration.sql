-- Dunn no longer pre-fills a 7-day grace period: new owners choose their own
-- (0 = the fee applies the day after the due date). Existing values are kept.
ALTER TABLE "Settings" ALTER COLUMN "defaultGraceDays" DROP DEFAULT;
ALTER TABLE "Settings" ALTER COLUMN "defaultGraceDays" DROP NOT NULL;
