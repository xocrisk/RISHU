ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

ALTER TABLE email_otps DROP CONSTRAINT IF EXISTS email_otps_purpose_check;
ALTER TABLE email_otps ADD CONSTRAINT email_otps_purpose_check
  CHECK (purpose IN ('signup', 'login', 'password_reset'));

CREATE TABLE IF NOT EXISTS oauth_accounts (
  provider TEXT NOT NULL CHECK (provider IN ('google', 'apple')),
  provider_subject TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, provider_subject),
  UNIQUE (provider, user_id)
);

CREATE TABLE IF NOT EXISTS oauth_transactions (
  state_hash TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'apple')),
  nonce TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
