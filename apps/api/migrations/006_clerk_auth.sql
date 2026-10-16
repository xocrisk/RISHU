CREATE TABLE IF NOT EXISTS clerk_auth_identities (
  clerk_user_id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS clerk_auth_identities_user_id_idx
  ON clerk_auth_identities(user_id);
