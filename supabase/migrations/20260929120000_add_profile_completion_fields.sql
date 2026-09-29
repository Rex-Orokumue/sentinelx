-- 20260929120000_add_profile_completion_fields.sql
-- Spec: docs/superpowers/specs/2026-09-29-player-profile-completion-whatsapp-outreach-design.md
ALTER TABLE public.profiles ADD COLUMN consent_whatsapp_updates boolean NOT NULL DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN profile_completed_at timestamptz;

-- Public: middleware's RLS-scoped client needs to read this to drive the
-- onboarding gate, same reasoning as phone_verified_at. Column grants are
-- additive, so this doesn't need to restate the full allow-list from
-- 20260918200000_lock_down_profiles_and_write_paths.sql.
GRANT SELECT (profile_completed_at) ON public.profiles TO anon, authenticated;

-- consent_whatsapp_updates is NOT granted here — private, admin-client-only
-- reads, same as whatsapp_number.

NOTIFY pgrst, 'reload schema';
