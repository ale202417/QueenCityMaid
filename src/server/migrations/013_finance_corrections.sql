ALTER TABLE payments
  ADD COLUMN status text NOT NULL DEFAULT 'recorded'
    CHECK (status IN ('recorded', 'reversed')),
  ADD COLUMN reversed_at timestamptz,
  ADD COLUMN reversed_by uuid REFERENCES users(id),
  ADD COLUMN reversal_reason text;

ALTER TABLE payment_allocations
  ADD COLUMN reversed_at timestamptz,
  ADD COLUMN reversal_reason text;

ALTER TABLE business_expenses
  ADD COLUMN status text NOT NULL DEFAULT 'recorded'
    CHECK (status IN ('recorded', 'voided')),
  ADD COLUMN voided_at timestamptz,
  ADD COLUMN voided_by uuid REFERENCES users(id),
  ADD COLUMN void_reason text;

CREATE INDEX payments_status_date_idx
  ON payments (organization_id, status, paid_at);

CREATE UNIQUE INDEX customer_charges_one_service_per_booking_idx
  ON customer_charges (organization_id, booking_id)
  WHERE booking_id IS NOT NULL AND type = 'service';

CREATE UNIQUE INDEX users_organization_email_lower_idx
  ON users (organization_id, lower(email));

ALTER TABLE users
  ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX tips_one_per_booking_idx
  ON tips (organization_id, booking_id);
