-- Scheduling + HTTP-from-Postgres, used by the fixture-reminder cron.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Notification audit log (also the dedupe guarantee and the exact-text record
-- for Termii template submission). System-only: written by the service-role client.
CREATE TABLE public.notifications (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id          uuid        NOT NULL REFERENCES public.profiles(id),
  type               text        NOT NULL
                       CHECK (type IN ('registration_confirmed', 'fixture_reminder',
                                       'result_confirmed', 'prize_credited')),
  channel            text        NOT NULL DEFAULT 'whatsapp',
  to_number          text,
  template_name      text        NOT NULL,
  body               text        NOT NULL,
  status             text        NOT NULL
                       CHECK (status IN ('sent', 'failed', 'skipped')),
  provider_reference text,
  error              text,
  dedupe_key         text        NOT NULL UNIQUE,
  created_at         timestamptz NOT NULL DEFAULT now(),
  sent_at            timestamptz
);

CREATE INDEX ON public.notifications (player_id, created_at DESC);

-- RLS on with NO policies: no anon/authenticated access; the service-role client
-- (which bypasses RLS) is the only reader/writer. This is a system log.
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
