CREATE TABLE IF NOT EXISTS firebase_auth_identities (
  firebase_uid TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS firebase_auth_identities_user_id_idx
  ON firebase_auth_identities(user_id);
