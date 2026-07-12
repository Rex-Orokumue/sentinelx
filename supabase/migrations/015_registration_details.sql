-- =============================================================
-- #15/#18 — Registration detail fields + tournament rules
-- =============================================================

ALTER TABLE public.tournament_registrations
  ADD COLUMN reg_display_name text,
  ADD COLUMN reg_whatsapp     text,
  ADD COLUMN reg_club_name    text,
  ADD COLUMN reg_ign_tag      text;

ALTER TABLE public.tournaments
  ADD COLUMN rules text;
