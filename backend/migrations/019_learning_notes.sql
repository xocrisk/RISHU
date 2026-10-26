-- Learning notes are shared; existing personal user_notes are left untouched.
-- Membership is provisioned by a database administrator, never by a browser/API request.
CREATE TABLE IF NOT EXISTS notes_admins (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS learning_notes (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text CHECK (id ~ '^[a-z0-9-]{1,80}$'),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120 AND title ~ '\S'),
  body TEXT NOT NULL DEFAULT '' CHECK (char_length(body) <= 10000),
  category TEXT NOT NULL DEFAULT 'foundation' CHECK (category IN ('foundation', 'candlestick', 'chart')),
  illustrations JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(illustrations) = 'array'),
  sort_order INTEGER NOT NULL DEFAULT 1000,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only the trusted backend database connection can access either table.
-- No Supabase browser policies, even for an authenticated admin: use the checked API.
ALTER TABLE notes_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON notes_admins, learning_notes FROM PUBLIC;
DO $$
DECLARE browser_role TEXT;
BEGIN
  FOREACH browser_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = browser_role) THEN
      EXECUTE format('REVOKE ALL ON notes_admins, learning_notes FROM %I', browser_role);
    END IF;
  END LOOP;
END $$;
