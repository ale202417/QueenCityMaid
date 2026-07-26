CREATE TABLE business_settings (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  response_target_minutes integer NOT NULL DEFAULT 60 CHECK (response_target_minutes > 0),
  hourly_team_rate_cents integer NOT NULL DEFAULT 9900 CHECK (hourly_team_rate_cents >= 0),
  late_cancellation_fee_cents integer NOT NULL DEFAULT 5000 CHECK (late_cancellation_fee_cents >= 0),
  captain_reimbursement_cents integer NOT NULL DEFAULT 1600 CHECK (captain_reimbursement_cents >= 0),
  route_warning_minutes integer NOT NULL DEFAULT 540 CHECK (route_warning_minutes > 0),
  route_warning_end_time time NOT NULL DEFAULT '18:00',
  quote_review_days integer NOT NULL DEFAULT 30 CHECK (quote_review_days > 0),
  payment_reminder_days integer NOT NULL DEFAULT 7 CHECK (payment_reminder_days > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE leads (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES users(id),
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  source text NOT NULL,
  name text NOT NULL,
  phone text,
  email text,
  message text NOT NULL DEFAULT '',
  status text NOT NULL CHECK (status IN (
    'new', 'contacted', 'awaiting_information', 'quote_ready', 'converted',
    'declined', 'unresponsive', 'duplicate', 'not_serviceable'
  )),
  received_at timestamptz NOT NULL,
  response_due_at timestamptz NOT NULL,
  first_responded_at timestamptz,
  follow_up_due_at timestamptz,
  follow_up_completed_at timestamptz,
  closed_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE lead_activities (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  type text NOT NULL CHECK (type IN ('note', 'call', 'text', 'email', 'status_change', 'follow_up')),
  body text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE quotes (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id),
  property_id uuid NOT NULL REFERENCES properties(id),
  created_by uuid NOT NULL REFERENCES users(id),
  pricing_type text NOT NULL CHECK (pricing_type IN ('flat', 'hourly_team', 'inspection')),
  status text NOT NULL CHECK (status IN ('draft', 'sent', 'approved', 'needs_review', 'declined', 'superseded')),
  hourly_rate_cents integer CHECK (hourly_rate_cents >= 0),
  estimated_hours numeric(5,2) CHECK (estimated_hours > 0),
  subtotal_cents integer NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
  notes text NOT NULL DEFAULT '',
  sent_at timestamptz,
  approved_at timestamptz,
  declined_at timestamptz,
  follow_up_due_at timestamptz,
  follow_up_completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    pricing_type <> 'hourly_team'
    OR (hourly_rate_cents IS NOT NULL AND estimated_hours IS NOT NULL)
  )
);

CREATE TABLE quote_items (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  quote_id uuid NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  service_type_id uuid REFERENCES service_types(id),
  description text NOT NULL,
  quantity numeric(8,2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_cents integer NOT NULL CHECK (unit_price_cents >= 0),
  line_total_cents integer NOT NULL CHECK (line_total_cents >= 0),
  sort_order integer NOT NULL DEFAULT 0
);

CREATE TABLE quote_approvals (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  quote_id uuid NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  recorded_by uuid NOT NULL REFERENCES users(id),
  reply_text text NOT NULL,
  approved boolean NOT NULL,
  received_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE recurring_services (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id),
  property_id uuid NOT NULL REFERENCES properties(id),
  service_type_id uuid NOT NULL REFERENCES service_types(id),
  preferred_team_id uuid REFERENCES teams(id),
  quote_id uuid REFERENCES quotes(id),
  status text NOT NULL CHECK (status IN ('active', 'paused', 'ended')),
  recurrence_rule jsonb NOT NULL,
  preferred_start_time time,
  expected_duration_minutes integer NOT NULL CHECK (expected_duration_minutes > 0),
  price_cents integer NOT NULL CHECK (price_cents >= 0),
  starts_on date NOT NULL,
  paused_at timestamptz,
  restart_on date,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bookings (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id),
  property_id uuid NOT NULL REFERENCES properties(id),
  service_type_id uuid NOT NULL REFERENCES service_types(id),
  quote_id uuid REFERENCES quotes(id),
  recurring_service_id uuid REFERENCES recurring_services(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN (
    'requested', 'confirmed', 'assigned', 'in_progress', 'completed',
    'rescheduled', 'cancelled', 'unable_to_complete'
  )),
  scheduled_start timestamptz NOT NULL,
  expected_duration_minutes integer NOT NULL CHECK (expected_duration_minutes > 0),
  actual_duration_minutes integer CHECK (actual_duration_minutes > 0),
  price_cents integer NOT NULL CHECK (price_cents >= 0),
  customer_time_window_start timestamptz,
  customer_time_window_end timestamptz,
  special_requests text NOT NULL DEFAULT '',
  cancellation_fee_cents integer NOT NULL DEFAULT 0 CHECK (cancellation_fee_cents >= 0),
  cancellation_fee_waived boolean NOT NULL DEFAULT false,
  cancellation_waiver_reason text,
  previous_booking_id uuid REFERENCES bookings(id),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    customer_time_window_end IS NULL
    OR customer_time_window_start IS NULL
    OR customer_time_window_end > customer_time_window_start
  ),
  CHECK (
    cancellation_fee_waived = false
    OR cancellation_waiver_reason IS NOT NULL
  )
);

CREATE TABLE job_assignments (
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id),
  role text NOT NULL CHECK (role IN ('cleaner', 'captain')),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (booking_id, employee_id)
);

CREATE TABLE routes (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES teams(id),
  captain_employee_id uuid NOT NULL REFERENCES employees(id),
  service_date date NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'finalized', 'in_progress', 'completed')),
  estimated_paid_minutes integer NOT NULL DEFAULT 0 CHECK (estimated_paid_minutes >= 0),
  estimated_finish_at timestamptz,
  finalized_by uuid REFERENCES users(id),
  finalized_at timestamptz,
  override_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, team_id, service_date)
);

