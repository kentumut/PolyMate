CREATE TABLE study_preferences (
  owner_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  preferences jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE study_plans (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id)
);
CREATE INDEX study_plans_owner_created_idx ON study_plans(owner_id, created_at DESC);

-- Links are written before dispatch. The existing operation log remains authoritative
-- even if the web process dies after Google confirms a block.
CREATE TABLE study_plan_blocks (
  operation_id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  FOREIGN KEY (assignment_id, owner_id) REFERENCES assignments(id, owner_id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, plan_id) REFERENCES study_plans(owner_id, id) ON DELETE CASCADE
);
CREATE INDEX study_plan_blocks_owner_idx ON study_plan_blocks(owner_id, assignment_id);
