CREATE TABLE moodle_calendar_subscriptions (
  owner_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL DEFAULT gen_random_uuid(),
  site text NOT NULL,
  url_ciphertext text NOT NULL,
  snapshot jsonb NOT NULL,
  last_synced_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
