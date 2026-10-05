-- 20261005150000_chat_5c.sql — mobile 5c web schema. The chat_messages_self_delete policy is NOT dropped here.

-- 1. Turn dedupe for interrupted-turn retries.
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS client_turn_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS chat_messages_turn_role_uniq
  ON public.chat_messages (player_id, client_turn_id, role) WHERE client_turn_id IS NOT NULL;

-- 2. Daily usage ledger (UTC day). Service role only.
CREATE TABLE IF NOT EXISTS public.chat_usage_daily (
  day        date    NOT NULL,
  scope      text    NOT NULL CHECK (scope IN ('signed_in', 'signed_out', 'total')),
  turns      integer NOT NULL DEFAULT 0,
  alerted_at timestamptz,
  PRIMARY KEY (day, scope)
);
ALTER TABLE public.chat_usage_daily ENABLE ROW LEVEL SECURITY;

-- 3. Race-free rate limit: counts two windows under an advisory lock and inserts once only if allowed.
CREATE OR REPLACE FUNCTION public.chat_rate_limit_hit(
  p_subject text, p_limit_short int, p_window_short int, p_limit_long int, p_window_long int)
RETURNS TABLE (allowed boolean, retry_after_seconds int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_short int; v_oldest_short timestamptz; v_long int; v_oldest_long timestamptz; v_retry int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('chat_rl:' || p_subject));
  SELECT count(*), min(created_at) INTO v_short, v_oldest_short
    FROM chat_rate_limit_events WHERE subject_key = p_subject AND created_at > now() - make_interval(secs => p_window_short);
  SELECT count(*), min(created_at) INTO v_long, v_oldest_long
    FROM chat_rate_limit_events WHERE subject_key = p_subject AND created_at > now() - make_interval(secs => p_window_long);
  IF v_short >= p_limit_short OR v_long >= p_limit_long THEN
    v_retry := greatest(
      CASE WHEN v_short >= p_limit_short THEN ceil(extract(epoch FROM (v_oldest_short + make_interval(secs => p_window_short) - now())))::int ELSE 0 END,
      CASE WHEN v_long  >= p_limit_long  THEN ceil(extract(epoch FROM (v_oldest_long  + make_interval(secs => p_window_long)  - now())))::int ELSE 0 END,
      1);
    RETURN QUERY SELECT false, v_retry;
    RETURN;
  END IF;
  INSERT INTO chat_rate_limit_events (subject_key) VALUES (p_subject);
  RETURN QUERY SELECT true, 0;
END $$;

-- 4. Daily budget with a once-per-day alert at p_alert_pct.
CREATE OR REPLACE FUNCTION public.chat_budget_hit(p_scope text, p_ceiling int, p_alert_pct int)
RETURNS TABLE (allowed boolean, crossed_alert boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_day date := (now() AT TIME ZONE 'utc')::date;
  v_row chat_usage_daily;
BEGIN
  INSERT INTO chat_usage_daily (day, scope, turns) VALUES (v_day, p_scope, 0) ON CONFLICT DO NOTHING;
  SELECT * INTO v_row FROM chat_usage_daily WHERE day = v_day AND scope = p_scope FOR UPDATE;
  IF v_row.turns >= p_ceiling THEN
    RETURN QUERY SELECT false, false;
    RETURN;
  END IF;
  UPDATE chat_usage_daily SET turns = turns + 1 WHERE day = v_day AND scope = p_scope RETURNING * INTO v_row;
  IF v_row.alerted_at IS NULL AND v_row.turns * 100 >= p_ceiling * p_alert_pct THEN
    UPDATE chat_usage_daily SET alerted_at = now() WHERE day = v_day AND scope = p_scope;
    RETURN QUERY SELECT true, true;
    RETURN;
  END IF;
  RETURN QUERY SELECT true, false;
END $$;

REVOKE ALL ON FUNCTION public.chat_rate_limit_hit(text, int, int, int, int) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.chat_budget_hit(text, int, int) FROM public, anon, authenticated;

-- 5. Retention: the daily rate window needs 24h of events, so keep two days; messages 30 days; usage 40 days.
--    (cron.schedule upserts by name: this replaces the 1-day prune from 070_chat_system.sql.)
SELECT cron.schedule('prune-chat-rate-limit-events', '0 3 * * *',
  $$ DELETE FROM public.chat_rate_limit_events WHERE created_at < now() - interval '2 days' $$);
SELECT cron.schedule('prune-chat-messages', '15 3 * * *',
  $$ DELETE FROM public.chat_messages WHERE created_at < now() - interval '30 days' $$);
SELECT cron.schedule('prune-chat-usage-daily', '30 3 * * *',
  $$ DELETE FROM public.chat_usage_daily WHERE day < (now() AT TIME ZONE 'utc')::date - 40 $$);

-- 6. Badge claim lease: rewards_granted_at is NULL while a claim is incomplete. DEFAULT now() keeps the
--    existing unlock() pipeline (which never sets it) correct; the guide service inserts NULL explicitly.
ALTER TABLE public.player_achievements
  ADD COLUMN IF NOT EXISTS rewards_granted_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS reward_lease_until timestamptz;
UPDATE public.player_achievements SET rewards_granted_at = unlocked_at WHERE rewards_granted_at IS NOT NULL;
