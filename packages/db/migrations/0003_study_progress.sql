ALTER TABLE assignments ADD CONSTRAINT assignments_id_owner_unique UNIQUE (id, owner_id);

CREATE TABLE assignment_block_links (
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id text NOT NULL,
  assignment_id uuid NOT NULL,
  session_revision integer NOT NULL DEFAULT 1 CHECK (session_revision > 0),
  last_start_at timestamptz NOT NULL,
  last_end_at timestamptz NOT NULL,
  last_etag text NOT NULL,
  completion text NOT NULL CHECK (completion IN ('open','done')),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_observed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, event_id),
  UNIQUE (owner_id, event_id, assignment_id),
  FOREIGN KEY (assignment_id, owner_id) REFERENCES assignments(id, owner_id) ON DELETE CASCADE
);

CREATE TABLE assignment_block_intents (
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  PRIMARY KEY (owner_id, operation_id),
  FOREIGN KEY (assignment_id, owner_id) REFERENCES assignments(id, owner_id) ON DELETE CASCADE
);

CREATE TABLE study_progress_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_request_id uuid NOT NULL,
  event_id text NOT NULL,
  assignment_id uuid NOT NULL,
  session_revision integer NOT NULL,
  action text NOT NULL CHECK (action IN ('done','partly_done','missed','stuck')),
  note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 2000),
  reported_remaining_minutes integer CHECK (reported_remaining_minutes >= 0),
  assignment_finished boolean NOT NULL DEFAULT false,
  request_snapshot jsonb NOT NULL,
  result_snapshot jsonb NOT NULL,
  calendar_result jsonb,
  reported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, client_request_id),
  FOREIGN KEY (owner_id, event_id, assignment_id) REFERENCES assignment_block_links(owner_id, event_id, assignment_id) ON DELETE CASCADE
);
CREATE INDEX study_progress_owner_reported_idx ON study_progress_reports(owner_id, reported_at, id);

CREATE TABLE study_calendar_effects (
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL,
  PRIMARY KEY (owner_id, operation_id)
);

CREATE TABLE study_activity_events (
  id bigserial PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_key text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('block_linked','progress_recorded','block_rescheduled','block_completed','block_deleted')),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, event_key)
);
CREATE INDEX study_activity_owner_cursor_idx ON study_activity_events(owner_id, id);
