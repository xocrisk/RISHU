-- Account explicitly designated by the project owner for learning-notes administration.
-- Resolve the public UID to the existing account; never create an account or infer an admin.
DO $$
DECLARE target_user UUID;
BEGIN
  SELECT id INTO target_user FROM users
  WHERE uid = 'QVT4QQDG' AND deletion_requested_at IS NULL;
  IF target_user IS NULL THEN
    RAISE EXCEPTION 'Active account QVT4QQDG was not found; no Notes admin was assigned.';
  END IF;
  INSERT INTO notes_admins (user_id) VALUES (target_user) ON CONFLICT DO NOTHING;
END $$;
