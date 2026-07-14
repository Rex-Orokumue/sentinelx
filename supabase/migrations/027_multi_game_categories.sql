ALTER TABLE public.games DROP CONSTRAINT games_category_check;
ALTER TABLE public.games ADD CONSTRAINT games_category_check
  CHECK (category IN ('football', 'fighting', 'shooter', 'other'));
