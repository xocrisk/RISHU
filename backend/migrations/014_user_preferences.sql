-- Settings that follow the person across the app and the website: privacy mode and watchlist stars.
-- (The app lock stays on each device.)
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferences jsonb NOT NULL DEFAULT '{}'::jsonb;
