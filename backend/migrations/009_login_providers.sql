ALTER TABLE oauth_accounts DROP CONSTRAINT IF EXISTS oauth_accounts_provider_check;
ALTER TABLE oauth_accounts ADD CONSTRAINT oauth_accounts_provider_check
  CHECK (provider IN ('google', 'microsoft', 'apple'));

ALTER TABLE oauth_transactions DROP CONSTRAINT IF EXISTS oauth_transactions_provider_check;
ALTER TABLE oauth_transactions ADD CONSTRAINT oauth_transactions_provider_check
  CHECK (provider IN ('google', 'microsoft', 'apple'));
ALTER TABLE oauth_transactions ADD COLUMN IF NOT EXISTS return_origin TEXT;

CREATE TABLE IF NOT EXISTS oauth_link_attempts (
  token_hash TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'microsoft')),
  provider_subject TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_subject)
);

CREATE INDEX IF NOT EXISTS oauth_link_attempts_expires_at_idx ON oauth_link_attempts(expires_at);
