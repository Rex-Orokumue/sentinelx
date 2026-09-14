-- Follows — Piece 3 of 4 of the community rebuild (see
-- docs/superpowers/specs/2026-09-07-follows-design.md). An asymmetric graph:
-- follower_id follows following_id, no approval needed. Deliberately separate
-- from friends (023_friends_and_friendly_matches), which is symmetric and
-- consent-based for arranging a friendly match — overloading it here would
-- break that flow.
--
-- No follower_count/following_count column anywhere: a denormalised counter
-- drifts the moment anything writes outside the one path that maintains it
-- (see the Phase 2 SX Score drift incident, ~10 days of wrong player stats).
-- Counting rows is fast at this scale — see lib/follows/query.ts.

CREATE TABLE public.player_follows (
  follower_id  uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  following_id uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, following_id),
  CONSTRAINT player_follows_not_self CHECK (follower_id <> following_id)
);

-- (follower_id, following_id) is already indexed by the PK; following_id
-- alone needs its own index for "who follows me" / follower counts.
CREATE INDEX player_follows_following_idx ON public.player_follows (following_id);

ALTER TABLE public.player_follows ENABLE ROW LEVEL SECURITY;

-- The graph is public — follower/following counts show on any profile, as on
-- any social product.
CREATE POLICY "player_follows_public_read" ON public.player_follows
  FOR SELECT USING (true);

-- You may only create a follow as yourself, and not against someone who has
-- blocked you or whom you have blocked (dm_blocks, either direction) — the
-- same rule dm_can_message enforces for messaging. Direct messages shipped
-- first, so this is added now rather than left as a follow-up.
CREATE POLICY "player_follows_own_insert" ON public.player_follows
  FOR INSERT WITH CHECK (
    follower_id = auth.uid()
    AND NOT EXISTS (
      SELECT 1 FROM public.dm_blocks b
      WHERE (b.blocker_id = follower_id AND b.blocked_id = following_id)
         OR (b.blocker_id = following_id AND b.blocked_id = follower_id)
    )
  );

-- No UPDATE policy — a follow either exists or does not.
CREATE POLICY "player_follows_own_delete" ON public.player_follows
  FOR DELETE USING (follower_id = auth.uid());
