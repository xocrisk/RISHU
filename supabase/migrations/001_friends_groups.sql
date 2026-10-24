-- XOCRISK existing-schema migration. Run AFTER backend/migrations in the SAME Supabase project.
-- Reuse public.users: its legacy PK is not auth.uid(). No duplicate profiles TABLE is created.
BEGIN;
DO $$ BEGIN
  IF to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION 'Apply XOCRISK backend migrations first; existing public.users is required';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='profiles' AND c.relkind <> 'v') THEN
    RAISE EXCEPTION 'Existing profiles table detected; map it explicitly instead of creating another profile store';
  END IF;
END $$;

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS auth_user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS nickname text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS public_id text UNIQUE;
UPDATE public.users SET nickname = coalesce(nickname, nullif(full_name, ''), 'Trader'), public_id = coalesce(public_id, uid);
-- Only verified Auth emails can link an existing account. Never trust client-editable user_metadata IDs.
UPDATE public.users u SET auth_user_id = a.id FROM auth.users a
WHERE u.auth_user_id IS NULL AND lower(u.email) = lower(a.email)
  AND a.email_confirmed_at IS NOT NULL AND u.deletion_requested_at IS NULL;

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.users FROM anon, authenticated;
GRANT SELECT (auth_user_id, nickname, avatar_url, public_id) ON public.users TO authenticated;
GRANT UPDATE (nickname, avatar_url) ON public.users TO authenticated;
CREATE POLICY social_profiles_read ON public.users FOR SELECT TO authenticated
  USING (auth_user_id IS NOT NULL AND deletion_requested_at IS NULL);
CREATE POLICY social_profiles_update ON public.users FOR UPDATE TO authenticated
  USING (auth_user_id = (SELECT auth.uid()) AND deletion_requested_at IS NULL)
  WITH CHECK (auth_user_id = (SELECT auth.uid()) AND deletion_requested_at IS NULL);
CREATE OR REPLACE VIEW public.profiles WITH (security_invoker = true) AS
  SELECT auth_user_id AS id, nickname, avatar_url, public_id FROM public.users WHERE auth_user_id IS NOT NULL;
REVOKE ALL ON public.profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.profiles TO authenticated;
GRANT UPDATE (nickname, avatar_url) ON public.profiles TO authenticated;

CREATE FUNCTION public.ensure_social_profile() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE identity uuid := auth.uid(); verified_email text;
BEGIN
  IF identity IS NULL THEN RAISE EXCEPTION 'Sign in with Supabase Auth' USING ERRCODE='42501'; END IF;
  IF EXISTS (SELECT 1 FROM public.users WHERE auth_user_id=identity AND deletion_requested_at IS NULL) THEN RETURN; END IF;
  SELECT email INTO verified_email FROM auth.users WHERE id=identity AND email_confirmed_at IS NOT NULL;
  IF verified_email IS NULL THEN RAISE EXCEPTION 'Verify your Supabase email first' USING ERRCODE='42501'; END IF;
  UPDATE public.users SET auth_user_id=identity, nickname=coalesce(nickname,nullif(full_name,''),'Trader'), public_id=coalesce(public_id,uid)
    WHERE lower(email)=lower(verified_email) AND auth_user_id IS NULL AND deletion_requested_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Complete XOCRISK sign-in with this same account first' USING ERRCODE='42501'; END IF;
END $$;

