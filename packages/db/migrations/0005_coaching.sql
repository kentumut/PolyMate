CREATE TABLE student_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('plan','preference','goal','constraint','weekly_context')),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 2000),
  valid_until timestamptz,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX student_memories_owner_active_idx ON student_memories(owner_id, updated_at DESC) WHERE archived_at IS NULL;

CREATE TABLE coach_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('weekly_question','digest','reminder','follow_up')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  requires_response boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'unread' CHECK (status IN ('unread','read','responded','dismissed')),
  week_start date,
  question_key text,
  response_text text CHECK (response_text IS NULL OR char_length(response_text) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  UNIQUE NULLS NOT DISTINCT (owner_id, week_start, question_key)
);
CREATE INDEX coach_messages_owner_created_idx ON coach_messages(owner_id, created_at DESC);
