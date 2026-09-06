-- Account deletion: anonymise-in-place with a 15-day grace period.
-- See docs/superpowers/specs/2026-09-06-account-deletion-design.md

-- The profile must outlive its auth user. This cascade is the reason the old
-- hard-delete failed for 82 of 102 users: deleting the auth user destroyed the
-- profile row that 34 NO ACTION foreign keys still referenced, so the whole
-- transaction aborted. Dropping it means the auth user can be deleted at
-- execution while the anonymised tombstone stays put — and every one of those
-- 57 foreign keys stays valid exactly as it is.
--
-- profiles.id remains a plain uuid primary key, and handle_new_user() keeps
-- populating it with the auth user's id on signup.
ALTER TABLE public.profiles DROP CONSTRAINT profiles_id_fkey;

-- Two distinct states, not one field reused: requested-and-not-deleted means
-- in grace; deleted_at set means tombstone. Cancelling clears the request.
ALTER TABLE public.profiles
  ADD COLUMN deletion_requested_at timestamptz,
  ADD COLUMN deleted_at            timestamptz;

CREATE INDEX profiles_deletion_pending_idx ON public.profiles (deletion_requested_at)
  WHERE deletion_requested_at IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX profiles_deleted_at_idx ON public.profiles (deleted_at)
  WHERE deleted_at IS NOT NULL;

-- Holds ONLY the string: no user id, no foreign key. Once the profile is
-- anonymised this is no longer personal data, which is what lets us block
-- reuse permanently and still honour erasure. A username is retired at
-- execution, not at request, so a cancelled deletion leaves it untouched.
CREATE TABLE public.retired_usernames (
  username    text PRIMARY KEY,
  retired_at  timestamptz NOT NULL DEFAULT now()
);

-- Ban evasion. Peppered one-way hashes, written only for accounts carrying an
-- admin_flags row with severity 'cheat'. Retaining admin_flags on a tombstone
-- does not by itself stop evasion, because a new account built from the same
-- email has no link to that tombstone.
CREATE TABLE public.banned_identifiers (
  hash        text PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN ('email','phone')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Both admin recovery actions reverse a permanent decision, so they are
-- logged. There is no general admin audit trail in this codebase —
-- admin_flags records player conduct, not staff actions. `target` stores the
-- hash for a cleared identifier, never the plaintext.
CREATE TABLE public.admin_recovery_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    uuid NOT NULL REFERENCES public.profiles(id),
  action      text NOT NULL CHECK (action IN ('release_username','clear_identifier')),
  target      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- No client access to any of these. Every read and write goes through the
-- service-role client server-side, matching how username collisions are
-- already handled. RLS on with no policy = deny all for anon/authenticated.
ALTER TABLE public.retired_usernames  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.banned_identifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_recovery_log ENABLE ROW LEVEL SECURITY;
