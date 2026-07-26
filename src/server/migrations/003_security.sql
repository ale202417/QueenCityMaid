CREATE TABLE login_attempts (
  key_hash text PRIMARY KEY,
  attempt_count integer NOT NULL CHECK (attempt_count > 0),
  reset_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX login_attempts_reset_idx ON login_attempts (reset_at);
