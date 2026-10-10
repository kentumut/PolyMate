-- Where a student's study blocks live. 'google' requires a stored Google connection, so the
-- preference sits on that row: without a connection the PolyMate calendar is the only home.
ALTER TABLE calendar_connections
  ADD COLUMN calendar_home text NOT NULL DEFAULT 'polymate' CHECK (calendar_home IN ('polymate', 'google'));
