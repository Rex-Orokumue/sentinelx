-- Root-cause fix: matches.group_id had no ON DELETE CASCADE, so deleting a
-- group while matches still referenced it failed with a matches_group_id_fkey
-- violation. lib/tournaments/bracket-admin-actions.ts now deletes matches
-- before groups at the application layer (so this isn't load-bearing for that
-- path anymore), but the constraint should still reflect the real ownership:
-- a match belongs to its group and has no meaning once the group is gone,
-- exactly like group_memberships.group_id already cascades.
ALTER TABLE public.matches
  DROP CONSTRAINT matches_group_id_fkey,
  ADD CONSTRAINT matches_group_id_fkey
    FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE CASCADE;
