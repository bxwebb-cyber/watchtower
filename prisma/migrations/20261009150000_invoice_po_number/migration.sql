-- The client's purchase-order number, shown on the invoice (optional).
ALTER TABLE "Invoice" ADD COLUMN "poNumber" TEXT;
