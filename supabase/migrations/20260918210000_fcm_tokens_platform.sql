-- Mobile registers native FCM tokens into the same table as web. Defaults keep every
-- existing web row and the existing /api/notifications/fcm-token route valid unchanged.
ALTER TABLE public.fcm_tokens
  ADD COLUMN IF NOT EXISTS platform    text NOT NULL DEFAULT 'web'
    CHECK (platform IN ('web', 'android', 'ios')),
  ADD COLUMN IF NOT EXISTS app_version text;
