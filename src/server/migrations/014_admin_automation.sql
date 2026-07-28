ALTER TABLE business_settings
  ADD COLUMN schedule_automation_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN service_reminder_automation_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN payment_reminder_automation_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN automation_run_time time NOT NULL DEFAULT '05:00';

CREATE TABLE automation_runs (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  run_key text NOT NULL,
  trigger text NOT NULL CHECK (trigger IN ('scheduled', 'manual')),
  status text NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (organization_id, run_key)
);

CREATE INDEX automation_runs_history_idx
  ON automation_runs (organization_id, started_at DESC);
