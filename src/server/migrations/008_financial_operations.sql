CREATE TABLE service_payment_decisions (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  charge_id uuid NOT NULL REFERENCES customer_charges(id) ON DELETE CASCADE,
  payment_id uuid REFERENCES payments(id) ON DELETE SET NULL,
  decision text NOT NULL CHECK (decision IN ('approved', 'declined')),
  hourly_minutes integer CHECK (hourly_minutes > 0 AND hourly_minutes <= 1440),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  decided_by uuid NOT NULL REFERENCES users(id),
  decided_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, booking_id)
);

CREATE TABLE business_expenses (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  spent_on date NOT NULL,
  category text NOT NULL CHECK (
    category IN ('supplies', 'fuel', 'equipment', 'software', 'other')
  ),
  description text NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  recorded_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX service_payment_decisions_date_idx
  ON service_payment_decisions (organization_id, decided_at);
CREATE INDEX business_expenses_date_idx
  ON business_expenses (organization_id, spent_on);
