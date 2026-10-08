-- Sliding-window ledger for per-user limits on account actions that cost money
-- (WhatsApp OTP sends) or are password-guess oracles (email change, unlink).
-- Service-role only, same pattern as chat_rate_limit_events. Rows hold only a
-- subject key and a timestamp and are pruned after 2 days (the longest window
-- is 24 h); anonymise_account is deliberately not changed for them.
CREATE TABLE public.account_rate_limit_events (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_key text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX account_rate_limit_events_subject_created_idx
  ON public.account_rate_limit_events (subject_key, created_at);
ALTER TABLE public.account_rate_limit_events ENABLE ROW LEVEL SECURITY;

SELECT cron.schedule(
  'prune-account-rate-limit-events',
  '10 3 * * *',
  $$ DELETE FROM public.account_rate_limit_events WHERE created_at < now() - interval '2 days' $$
);
