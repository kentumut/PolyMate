CREATE TABLE student_onboarding (
  owner_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  goal text NOT NULL CHECK (goal IN ('deadline','exam','balance')),
  session_minutes integer NOT NULL CHECK (session_minutes IN (30,50)),
  coach_cadence text NOT NULL CHECK (coach_cadence IN ('proactive','weekly')),
  completed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
