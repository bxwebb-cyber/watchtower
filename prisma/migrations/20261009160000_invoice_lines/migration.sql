-- Line items: [{ description, quantity, unitCents }]. Null on invoices made
-- before line items (one amount, shown as a single line).
ALTER TABLE "Invoice" ADD COLUMN "lines" JSONB;
