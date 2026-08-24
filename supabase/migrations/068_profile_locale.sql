-- 068_profile_locale.sql
-- Adds the player's preferred site language. Source of truth for a
-- logged-in player's locale (spec: docs/superpowers/specs/2026-08-23-multi-language-support-design.md §5)
-- — the language switcher writes here, notification-copy builders read
-- from here (follow-on plan), same pattern as the existing
-- notification_prefs jsonb column on this table.
ALTER TABLE public.profiles ADD COLUMN locale text NOT NULL DEFAULT 'en'
  CHECK (locale IN ('en', 'fr', 'pcm'));
