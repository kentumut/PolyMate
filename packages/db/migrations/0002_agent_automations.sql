CREATE TABLE agent_automation_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  registration_key text NOT NULL CHECK (registration_key ~ '^[a-z][a-z0-9-]{0,63}$'),
  gateway_job_id text NOT NULL UNIQUE,
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 100),
  allowed_tools text[] NOT NULL CHECK (cardinality(allowed_tools) BETWEEN 1 AND 4),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, registration_key)
);
CREATE INDEX agent_automation_owner_idx ON agent_automation_registrations(owner_id, created_at DESC);
