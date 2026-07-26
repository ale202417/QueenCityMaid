ALTER TABLE notifications
  ADD COLUMN provider_message_id text,
  ADD COLUMN provider_status text,
  ADD COLUMN send_attempted_at timestamptz,
  ADD COLUMN delivered_at timestamptz;

CREATE UNIQUE INDEX notifications_provider_message_idx
  ON notifications (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE TABLE inbound_messages (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES customers(id),
  provider_message_id text NOT NULL UNIQUE,
  from_phone text NOT NULL,
  to_phone text NOT NULL,
  body text NOT NULL,
  opt_out_type text CHECK (opt_out_type IN ('START', 'STOP', 'HELP')),
  received_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX inbound_messages_org_received_idx
  ON inbound_messages (organization_id, received_at DESC);
