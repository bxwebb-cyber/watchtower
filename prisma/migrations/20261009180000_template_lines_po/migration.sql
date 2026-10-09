-- Recurring invoices: line items and the client's PO number, copied to
-- every invoice in the series.
ALTER TABLE "InvoiceTemplate" ADD COLUMN "lines" JSONB;
ALTER TABLE "InvoiceTemplate" ADD COLUMN "poNumber" TEXT;
