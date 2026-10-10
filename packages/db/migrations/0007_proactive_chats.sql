-- Persisted chats. A chat is started by the student, or by PolyMate as a proactive check-in.
CREATE TABLE chat_conversations (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  origin text NOT NULL CHECK (origin IN ('student','check_in')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  check_in_kind text CHECK (check_in_kind IN ('session_follow_up','deadline_risk','stuck_follow_up','assignment','course','general')),
  -- One chat per question: repeated rule runs cannot ask the same thing twice.
  dedupe_key text CHECK (char_length(dedupe_key) BETWEEN 1 AND 200),
  topic jsonb NOT NULL DEFAULT '{}',
  quick_replies text[] NOT NULL DEFAULT '{}',
  agent_context text CHECK (agent_context IS NULL OR char_length(agent_context) <= 2000),
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, owner_id),
  UNIQUE (owner_id, dedupe_key),
  CHECK ((origin = 'check_in') = (dedupe_key IS NOT NULL AND check_in_kind IS NOT NULL))
);
CREATE INDEX chat_conversations_owner_updated_idx ON chat_conversations(owner_id, updated_at DESC);
CREATE INDEX chat_conversations_owner_check_in_idx ON chat_conversations(owner_id, created_at DESC) WHERE origin = 'check_in';

CREATE TABLE chat_messages (
  id bigserial PRIMARY KEY,
  conversation_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('user','assistant')),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 8000),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (conversation_id, owner_id) REFERENCES chat_conversations(id, owner_id) ON DELETE CASCADE
);
CREATE INDEX chat_messages_conversation_idx ON chat_messages(conversation_id, id);
CREATE INDEX chat_messages_owner_user_idx ON chat_messages(owner_id, created_at DESC) WHERE role = 'user';

-- One row per channel a check-in was announced on. Only 'web' is used today; 'telegram' is reserved.
CREATE TABLE chat_deliveries (
  conversation_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('web','telegram')),
  status text NOT NULL CHECK (status IN ('sent','failed','skipped','unknown')),
  external_id text CHECK (external_id IS NULL OR char_length(external_id) <= 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, channel),
  FOREIGN KEY (conversation_id, owner_id) REFERENCES chat_conversations(id, owner_id) ON DELETE CASCADE
);

CREATE TABLE check_in_preferences (
  owner_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  paused boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
