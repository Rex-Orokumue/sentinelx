-- 025_tournament_data_support.sql — #29 sponsored data support perk.
ALTER TABLE public.tournaments
  ADD COLUMN data_support_text     text,
  ADD COLUMN data_support_whatsapp text;
