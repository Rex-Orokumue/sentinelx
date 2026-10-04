-- pg_net abandons a request after 5000 ms by default. The cron routes that run
-- on Vercel (cold start + real work) were landing at 4.3-4.9 s, and 5 calls in
-- one 26 h window timed out client-side (fixture-reminders, resolve-noshow-matches,
-- refund-abandoned-coin-discounts). The server usually still finishes, but a slow
-- cold start would turn that into a missed run with nothing surfacing it.
--
-- Adds `timeout_milliseconds := 30000` to every cron job that calls
-- net.http_post and does not already set one. Matches by pattern so no job text
-- (and no CRON_SECRET) is repeated here; idempotent; a no-op where pg_cron is
-- not installed.
DO $$
DECLARE
  j record;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RETURN;
  END IF;

  FOR j IN
    SELECT jobid, command
    FROM cron.job
    WHERE command ILIKE '%net.http_post(%'
      AND command NOT ILIKE '%timeout_milliseconds%'
  LOOP
    PERFORM cron.alter_job(
      j.jobid,
      command := regexp_replace(
        j.command,
        '\)(\s*)\);(\s*)$',
        E'),\n      timeout_milliseconds := 30000\\1);\\2'
      )
    );
  END LOOP;
END $$;
