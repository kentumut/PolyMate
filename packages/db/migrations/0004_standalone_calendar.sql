-- PolyMate-owned calendar events are the always-available source of truth.
CREATE TABLE calendar_events (
  id text PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  all_day boolean NOT NULL DEFAULT false,
  completion text NOT NULL DEFAULT 'open' CHECK (completion IN ('open', 'done')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_at > start_at)
);
CREATE INDEX calendar_events_owner_range_idx ON calendar_events(owner_id, start_at, end_at);
