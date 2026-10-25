-- XOCRISK Friends & Groups: a working create_group(name, member_ids) RPC on every project, including ones set up
-- before 001_friends_groups.sql (their create_group differs and they have no owner-membership trigger).
-- Run AFTER 001/002 in the SAME Supabase project. Safe to rerun.
BEGIN;
DROP FUNCTION IF EXISTS public.create_group(text, uuid[]);
CREATE FUNCTION public.create_group(name text, member_ids uuid[]) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE creator uuid := auth.uid(); new_group uuid; members uuid[];
BEGIN
  IF creator IS NULL THEN RAISE EXCEPTION 'Sign in first' USING ERRCODE='42501'; END IF;
  PERFORM public.ensure_social_profile();
  IF name IS NULL OR length(btrim(name)) NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Enter a group name of 1-50 characters'; END IF;
  SELECT array_agg(DISTINCT value) INTO members FROM unnest(member_ids) value WHERE value IS NOT NULL AND value<>creator;
  IF coalesce(cardinality(members),0) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Select 1-100 friends'; END IF;
  IF EXISTS(SELECT 1 FROM unnest(members) value WHERE NOT EXISTS(SELECT 1 FROM public.friendships WHERE user_a=creator AND user_b=value)) THEN
    RAISE EXCEPTION 'Only current friends can be added' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.groups(name,owner_id) VALUES(btrim(name),creator) RETURNING id INTO new_group;
  -- 001's add_group_owner trigger may already have added the owner.
  INSERT INTO public.group_members(group_id,user_id,role)
    SELECT new_group,creator,'owner' WHERE NOT EXISTS(SELECT 1 FROM public.group_members WHERE group_id=new_group AND user_id=creator);
  INSERT INTO public.group_members(group_id,user_id,role) SELECT new_group,value,'member' FROM unnest(members) value;
  RETURN new_group;
END $$;
REVOKE ALL ON FUNCTION public.create_group(text,uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_group(text,uuid[]) TO authenticated;
COMMIT;
