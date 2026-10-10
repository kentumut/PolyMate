CREATE TABLE assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  due_at timestamptz NOT NULL,
  estimated_minutes integer NOT NULL CHECK (estimated_minutes > 0),
  remaining_minutes integer NOT NULL CHECK (remaining_minutes >= 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'completed', 'cancelled')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  client_request_id uuid NOT NULL,
  creation_input jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, client_request_id)
);

CREATE INDEX assignments_owner_deadline_idx ON assignments(owner_id, due_at, id);
