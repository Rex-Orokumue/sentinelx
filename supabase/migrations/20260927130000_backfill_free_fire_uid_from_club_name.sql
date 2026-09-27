-- Free Fire's old reg_club_name never held a real in-game UID — that's
-- exactly the bug the per-game registration-fields catalogue fixes (a
-- Free Fire player was previously asked for a "club name," which doesn't
-- exist in that game). The prior migration
-- (20260927120000_game_registration_fields.sql) backfilled reg_club_name
-- into registration_details.club_name uniformly for every game, but Free
-- Fire's catalogue only declares an in_game_uid field, so that value sat
-- under a key nothing displays.
--
-- Per an explicit product decision, surface it under in_game_uid anyway
-- rather than leaving it blank, with the caveat that it's carried over from
-- a field that was never actually validated as a real Free Fire UID — staff
-- may need to follow up with affected players to correct it. Nothing is
-- deleted: club_name stays alongside it, unreferenced by Free Fire's
-- catalogue but preserved. Idempotent (skips any row that already has
-- in_game_uid, so re-running never overwrites a real submission made
-- through the new form).
UPDATE public.tournament_registrations tr
SET registration_details = tr.registration_details
    || jsonb_build_object('in_game_uid', tr.registration_details->>'club_name')
FROM public.tournaments t
JOIN public.games g ON g.id = t.game_id
WHERE tr.tournament_id = t.id
  AND g.slug = 'free-fire'
  AND tr.registration_details ? 'club_name'
  AND NOT tr.registration_details ? 'in_game_uid';
