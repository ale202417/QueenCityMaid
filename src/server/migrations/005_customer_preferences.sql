ALTER TABLE customers ADD COLUMN service_frequency text;
ALTER TABLE customers ADD COLUMN payment_method text;

ALTER TABLE customers
  ADD CONSTRAINT customers_service_frequency_check
  CHECK (
    service_frequency IS NULL
    OR service_frequency IN ('weekly', 'biweekly', 'monthly', 'other')
  );

ALTER TABLE customers
  ADD CONSTRAINT customers_payment_method_check
  CHECK (
    payment_method IS NULL
    OR payment_method IN ('zelle', 'venmo', 'paypal', 'cash', 'check', 'other')
  );
