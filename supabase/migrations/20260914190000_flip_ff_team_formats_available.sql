-- Phase 7 of the team-vs-team matches spec (docs/superpowers/specs/2026-09-13-team-vs-team-matches-design.md
-- §11 item 7): flips the three Free Fire team formats from available=false to
-- true now that admins can manage a team tournament's bracket by hand
-- (movePlayerToGroup, createKnockoutRound, swapKnockoutPairing — this plan's
-- Tasks 1-3). A data change, not code, per the existing "availability is
-- data" principle — game_mode_formats rows for every other squad format
-- (Battle Royale Duo/Squad) stay unavailable; this only touches the three
-- formats the spec named.
update public.game_mode_formats f
set available = true
from public.game_modes m, public.games g
where f.mode_id = m.id
  and m.game_id = g.id
  and g.name = 'Free Fire'
  and (
    (m.name = 'Clash Squad' and f.slug in ('2v2', '4v4'))
    or (m.name = 'Lone Wolf' and f.slug = '2v2')
  );
