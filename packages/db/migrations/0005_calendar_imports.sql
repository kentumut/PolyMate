CREATE TABLE calendar_import_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('moodle','mystudies')),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  imported_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id,owner_id)
);
CREATE TABLE calendar_import_entries (
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collection_id uuid NOT NULL,
  event_key text NOT NULL CHECK (char_length(event_key)=64),
  uid text NOT NULL CHECK (char_length(uid) BETWEEN 1 AND 1024),
  recurrence_id text NOT NULL DEFAULT '',
  kind text NOT NULL CHECK (kind IN ('assignment','commitment')),
  source_event jsonb NOT NULL,
  assignment_id uuid,
  reviewed_input jsonb,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL CHECK (end_at >= start_at),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id,collection_id,event_key),
  UNIQUE (owner_id,collection_id,uid,recurrence_id),
  FOREIGN KEY (collection_id,owner_id) REFERENCES calendar_import_collections(id,owner_id) ON DELETE CASCADE,
  FOREIGN KEY (assignment_id,owner_id) REFERENCES assignments(id,owner_id),
  CHECK ((kind='assignment' AND assignment_id IS NOT NULL AND reviewed_input IS NOT NULL) OR
         (kind='commitment' AND assignment_id IS NULL AND reviewed_input IS NULL AND end_at > start_at))
);
CREATE INDEX calendar_import_busy_idx ON calendar_import_entries(owner_id,start_at,end_at) WHERE kind='commitment';
CREATE TABLE calendar_import_previews (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collection_id uuid NOT NULL,
  snapshot jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id,owner_id),
  FOREIGN KEY (collection_id,owner_id) REFERENCES calendar_import_collections(id,owner_id) ON DELETE CASCADE
);
CREATE INDEX calendar_import_preview_owner_idx ON calendar_import_previews(owner_id,created_at DESC);
CREATE TABLE calendar_import_confirmations (
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  preview_id uuid NOT NULL,
  request_snapshot jsonb NOT NULL,
  result_snapshot jsonb NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id,request_id),
  UNIQUE (owner_id,preview_id),
  FOREIGN KEY (preview_id,owner_id) REFERENCES calendar_import_previews(id,owner_id)
);
