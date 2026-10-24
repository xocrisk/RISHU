-- Remove the retired shared account, including its dependent sessions and data.
DELETE FROM users
WHERE id = 'd3a00000-0000-4000-8000-000000000001'::uuid
  AND email = 'demo@xocrisk.local';

-- Restore the original consent requirement on databases that ran migration 016.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_adult_consent_required;
ALTER TABLE users ALTER COLUMN adult_consent_at SET NOT NULL;
