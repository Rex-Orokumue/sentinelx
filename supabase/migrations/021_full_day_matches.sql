ALTER TABLE public.matches
  ADD COLUMN is_full_day  boolean NOT NULL DEFAULT false,
  ADD COLUMN auto_expired boolean NOT NULL DEFAULT false;

-- Runs periodically (activated separately, see the plan's final task) to
-- cancel full-day matches whose day has passed with no result. scheduled_at
-- stores midnight WAT for a full-day match; adding 1 day to a UTC instant
-- that represents midnight WAT lands exactly on the following midnight WAT
-- (Nigeria has no DST, so this interval arithmetic is safe without an
-- explicit AT TIME ZONE conversion) — i.e. this fires the moment that
-- calendar day, WAT, ends.
CREATE FUNCTION public.expire_full_day_matches() RETURNS void
LANGUAGE sql
AS $$
  UPDATE public.matches
  SET status = 'cancelled', auto_expired = true
  WHERE is_full_day = true
    AND status = 'scheduled'
    AND scheduled_at + interval '1 day' <= now();
$$;
