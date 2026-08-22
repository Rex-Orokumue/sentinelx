-- 070_chat_system.sql — Support Chatbot (real conversational AI, distinct
-- from the Guide System's scripted onboarding tour). See
-- docs/superpowers/specs/2026-08-22-support-chatbot-design.md §4.

-- Persists conversation history for logged-in players only — anonymous
-- chats are ephemeral by product decision, nothing stored for them here.
-- Only ever read to repopulate the ChatTab on reopen (lib/chat/actions.ts);
-- never read mid-request by the chat route itself (the client resends its
-- own running history each turn).
CREATE TABLE public.chat_messages (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id  uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role       text        NOT NULL CHECK (role IN ('user', 'assistant')),
  content    text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chat_messages_player_id_created_at_idx ON public.chat_messages (player_id, created_at);
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- Self-select only, defense in depth — all writes are service-role (the
-- route handler), same pattern as player_kyc/marketplace_orders.
CREATE POLICY "chat_messages_self_select" ON public.chat_messages
  FOR SELECT USING (auth.uid() = player_id);
-- Self-delete backs the "Clear chat" button — a direct client-side Supabase
-- call is fine here, same precedent as marking notifications read.
CREATE POLICY "chat_messages_self_delete" ON public.chat_messages
  FOR DELETE USING (auth.uid() = player_id);

-- Cost-control ledger, decoupled from chat_messages so it works identically
-- for anonymous (subject_key = 'anon:<cookie-uuid>') and logged-in
-- (subject_key = 'player:<uuid>') traffic. One row per user message sent,
-- counted as a trailing-window check BEFORE calling Groq at all.
CREATE TABLE public.chat_rate_limit_events (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_key text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chat_rate_limit_events_subject_created_idx ON public.chat_rate_limit_events (subject_key, created_at);
ALTER TABLE public.chat_rate_limit_events ENABLE ROW LEVEL SECURITY;
-- Zero client policies — service-role only, same pattern as the outbound
-- WhatsApp `notifications` log table.

-- Prune old rate-limit events daily — same pattern as the existing
-- fixture-reminders/expire-full-day-matches pg_cron jobs.
SELECT cron.schedule(
  'prune-chat-rate-limit-events',
  '0 3 * * *',
  $$ DELETE FROM public.chat_rate_limit_events WHERE created_at < now() - interval '1 day' $$
);
