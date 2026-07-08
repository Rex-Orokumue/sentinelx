-- Stores the mandatory reason when an admin disputes a match result.
ALTER TABLE public.matches ADD COLUMN admin_note text;
