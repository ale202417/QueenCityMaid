ALTER TABLE recurring_services ADD COLUMN billing_type text NOT NULL DEFAULT 'flat';
ALTER TABLE recurring_services ADD COLUMN billing_rate_cents integer;
ALTER TABLE recurring_services ADD COLUMN special_instructions text NOT NULL DEFAULT '';

ALTER TABLE recurring_services
  ADD CONSTRAINT recurring_services_billing_type_check
  CHECK (billing_type IN ('flat', 'hourly'));

ALTER TABLE recurring_services
  ADD CONSTRAINT recurring_services_billing_rate_check
  CHECK (billing_rate_cents IS NULL OR billing_rate_cents >= 0);

ALTER TABLE recurring_services
  ADD CONSTRAINT recurring_services_hourly_rate_check
  CHECK (billing_type <> 'hourly' OR billing_rate_cents IS NOT NULL);

ALTER TABLE bookings ADD COLUMN service_date date;
ALTER TABLE bookings ADD COLUMN recurrence_due_date date;
ALTER TABLE bookings ADD COLUMN billing_type text NOT NULL DEFAULT 'flat';
ALTER TABLE bookings ADD COLUMN billing_rate_cents integer;

UPDATE bookings
SET service_date = CAST(scheduled_start AS date)
WHERE service_date IS NULL;

ALTER TABLE bookings
  ADD CONSTRAINT bookings_billing_type_check
  CHECK (billing_type IN ('flat', 'hourly'));

ALTER TABLE bookings
  ADD CONSTRAINT bookings_billing_rate_check
  CHECK (billing_rate_cents IS NULL OR billing_rate_cents >= 0);

ALTER TABLE bookings
  ADD CONSTRAINT bookings_hourly_rate_check
  CHECK (billing_type <> 'hourly' OR billing_rate_cents IS NOT NULL);

CREATE UNIQUE INDEX bookings_recurring_occurrence_idx
  ON bookings (recurring_service_id, recurrence_due_date);

CREATE INDEX bookings_service_date_idx
  ON bookings (organization_id, service_date, status);
