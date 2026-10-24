-- XOCRISK Friends & Groups messaging. Run AFTER 001_friends_groups.sql in the SAME Supabase project.
-- Adds direct (friend-to-friend) and group chat messages, guarded entirely by RLS, with Realtime delivery.
-- Messages are ephemeral: unreadable 24 hours after they're sent, and deleted from the database soon after.
BEGIN;
DO $$ BEGIN
  IF to_regclass('public.friendships') IS NULL OR to_regclass('public.groups') IS NULL THEN
    RAISE EXCEPTION 'Apply 001_friends_groups.sql first; Friends & Groups tables are required';
  END IF;
END $$;

CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_type text NOT NULL CHECK (thread_type IN ('direct','group')),
  -- Group chat: group_id set, to_id null. Direct chat: to_id set (the friend), group_id null.
  group_id uuid REFERENCES public.groups(id) ON DELETE CASCADE,
  from_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  to_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 1000),
  -- Not client-writable (see the INSERT grant), so nobody can stretch a message's 24-hour life.
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((thread_type='direct' AND to_id IS NOT NULL AND group_id IS NULL AND from_id<>to_id)
      OR (thread_type='group'  AND group_id IS NOT NULL AND to_id IS NULL))
);
-- A direct conversation is the unordered {from,to} pair, so both directions share one index.
CREATE INDEX messages_direct_idx ON public.messages (least(from_id,to_id), greatest(from_id,to_id), created_at)
  WHERE thread_type='direct';
CREATE INDEX messages_group_idx ON public.messages (group_id, created_at) WHERE thread_type='group';
CREATE INDEX messages_created_idx ON public.messages (created_at);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.messages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.messages TO authenticated;
GRANT INSERT (thread_type, group_id, from_id, to_id, body) ON public.messages TO authenticated;

-- Read: a direct message's two participants; a group message's current members; never after 24 hours,
-- even if the purge below hasn't run yet.
CREATE POLICY messages_read ON public.messages FOR SELECT TO authenticated USING (
  created_at > now() - interval '24 hours' AND (
    (thread_type='direct' AND (SELECT auth.uid()) IN (from_id, to_id))
    OR (thread_type='group' AND public.social_member(group_id))
  )
);
-- Send: only as yourself, only to a current friend (direct) or a group you belong to (group).
CREATE POLICY messages_send ON public.messages FOR INSERT TO authenticated WITH CHECK (
  from_id=(SELECT auth.uid()) AND (
    (thread_type='direct' AND to_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.friendships WHERE user_a=(SELECT auth.uid()) AND user_b=to_id))
    OR (thread_type='group' AND public.social_member(group_id))
  )
);

CREATE FUNCTION public.purge_expired_messages() RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  DELETE FROM public.messages WHERE created_at <= now() - interval '24 hours';
$$;
REVOKE ALL ON FUNCTION public.purge_expired_messages() FROM PUBLIC, anon, authenticated;
-- Backstop for projects without pg_cron: every send also clears anything already expired.
CREATE FUNCTION public.purge_expired_messages_on_send() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN PERFORM public.purge_expired_messages(); RETURN NULL; END $$;
REVOKE ALL ON FUNCTION public.purge_expired_messages_on_send() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER messages_purge_on_send AFTER INSERT ON public.messages FOR EACH STATEMENT EXECUTE FUNCTION public.purge_expired_messages_on_send();

-- Deletes expired messages every 10 minutes, whether or not anyone is chatting.
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.schedule('purge-expired-messages', '*/10 * * * *', 'SELECT public.purge_expired_messages()');
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'pg_cron unavailable (%); expired messages are hidden at 24 hours and deleted on the next send. Enable pg_cron in Supabase and rerun the schedule.', SQLERRM;
END $$;

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;
END $$;
COMMIT;
