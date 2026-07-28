-- 035_noshow_resolution_and_substitution.sql
-- No-show match resolution (walkover win, group double-no-show draw, knockout
-- double-forfeit) and admin disqualify/substitute for a chronically-inactive
-- registered player. See docs/superpowers/specs/2026-07-28-noshow-resolution-
-- and-player-substitution-design.md.

ALTER TABLE public.matches DROP CONSTRAINT matches_status_check;
ALTER TABLE public.matches
  ADD CONSTRAINT matches_status_check
  CHECK (status IN ('scheduled', 'live', 'completed', 'disputed', 'cancelled', 'bye', 'forfeited'));

-- Tags a 'completed' match as no-show-driven rather than normally played and
-- reviewed. NULL for every existing/normal row — no backfill needed.
ALTER TABLE public.matches
  ADD COLUMN resolution text CHECK (resolution IN ('walkover', 'no_show_draw'));

-- Independent of payment_status: a player can be paid AND disqualified.
-- replaces_registration_id is the audit trail linking a substitute back to
-- who they replaced.
ALTER TABLE public.tournament_registrations
  ADD COLUMN status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disqualified', 'withdrawn')),
  ADD COLUMN replaces_registration_id uuid REFERENCES public.tournament_registrations(id),
  ADD COLUMN disqualified_at timestamptz,
  ADD COLUMN disqualification_note text;

-- Current list per 024_wallet_system.sql (023 dropped the referral_withdrawal_*
-- and friendly_withdrawal_* values that 022 originally shipped with, in favor
-- of the unified 'wallet_credited' below) — carried forward as-is, plus the
-- new 'player_disqualified' value.
ALTER TABLE public.player_notifications DROP CONSTRAINT player_notifications_type_check;
ALTER TABLE public.player_notifications
  ADD CONSTRAINT player_notifications_type_check
  CHECK (type IN (
    'listing_approved', 'listing_removed',
    'withdrawal_paid', 'withdrawal_rejected',
    'result_confirmed', 'referral_credited',
    'friend_request', 'wallet_credited',
    'player_disqualified'
  ));
