-- Stickers, voice notes, and forwarding for direct messages. Additive only —
-- no existing dm_messages column changes shape or meaning.
--
-- Stickers are a small built-in catalog (lib/messages/stickers.ts), validated
-- app-side against a whitelist — no DB table, same trust model as body/
-- image_url (the RLS insert policy doesn't care which content column is
-- set, only that at least one is — see the widened dm_messages_has_content
-- check below).
--
-- Voice notes reuse the private-bucket + storage-path + server-signed-URL
-- pattern dm-images already established. audio_duration_seconds is stored
-- alongside the path so the player list and the bubble can render a
-- duration without round-tripping to storage.
--
-- Forwarding copies a message's content into a new row in a different
-- thread — `forwarded` just flags that copy for the "Forwarded" UI tag.
-- No reference back to the original message/thread/sender is stored,
-- matching WhatsApp's no-attribution behaviour and avoiding a cross-thread
-- read path that could leak one conversation's content into another's RLS
-- surface.

ALTER TABLE public.dm_messages
  ADD COLUMN sticker_id             text,
  ADD COLUMN audio_url              text,   -- storage path in the dm-audio bucket, not a URL
  ADD COLUMN audio_duration_seconds integer,
  ADD COLUMN forwarded              boolean NOT NULL DEFAULT false;

ALTER TABLE public.dm_messages DROP CONSTRAINT dm_messages_has_content;
ALTER TABLE public.dm_messages ADD CONSTRAINT dm_messages_has_content
  CHECK (
    (body IS NOT NULL AND btrim(body) <> '')
    OR image_url IS NOT NULL
    OR sticker_id IS NOT NULL
    OR audio_url IS NOT NULL
  );

ALTER TABLE public.dm_messages
  ADD CONSTRAINT dm_messages_audio_duration_positive
  CHECK (audio_duration_seconds IS NULL OR audio_duration_seconds > 0);

-- ---------------------------------------------------------------
-- Private audio bucket — mirrors dm-images
-- ---------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('dm-audio', 'dm-audio', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "dm_audio_insert_own"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'dm-audio'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Owner or staff (reads normally go through server-side signed URLs).
CREATE POLICY "dm_audio_select_own_or_staff"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'dm-audio'
    AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_staff())
  );
