-- =============================================================
-- Phone verification via WhatsApp (Meta Cloud API)
-- =============================================================

ALTER TABLE public.profiles ADD COLUMN phone_verified_at timestamptz;
-- profiles.phone already exists (text, unused by app code until now) —
-- repurposed here to hold the verified, normalized number.

-- Grandfather every account that predates this feature: an active
-- community tournament is running right now, and forcing existing players
-- through a verification wall on their next login — before they can see
-- fixtures or submit a result — for a requirement that didn't exist when
-- they signed up would be a real mid-tournament disruption. Only signups
-- created AFTER this migration runs have a null phone_verified_at and are
-- routed through the onboarding gate; existing players verify voluntarily
-- from their dashboard profile form instead.
UPDATE public.profiles SET phone_verified_at = now() WHERE phone_verified_at IS NULL;

-- One in-flight verification code per user — ephemeral, not permanent
-- profile data. A new request replaces (upserts) any prior pending row.
CREATE TABLE public.phone_verifications (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE UNIQUE,
  phone       text        NOT NULL,
  code_hash   text        NOT NULL,
  attempts    integer     NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.phone_verifications ENABLE ROW LEVEL SECURITY;

-- Read-only for the owning user — deliberately no client INSERT/UPDATE/DELETE
-- policy. Writes go exclusively through the service-role admin client inside
-- requestPhoneCode/confirmPhoneCode (lib/phone/actions.ts, Task 3), so a user
-- cannot reset their own `attempts` counter to dodge the lockout.
CREATE POLICY "phone_verifications_own_read" ON public.phone_verifications
  FOR SELECT USING (user_id = auth.uid());
