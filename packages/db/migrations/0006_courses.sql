CREATE TABLE courses (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  exercise_session_count integer NOT NULL CHECK (exercise_session_count BETWEEN 0 AND 200),
  lecture_hours_per_week numeric(4,1) NOT NULL CHECK (lecture_hours_per_week BETWEEN 0 AND 60),
  exercise_session_minutes integer NOT NULL CHECK (exercise_session_minutes BETWEEN 0 AND 1440),
  exam_date date NOT NULL,
  must_solve text[] NOT NULL DEFAULT '{}',
  optional_solve text[] NOT NULL DEFAULT '{}',
  not_required text[] NOT NULL DEFAULT '{}',
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, owner_id)
);
CREATE UNIQUE INDEX courses_owner_name_unique ON courses(owner_id, lower(name));
CREATE INDEX courses_owner_exam_idx ON courses(owner_id, exam_date, id);
