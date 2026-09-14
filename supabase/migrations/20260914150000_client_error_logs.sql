-- Site-wide client-side error logging. Next.js's default "Application
-- error: a client-side exception has occurred" fallback previously left
-- crashes completely invisible — no error.tsx, no logging, nothing
-- server-side. app/[locale]/error.tsx and app/global-error.tsx now report
-- here, so staff can see what broke without needing the reporter's own
-- device/console — most players are on phones with no devtools access.
--
-- No client-facing INSERT/UPDATE/DELETE policy exists on purpose: writes go
-- through lib/errors/actions.ts using the service-role client, so this
-- table is never a write target directly reachable through PostgREST by
-- anyone holding the anon key.

CREATE TABLE public.client_error_logs (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  message    text        NOT NULL,
  stack      text,
  digest     text,
  url        text,
  user_agent text,
  locale     text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON public.client_error_logs (created_at DESC);

ALTER TABLE public.client_error_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client_error_logs_select" ON public.client_error_logs FOR SELECT USING (public.is_staff());
