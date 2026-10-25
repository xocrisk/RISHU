-- XOCRISK Friends & Groups: group chats disappear 1 hour after they're sent; direct chats keep 24 hours.
-- Run AFTER 002_messages.sql in the SAME Supabase project.
BEGIN;
DROP POLICY messages_read ON public.messages;
-- Read: a direct message's two participants for 24 hours; a group message's current members for 1 hour,
-- even if the purge hasn't run yet.
CREATE POLICY messages_read ON public.messages FOR SELECT TO authenticated USING (
  (thread_type='direct' AND created_at > now() - interval '24 hours' AND (SELECT auth.uid()) IN (from_id, to_id))
  OR (thread_type='group' AND created_at > now() - interval '1 hour' AND public.social_member(group_id))
);

CREATE OR REPLACE FUNCTION public.purge_expired_messages() RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  DELETE FROM public.messages
  WHERE (thread_type='direct' AND created_at <= now() - interval '24 hours')
     OR (thread_type='group' AND created_at <= now() - interval '1 hour');
$$;
REVOKE ALL ON FUNCTION public.purge_expired_messages() FROM PUBLIC, anon, authenticated;
COMMIT;