CREATE TABLE public.friend_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  to_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (from_id,to_id), CHECK (from_id<>to_id)
);
-- Reverse-direction requests cannot race into two different pending relationships.
CREATE UNIQUE INDEX friend_requests_pair_key ON public.friend_requests (least(from_id,to_id),greatest(from_id,to_id));
CREATE INDEX friend_requests_inbox_idx ON public.friend_requests(to_id,status,created_at DESC);
CREATE TABLE public.friendships (
  user_a uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_b uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_a,user_b), CHECK(user_a<>user_b)
);
CREATE TABLE public.groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 50),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.group_members (
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK(role IN ('owner','member')),
  joined_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(group_id,user_id)
);
CREATE INDEX group_members_user_idx ON public.group_members(user_id,group_id);
CREATE TABLE public.group_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  body text NOT NULL CHECK(length(btrim(body)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX group_notices_group_idx ON public.group_notices(group_id,created_at DESC);

CREATE FUNCTION public.social_member(target_group uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM public.group_members WHERE group_id=target_group AND user_id=auth.uid());
$$;
CREATE FUNCTION public.social_owner(target_group uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM public.groups WHERE id=target_group AND owner_id=auth.uid());
$$;

ALTER TABLE public.friend_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_notices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.friend_requests,public.friendships,public.groups,public.group_members,public.group_notices FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.friend_requests,public.friendships,public.groups,public.group_members,public.group_notices TO authenticated;
GRANT INSERT(from_id,to_id) ON public.friend_requests TO authenticated;
GRANT UPDATE(status) ON public.friend_requests TO authenticated;
GRANT DELETE ON public.friendships TO authenticated;
GRANT INSERT(name,owner_id), UPDATE(name), DELETE ON public.groups TO authenticated;
GRANT INSERT(group_id,user_id,role), DELETE ON public.group_members TO authenticated;
GRANT INSERT(group_id,body), UPDATE(body), DELETE ON public.group_notices TO authenticated;

CREATE POLICY requests_read ON public.friend_requests FOR SELECT TO authenticated USING ((SELECT auth.uid()) IN (from_id,to_id));
CREATE POLICY requests_send ON public.friend_requests FOR INSERT TO authenticated WITH CHECK (from_id=(SELECT auth.uid()) AND status='pending');
CREATE POLICY requests_respond ON public.friend_requests FOR UPDATE TO authenticated USING (to_id=(SELECT auth.uid()) AND status='pending')
  WITH CHECK (to_id=(SELECT auth.uid()) AND status IN ('accepted','rejected'));
CREATE POLICY friends_read ON public.friendships FOR SELECT TO authenticated USING ((SELECT auth.uid()) IN (user_a,user_b));
CREATE POLICY friends_remove ON public.friendships FOR DELETE TO authenticated USING ((SELECT auth.uid()) IN (user_a,user_b));
CREATE POLICY groups_read ON public.groups FOR SELECT TO authenticated USING (public.social_member(id));
CREATE POLICY groups_create ON public.groups FOR INSERT TO authenticated WITH CHECK(owner_id=(SELECT auth.uid()));
CREATE POLICY groups_update ON public.groups FOR UPDATE TO authenticated USING(owner_id=(SELECT auth.uid())) WITH CHECK(owner_id=(SELECT auth.uid()));
CREATE POLICY groups_delete ON public.groups FOR DELETE TO authenticated USING(owner_id=(SELECT auth.uid()));
CREATE POLICY members_read ON public.group_members FOR SELECT TO authenticated USING(public.social_member(group_id));
CREATE POLICY members_add ON public.group_members FOR INSERT TO authenticated WITH CHECK(public.social_owner(group_id) AND role='member' AND user_id<>(SELECT auth.uid()));
CREATE POLICY members_remove ON public.group_members FOR DELETE TO authenticated USING(public.social_owner(group_id) AND role='member');
CREATE POLICY notices_read ON public.group_notices FOR SELECT TO authenticated USING(public.social_member(group_id));
CREATE POLICY notices_create ON public.group_notices FOR INSERT TO authenticated WITH CHECK(public.social_owner(group_id));
CREATE POLICY notices_update ON public.group_notices FOR UPDATE TO authenticated USING(public.social_owner(group_id)) WITH CHECK(public.social_owner(group_id));
CREATE POLICY notices_delete ON public.group_notices FOR DELETE TO authenticated USING(public.social_owner(group_id));

CREATE FUNCTION public.guard_friend_request() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF auth.uid() IS NULL OR NEW.from_id<>auth.uid() OR NEW.status<>'pending' THEN RAISE EXCEPTION 'Invalid sender or status' USING ERRCODE='42501'; END IF;
    IF (SELECT count(*) FROM public.users WHERE auth_user_id IN (NEW.from_id,NEW.to_id) AND deletion_requested_at IS NULL)<>2 THEN
      RAISE EXCEPTION 'User profile not found' USING ERRCODE='23503';
    END IF;
    IF EXISTS(SELECT 1 FROM public.friendships WHERE user_a=NEW.from_id AND user_b=NEW.to_id) THEN RAISE EXCEPTION 'Already friends' USING ERRCODE='23505'; END IF;
  ELSE
    IF auth.uid() IS NULL OR OLD.to_id<>auth.uid() OR OLD.status<>'pending'
      OR NEW.status NOT IN ('accepted','rejected') OR NEW.from_id<>OLD.from_id OR NEW.to_id<>OLD.to_id
      OR NEW.id<>OLD.id OR NEW.created_at<>OLD.created_at THEN RAISE EXCEPTION 'Only the recipient may respond to a pending request' USING ERRCODE='42501'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER friend_request_guard BEFORE INSERT OR UPDATE ON public.friend_requests FOR EACH ROW EXECUTE FUNCTION public.guard_friend_request();
CREATE FUNCTION public.friend_request_accepted() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.status='accepted' AND OLD.status='pending' THEN
    INSERT INTO public.friendships(user_a,user_b) VALUES(NEW.from_id,NEW.to_id),(NEW.to_id,NEW.from_id) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER friend_request_accept AFTER UPDATE ON public.friend_requests FOR EACH ROW EXECUTE FUNCTION public.friend_request_accepted();
CREATE FUNCTION public.accept_friend_request(request_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item public.friend_requests;
BEGIN
  SELECT * INTO item FROM public.friend_requests WHERE id=request_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR item.to_id<>auth.uid() THEN RAISE EXCEPTION 'Request unavailable' USING ERRCODE='42501'; END IF;
  IF item.status='accepted' THEN RETURN; END IF;
  IF item.status<>'pending' THEN RAISE EXCEPTION 'Request is no longer pending'; END IF;
  UPDATE public.friend_requests SET status='accepted' WHERE id=request_id;
END $$;
CREATE FUNCTION public.remove_friendship_pair() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  DELETE FROM public.friendships WHERE user_a=OLD.user_b AND user_b=OLD.user_a;
  -- Permit a future new request after removal; replaying an old acceptance cannot restore friendship.
  DELETE FROM public.friend_requests WHERE (from_id=OLD.user_a AND to_id=OLD.user_b) OR (from_id=OLD.user_b AND to_id=OLD.user_a);
  RETURN OLD;
END $$;
CREATE TRIGGER friendship_pair_delete AFTER DELETE ON public.friendships FOR EACH ROW EXECUTE FUNCTION public.remove_friendship_pair();

CREATE FUNCTION public.add_group_owner() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  INSERT INTO public.group_members(group_id,user_id,role) VALUES(NEW.id,NEW.owner_id,'owner');
  RETURN NEW;
END $$;
CREATE TRIGGER group_owner_create AFTER INSERT ON public.groups FOR EACH ROW EXECUTE FUNCTION public.add_group_owner();
CREATE FUNCTION public.guard_group_member() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE owner uuid;
BEGIN
  SELECT owner_id INTO owner FROM public.groups WHERE id=NEW.group_id;
  IF NEW.role='owner' THEN
    IF NEW.user_id<>owner THEN RAISE EXCEPTION 'Invalid group owner' USING ERRCODE='42501'; END IF;
  ELSIF NOT EXISTS(SELECT 1 FROM public.friendships WHERE user_a=owner AND user_b=NEW.user_id) THEN
    RAISE EXCEPTION 'Only current friends can be added to a group' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER group_member_guard BEFORE INSERT ON public.group_members FOR EACH ROW EXECUTE FUNCTION public.guard_group_member();
CREATE FUNCTION public.create_group(name text, member_ids uuid[]) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE creator uuid := auth.uid(); group_id uuid; members uuid[];
BEGIN
  IF creator IS NULL THEN RAISE EXCEPTION 'Sign in first' USING ERRCODE='42501'; END IF;
  PERFORM public.ensure_social_profile();
  IF name IS NULL OR length(btrim(name)) NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Enter a group name of 1-50 characters'; END IF;
  SELECT array_agg(DISTINCT value) INTO members FROM unnest(member_ids) value WHERE value IS NOT NULL AND value<>creator;
  IF coalesce(cardinality(members),0) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Select 1-100 friends'; END IF;
  IF EXISTS(SELECT 1 FROM unnest(members) value WHERE NOT EXISTS(SELECT 1 FROM public.friendships WHERE user_a=creator AND user_b=value)) THEN
    RAISE EXCEPTION 'Only current friends can be added' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.groups(name,owner_id) VALUES(btrim(name),creator) RETURNING id INTO group_id;
  INSERT INTO public.group_members(group_id,user_id,role) SELECT group_id,value,'member' FROM unnest(members) value;
  RETURN group_id;
END $$;

-- Definer helpers have fixed search paths; no anonymous/public execute privileges.
REVOKE ALL ON FUNCTION public.ensure_social_profile(), public.social_member(uuid), public.social_owner(uuid),
  public.guard_friend_request(), public.friend_request_accepted(), public.accept_friend_request(uuid),
  public.remove_friendship_pair(), public.add_group_owner(), public.guard_group_member(), public.create_group(text,uuid[])
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_social_profile(), public.social_member(uuid), public.social_owner(uuid),
  public.accept_friend_request(uuid), public.create_group(text,uuid[]) TO authenticated;

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.friend_requests;
    ALTER PUBLICATION supabase_realtime ADD TABLE public.friendships;
    ALTER PUBLICATION supabase_realtime ADD TABLE public.group_members;
    ALTER PUBLICATION supabase_realtime ADD TABLE public.group_notices;
  END IF;
END $$;
COMMIT;
