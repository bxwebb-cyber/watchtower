-- Which recurring invoice created this invoice (null for one-off invoices),
-- so the recurring view can list everything it sent.
ALTER TABLE "Invoice" ADD COLUMN "templateId" TEXT;
CREATE INDEX "Invoice_templateId_idx" ON "Invoice"("templateId");
