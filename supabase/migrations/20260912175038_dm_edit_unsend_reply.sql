-- Edit, unsend, and reply-to for direct messages. Additive only — no
-- existing dm_messages column changes shape or meaning.
--
-- Content is never destroyed. Unsend only flags deleted_at; the participant-
-- facing query layer hides content when it's set, the staff-facing layer
-- (admin-query.ts) ignores it. Editing appends the pre-edit body/image_url to
-- dm_message_edits before overwriting dm_messages, so staff can always see
-- the full history regardless of what participants currently see.

ALTER TABLE public.dm_messages
  ADD COLUMN edited_at   timestamptz,
  ADD COLUMN deleted_at  timestamptz,
  ADD COLUMN reply_to_id uuid REFERENCES public.dm_messages(id) ON DELETE SET NULL;

CREATE INDEX dm_messages_reply_to_idx ON public.dm_messages (reply_to_id) WHERE reply_to_id IS NOT NULL;

-- Staff-only audit trail. No participant-facing SELECT policy — participants
-- only ever see the current (post-edit) body plus an "(edited)" tag, never
-- prior versions.
CREATE TABLE public.dm_message_edits (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id       uuid        NOT NULL REFERENCES public.dm_messages(id) ON DELETE CASCADE,
  body_before      text,
  image_url_before text,
  edited_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dm_message_edits_message_idx ON public.dm_message_edits (message_id, edited_at);

ALTER TABLE public.dm_message_edits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dm_message_edits_staff_read" ON public.dm_message_edits
  FOR SELECT USING (public.is_staff());
-- Writes are service-role only (editMessage action).

-- Sender can edit or unsend their own message, but only within 10 minutes of
-- sending. This is a SECOND permissive UPDATE policy on dm_messages
-- (alongside the existing dm_messages_recipient_mark_read) — Postgres
-- combines multiple permissive policies with OR, and the two never overlap
-- (sender_id = auth.uid() here vs sender_id <> auth.uid() there). RLS gates
-- who/when; the server action alone controls which columns a given UPDATE
-- call sets, same as the existing read-receipt policy.
CREATE POLICY "dm_messages_sender_edit_or_unsend" ON public.dm_messages
  FOR UPDATE USING (
    sender_id = auth.uid() AND created_at > now() - interval '10 minutes'
  )
  WITH CHECK (sender_id = auth.uid());