CREATE TABLE route_stops (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  route_id uuid NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  stop_order integer NOT NULL CHECK (stop_order > 0),
  estimated_arrival timestamptz,
  estimated_departure timestamptz,
  travel_minutes_from_previous integer NOT NULL DEFAULT 0 CHECK (travel_minutes_from_previous >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (route_id, stop_order),
  UNIQUE (route_id, booking_id)
);

CREATE TABLE job_issues (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  reported_by_employee_id uuid REFERENCES employees(id),
  recorded_by_user_id uuid REFERENCES users(id),
  type text NOT NULL CHECK (type IN ('access', 'damage', 'safety', 'extra_work', 'service', 'other')),
  description text NOT NULL,
  customer_approved boolean,
  additional_charge_cents integer CHECK (additional_charge_cents >= 0),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE time_entries (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  route_id uuid NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id),
  status text NOT NULL CHECK (status IN ('open', 'submitted', 'approved', 'corrected')),
  check_in_at timestamptz NOT NULL,
  check_out_at timestamptz,
  paid_minutes integer CHECK (paid_minutes >= 0),
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (route_id, employee_id),
  CHECK (check_out_at IS NULL OR check_out_at > check_in_at)
);

CREATE TABLE time_corrections (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  time_entry_id uuid NOT NULL REFERENCES time_entries(id) ON DELETE CASCADE,
  corrected_by uuid NOT NULL REFERENCES users(id),
  before_data jsonb NOT NULL,
  after_data jsonb NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE customer_charges (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id),
  booking_id uuid REFERENCES bookings(id),
  type text NOT NULL CHECK (type IN ('service', 'additional_work', 'cancellation_fee')),
  description text NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  status text NOT NULL CHECK (status IN ('unpaid', 'paid', 'disputed', 'credited', 'waived')),
  charged_on date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payments (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id),
  recorded_by uuid NOT NULL REFERENCES users(id),
  method text NOT NULL CHECK (method IN ('zelle', 'venmo', 'paypal', 'cash', 'check')),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  paid_at timestamptz NOT NULL,
  reference text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payment_allocations (
  payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  charge_id uuid NOT NULL REFERENCES customer_charges(id) ON DELETE CASCADE,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  PRIMARY KEY (payment_id, charge_id)
);

CREATE TABLE customer_credits (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id),
  source_payment_id uuid REFERENCES payments(id),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  remaining_cents integer NOT NULL CHECK (remaining_cents >= 0),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (remaining_cents <= amount_cents)
);

CREATE TABLE tips (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES bookings(id),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  source text NOT NULL CHECK (source IN ('customer', 'employee', 'manager')),
  recorded_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES customers(id),
  employee_id uuid REFERENCES employees(id),
  booking_id uuid REFERENCES bookings(id),
  type text NOT NULL,
  channel text NOT NULL CHECK (channel = 'sms'),
  destination text NOT NULL,
  body text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'sent', 'delivered', 'failed', 'cancelled')),
  idempotency_key text NOT NULL UNIQUE,
  due_at timestamptz NOT NULL,
  sent_at timestamptz,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payroll_periods (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  status text NOT NULL CHECK (status IN ('open', 'review', 'approved', 'exported')),
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, starts_on, ends_on),
  CHECK (ends_on >= starts_on)
);

CREATE TABLE payroll_lines (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  payroll_period_id uuid NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id),
  week_starts_on date NOT NULL,
  regular_minutes integer NOT NULL CHECK (regular_minutes >= 0),
  overtime_minutes integer NOT NULL DEFAULT 0 CHECK (overtime_minutes >= 0),
  hourly_rate_cents integer NOT NULL CHECK (hourly_rate_cents >= 0),
  tips_cents integer NOT NULL DEFAULT 0 CHECK (tips_cents >= 0),
  captain_days integer NOT NULL DEFAULT 0 CHECK (captain_days >= 0),
  captain_reimbursement_cents integer NOT NULL DEFAULT 0 CHECK (captain_reimbursement_cents >= 0),
  gross_wages_cents integer NOT NULL CHECK (gross_wages_cents >= 0),
  UNIQUE (payroll_period_id, employee_id, week_starts_on)
);

CREATE TABLE payroll_exports (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  payroll_period_id uuid NOT NULL REFERENCES payroll_periods(id),
  version integer NOT NULL CHECK (version > 0),
  created_by uuid NOT NULL REFERENCES users(id),
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payroll_period_id, version)
);

CREATE INDEX leads_due_idx ON leads (organization_id, status, response_due_at);
CREATE INDEX quotes_status_idx ON quotes (organization_id, status, sent_at);
CREATE INDEX bookings_schedule_idx ON bookings (organization_id, scheduled_start, status);
CREATE INDEX recurring_status_idx ON recurring_services (organization_id, status);
CREATE INDEX routes_date_idx ON routes (organization_id, service_date, status);
CREATE INDEX charges_customer_idx ON customer_charges (customer_id, status, charged_on);
CREATE INDEX notifications_due_idx ON notifications (status, due_at);
CREATE INDEX payroll_period_idx ON payroll_periods (organization_id, starts_on, ends_on);
