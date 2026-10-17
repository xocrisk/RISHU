-- Public user IDs, the LPU trading championship, community chat and personal notes.

-- ---------------------------------------------------------------- UID
-- 8 characters from an alphabet without look-alikes (no 0/O, 1/I/L). 32^8 ≈ 1.1 trillion combinations.
CREATE OR REPLACE FUNCTION xocrisk_random_uid(len INTEGER) RETURNS TEXT AS $$
DECLARE
  alphabet CONSTANT TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  result TEXT := '';
BEGIN
  FOR i IN 1..len LOOP
    result := result || substr(alphabet, 1 + floor(random() * length(alphabet))::INTEGER, 1);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql VOLATILE;

ALTER TABLE users ADD COLUMN IF NOT EXISTS uid TEXT;

-- Give existing users a UID, skipping any value already taken.
DO $$
DECLARE
  target UUID;
  candidate TEXT;
BEGIN
  FOR target IN SELECT id FROM users WHERE uid IS NULL LOOP
    LOOP
      candidate := xocrisk_random_uid(8);
      EXIT WHEN NOT EXISTS (SELECT 1 FROM users WHERE uid = candidate);
    END LOOP;
    UPDATE users SET uid = candidate WHERE id = target;
  END LOOP;
END $$;

-- The unique index is what guarantees no two users ever share a UID.
CREATE UNIQUE INDEX IF NOT EXISTS users_uid_key ON users(uid);
ALTER TABLE users ALTER COLUMN uid SET NOT NULL;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_uid_format;
ALTER TABLE users ADD CONSTRAINT users_uid_format CHECK (uid ~ '^[A-Z0-9]{6,}$');

-- New users get a fresh UID on insert.
CREATE OR REPLACE FUNCTION xocrisk_assign_uid() RETURNS TRIGGER AS $$
DECLARE
  candidate TEXT;
BEGIN
  IF NEW.uid IS NULL THEN
    LOOP
      candidate := xocrisk_random_uid(8);
      EXIT WHEN NOT EXISTS (SELECT 1 FROM users WHERE uid = candidate);
    END LOOP;
    NEW.uid := candidate;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_assign_uid ON users;
CREATE TRIGGER users_assign_uid BEFORE INSERT ON users FOR EACH ROW EXECUTE FUNCTION xocrisk_assign_uid();

-- ---------------------------------------------------------------- Championship
CREATE TABLE IF NOT EXISTS championships (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  organizer TEXT NOT NULL,
  description TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL CHECK (ends_at > starts_at),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS championship_participants (
  championship_id TEXT NOT NULL REFERENCES championships(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Portfolio value when the user joined; returns are measured from here.
  start_value NUMERIC(14, 2) NOT NULL CHECK (start_value > 0),
  PRIMARY KEY (championship_id, user_id)
);

INSERT INTO championships (id, title, organizer, description, starts_at, ends_at)
VALUES (
  'lpu-2026',
  'LPU Trading Championship 2026',
  'Lovely Professional University',
  'A paper-trading championship conducted by Lovely Professional University. Trade NIFTY 500 stocks with your XOCRISK practice money; the highest percentage return at the closing bell wins.',
  '2026-10-19 09:15:00+05:30',
  '2026-12-18 15:30:00+05:30'
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------- Community chat
CREATE TABLE IF NOT EXISTS community_messages (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS community_messages_user_created_idx ON community_messages(user_id, created_at DESC);

-- ---------------------------------------------------------------- Notes
CREATE TABLE IF NOT EXISTS user_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '' CHECK (char_length(title) <= 120),
  body TEXT NOT NULL DEFAULT '' CHECK (char_length(body) <= 10000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_notes_user_updated_idx ON user_notes(user_id, updated_at DESC);
