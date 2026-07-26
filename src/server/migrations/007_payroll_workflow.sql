CREATE TABLE payroll_day_entries (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  payroll_period_id uuid NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id),
  work_date date NOT NULL,
  check_in_minute integer NOT NULL CHECK (check_in_minute BETWEEN 0 AND 1439),
  check_out_minute integer NOT NULL CHECK (check_out_minute BETWEEN 1 AND 1440),
  paid_minutes integer NOT NULL CHECK (paid_minutes > 0 AND paid_minutes <= 1440),
  tips_cents integer NOT NULL DEFAULT 0 CHECK (tips_cents >= 0),
  recorded_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payroll_period_id, employee_id, work_date),
  CHECK (check_out_minute > check_in_minute),
  CHECK (paid_minutes = check_out_minute - check_in_minute)
);

CREATE INDEX payroll_day_entries_period_idx
  ON payroll_day_entries (organization_id, payroll_period_id, work_date);
