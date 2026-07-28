ALTER TABLE customers
  DROP CONSTRAINT IF EXISTS customers_status_check;

ALTER TABLE customers
  ADD CONSTRAINT customers_status_check
  CHECK (status IN ('lead', 'active', 'paused', 'inactive', 'cancelled'));

ALTER TABLE customers
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN cancellation_reason text;
