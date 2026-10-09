-- PolyMate iteration 1: persistence owned by the application.
-- Apply with the migration runner in a transaction.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_identity text NOT NULL UNIQUE,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE calendar_connections (
  owner_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'google' CHECK (provider = 'google'),
  google_account_email text,
  access_token_ciphertext text,
  refresh_token_ciphertext text,
  access_token_expires_at timestamptz,
  granted_scopes text[] NOT NULL DEFAULT '{}',
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (access_token_ciphertext IS NOT NULL OR refresh_token_ciphertext IS NOT NULL)
);

CREATE TABLE oauth_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state_hash bytea NOT NULL UNIQUE,
  browser_binding_hash bytea NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oauth_states_expiry_idx ON oauth_states(expires_at);

CREATE TABLE calendar_operations (
  operation_id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation_kind text NOT NULL CHECK (operation_kind IN ('create','update','complete','delete')),
  target_event_id text,
  expected_etag text,
  intended_change jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','synced','failed','unknown')),
  result jsonb,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX calendar_operations_owner_created_idx ON calendar_operations(owner_id, created_at DESC);

-- Avoid retaining expired or consumed OAuth nonces indefinitely.
CREATE FUNCTION prune_oauth_states() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM oauth_states WHERE expires_at < now() OR consumed_at < now() - interval '1 day';
  RETURN NEW;
END;
$$;
CREATE TRIGGER oauth_states_prune_trigger
  AFTER INSERT ON oauth_states FOR EACH STATEMENT EXECUTE FUNCTION prune_oauth_states();
