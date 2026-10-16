ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS college TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS lpu_registration_number TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mobile_verified_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS phone_otps (
  mobile TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('signup', 'login', 'password_reset')),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (mobile, purpose)
);
