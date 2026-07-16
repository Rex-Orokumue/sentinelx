# Tournament Fee Waivers — Design Spec

**Date:** 2026-07-16
**Status:** Approved by user, ready for implementation plan

## Problem

Sentinel X wants to let staff comp specific players into a tournament for free — e.g. as an award for a past achievement, a sponsorship, or any other reason at admin's discretion. There is currently no way to register without paying the tournament's `registration_fee` via Paystack.

## Goals

- Admin can grant a named player free entry to one specific tournament.
- The player still goes through the normal registration form (display name, WhatsApp, club, IGN, rules agreement) — a waiver skips *payment*, not data capture.
- Financial reporting can still distinguish real Paystack revenue from comped entries.
- A waiver can be revoked before it's used; once used, it's a permanent audit record.

## Non-goals

- No refunds for players who already paid before a waiver is granted (a waiver only ever prevents a future charge, never reverses a past one).
- No automatic eligibility rules (past champions, award winners, Sentinel Score tier, etc.) — grants are 100% manual, per tournament, per player. Automatic rules can be layered on top later if ever wanted, out of scope now.
- No bulk-grant UI (one player at a time) — YAGNI until a real need for bulk shows up.

## Data model

New table `tournament_fee_waivers`:

```sql
CREATE TABLE public.tournament_fee_waivers (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid        NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  player_id     uuid        NOT NULL REFERENCES public.profiles(id),
  granted_by    uuid        NOT NULL REFERENCES public.profiles(id),
  reason        text,
  granted_at    timestamptz NOT NULL DEFAULT now(),
  redeemed_at   timestamptz,
  UNIQUE (tournament_id, player_id)
);
```

- `UNIQUE(tournament_id, player_id)` — a player can only have one waiver per tournament (prevents accidental double-grants; also means "grant" is really an upsert-or-reject, not something that can silently stack).
- `redeemed_at IS NULL` — the waiver is still live/unused. Set the instant `registerForTournament` successfully uses it to skip payment. This both prevents double-redemption races and gives admin a clean "granted vs. actually used" audit trail.
- Revoking a waiver is only allowed while `redeemed_at IS NULL` — you can't revoke something a player already redeemed (that's a real completed registration at that point).
- RLS: staff (`is_staff()`) can read/insert/delete rows scoped to their own management; no player-facing read policy needed (the player never sees the waivers table directly — they just see "no payment required" on the registration page, computed server-side by checking for their own live waiver).
- Admin-only, not moderator: granting a waiver is a financial decision (it waives real money), so gate the mutating actions with `requireAdmin()`, matching `deleteTournament`'s precedent. Staff (moderators included) can still view the granted-waivers list on the registrations page (read-only), matching the existing registrations table's staff-wide visibility.

## `tournament_registrations` change

Add one nullable column:

```sql
ALTER TABLE public.tournament_registrations ADD COLUMN fee_waived boolean NOT NULL DEFAULT false;
```

- The row's `payment_status` is still set to `'paid'` for a waived registration — every existing consumer that filters `.eq('payment_status', 'paid')` (capacity counting in `checkCanRegister`/`registerForTournament`, bracket generation, admin financial views) keeps working unchanged; a comped player counts as a real registered player.
- `fee_waived = true` and `paystack_reference = null` distinguish a comped row from a real Paystack payment for reporting purposes.

## Player-facing flow

On the tournament registration page, `registerForTournament`:

1. Runs its existing validation (auth, tournament status, capacity, rules agreement) — unchanged.
2. **New step:** looks up `tournament_fee_waivers` for `(tournament_id, user.id)` where `redeemed_at IS NULL`.
   - **No live waiver:** unchanged existing behavior — insert `pending` registration, initialize Paystack transaction, redirect to Paystack.
   - **Live waiver found:** insert the registration directly with `payment_status = 'paid'`, `fee_waived = true`, `paystack_reference = null`; stamp `redeemed_at = now()` on the waiver row (same transaction/sequence, guarded so a raced second attempt can't redeem twice); redirect straight to a confirmation state (no Paystack).

No changes to the registration details form itself (`registrationDetailsSchema`, the UI) — a waiver only changes what happens after the form is submitted.

## Admin-facing flow

On the existing `/admin/tournaments/[id]/registrations` page, add a "Grant free entry" section above the registrations table:

- A small form: username text field + optional reason text field + submit.
- Server action looks up the profile by an exact, case-insensitive username match (`.ilike('username', username)` with no wildcards — usernames are unique, so this returns at most one row; no fuzzy substring search needed here, unlike `/(public)/players/page.tsx`'s browse search), returns a friendly "no player with that username" error if not found, then inserts the waiver row (admin-only via `requireAdmin()`).
- A "Granted waivers" list below the form shows existing waivers for this tournament (username, reason, granted/redeemed state) with a "Revoke" action (only shown/allowed while unredeemed).
- Handle the `UNIQUE(tournament_id, player_id)` violation (Postgres `23505`) with a friendly "already has a waiver for this tournament" message, matching the existing `isUniqueViolation` helper pattern used elsewhere (`lib/tournaments/admin-actions.ts`, `lib/games/admin-actions.ts`).

## Edge cases

- Player already has a `paid` registration when admin tries to grant a waiver: allow the grant to be created (it's harmless — nothing will ever redeem it since they're already registered), but the admin UI should show a warning inline ("this player is already registered — a waiver won't do anything for them") rather than blocking the grant outright, since the reason might still be worth recording for other purposes (e.g., an award mention). Keep this simple: just check-and-warn at grant time, don't try to auto-refund or auto-merge anything.
- Player has a `pending` (unpaid, abandoned) registration when a waiver is redeemed: same as today's re-registration path — the existing pending row is updated in place (this already works via the `existing` branch in `registerForTournament`), just skipping the Paystack initialize call and marking it paid immediately instead.
- Tournament reaches capacity between grant and redemption: the existing `checkCanRegister` capacity check runs before the waiver check, so a full tournament still blocks a would-be redeemer exactly like it blocks a paying player today — waivers don't bypass capacity.
