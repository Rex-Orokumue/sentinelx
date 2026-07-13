# Friend System + Friendly Matches (#26) — Design Spec

**Date:** 2026-07-13
**Status:** Approved design → ready for implementation plan
**Depends on:** Player Notification System (friend-request notifications), `lib/paystack/server.ts` + the existing Paystack webhook (staked payment), `lib/scoring/score.ts`/`lib/scoring/events.ts` (Sentinel Score reuse), `referral_withdrawal_requests` (structural precedent for the new staked-balance withdrawal table).

---

## 1. Goal

Players can friend each other, and challenge anyone (friend or not) to a friendly match — free (social, zero stats impact) or staked (real money, Sentinel Score impact only, separate withdrawable balance). A shared "Match Room" surface lets accepted-challenge players coordinate via WhatsApp and an in-game code.

## 2. Friend system

```sql
CREATE TABLE public.friends (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid        NOT NULL REFERENCES profiles(id),
  recipient_id uuid        NOT NULL REFERENCES profiles(id),
  status       text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (requester_id, recipient_id)
);
```

Decline and remove-friend are both a plain `DELETE` — no `'declined'` status retained, since a declined request carries no ongoing meaning once dismissed. A pure helper checks both directions for "are X and Y friends" (the relationship is directionless once accepted). RLS: participant-read, requester-only insert, recipient-only update (accept), either participant can delete their own row. Accepting a request fires a `friend_request`-type notification via the notification system already shipped (that `type` value is already in the `player_notifications` CHECK constraint, reserved for this).

**Known gap, deliberately out of scope for v1:** no cooldown after a decline — a requester can immediately re-send. Acceptable for now (small trusted community); flag if spam becomes a real problem later.

## 3. Friendly matches — one table for the whole challenge → match lifecycle

```sql
CREATE TABLE public.friendly_matches (
  id                            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  challenger_id                 uuid        NOT NULL REFERENCES profiles(id),
  opponent_id                   uuid        NOT NULL REFERENCES profiles(id),
  stake_amount                  integer,    -- null = free friendly
  status                        text        NOT NULL DEFAULT 'pending' CHECK (status IN (
                                   'pending', 'declined', 'awaiting_payment', 'active',
                                   'awaiting_admin_confirmation', 'completed', 'disputed'
                                 )),
  challenger_paid                boolean     NOT NULL DEFAULT false,
  opponent_paid                  boolean     NOT NULL DEFAULT false,
  challenger_paystack_reference  text,
  opponent_paystack_reference    text,
  game_code                      text,
  score_challenger                integer,
  score_opponent                   integer,
  screenshot_url                   text,
  winner_id                        uuid        REFERENCES profiles(id),
  admin_note                       text,
  created_at                       timestamptz NOT NULL DEFAULT now(),
  completed_at                     timestamptz
);
```

**State machine:**
- **Free:** `pending` (challenge sent) → opponent accepts → `active` immediately, no payment → winner submits score + screenshot → `awaiting_admin_confirmation` → admin confirms → `completed`. **Zero Sentinel Score / ranking / wins / goals impact** — purely a social record.
- **Staked:** `pending` (stake amount proposed, no money moves) → opponent declines (→ `declined`, terminal) or accepts → `awaiting_payment` → both players pay independently via the same Paystack inline-checkout flow tournament registration already uses → both `_paid` true → `active` (Match Room unlocks) → winner submits score + screenshot → `awaiting_admin_confirmation` → admin confirms (→ `completed`: winner's staked balance credited, Sentinel Score logged) or disputes (→ `disputed`: manual admin follow-up, no automated refund — matches this codebase's existing dispute-handling pattern of case-by-case admin resolution).

## 4. Payment — extends the existing Paystack webhook, no new endpoint

`confirmRegistration(reference)` already returns a clean `'not_found'` (it never throws) when a reference matches no tournament registration. `app/api/paystack/webhook/route.ts`'s `charge.success` branch tries `confirmRegistration` first; **only when it resolves to exactly `'not_found'`** does it try a new parallel `confirmFriendlyStake(reference)`. This fan-out is gated strictly on that specific return value — a thrown exception (a genuine error, e.g. a DB timeout) is not caught-and-reinterpreted as "try the other branch"; it propagates to the webhook's normal error handling. Today `confirmRegistration` doesn't throw in practice (every path resolves to a `ConfirmResult` string), so this is a non-issue currently, but the ordering must stay branch-on-return-value, not branch-on-catch, so it stays correct if that ever changes.

`confirmFriendlyStake` mirrors `confirmRegistration`'s exact shape (idempotent, verify-then-update, logs a real error on verify failure) but validates against `friendly_matches.stake_amount * 100` fetched per-row instead of a hardcoded constant, and updates whichever side's reference matched (`challenger_paystack_reference` or `opponent_paystack_reference`) to set that side's `_paid = true`. When both sides are paid, status moves `awaiting_payment` → `active`. Each player gets their own reference via a new `buildFriendlyStakeReference(matchId, userId)`, same `sx_...` format as the existing `buildReference`.

## 5. Result submission — single-sided, no separate results table

The winner submits `score_challenger`/`score_opponent` + a screenshot directly onto the `friendly_matches` row (no dual-submission/bracket-advancement complexity like tournament matches, so no separate `match_results`-equivalent table). Screenshot goes to a new private `friendly-match-evidence` storage bucket, mirroring the existing `match-evidence` bucket's RLS (participant + staff read via signed URL, participant write). Admin confirms or disputes from a new `/admin/friendlies` queue — same manual review pattern as every other admin queue in this codebase. This new page needs its own entry in `lib/admin/nav.ts`'s `ADMIN_NAV` array, `adminOnly: true` (it resolves money, same as `Withdrawals`/`Referrals` — moderators don't touch financial queues) — easy to forget since it's a brand-new admin surface, not an addition to an existing page.

## 6. Match Room — WhatsApp button, not raw number, matching #25's established pattern

The friendly match's own detail page, once `status = 'active'`. Shows each player their opponent's **"Coordinate on WhatsApp" button** (reusing the exact same `wa.me` link-building approach as the tournament fixture card from #25) — **not** the raw `profiles.whatsapp_number` as visible text. `profiles` already has `profiles_public_read USING (true)` (every column, including `whatsapp_number`, is already readable by anyone at the RLS level — this predates #26 and isn't being changed), so no RLS work is needed here; the button-not-plaintext choice is a deliberate application-layer consistency decision with #25, not a security requirement forced by RLS. Also shows an editable `game_code` field the challenger fills in for the opponent to see.

## 7. Sentinel Score — staked friendlies only, reusing existing event types and point values, NOT `syncMatchEvents`

`sentinel_score_events.match_id` is already nullable. On a staked friendly's confirmation, a dedicated (new, friendly-specific) function directly inserts: one `match_completed` event (existing `MATCH_COMPLETED_DELTA` point value from `lib/scoring/events.ts`) for **both** players, and one additional `win_no_dispute` event (existing `WIN_DELTA`) for the winner — reusing the same `event_type` strings and point constants as tournament matches for consistency, with `match_id = null` and the friendly match's id noted in `note`. `computeScore()` (`lib/scoring/score.ts`) only ever sums `points_delta` across events — it has no `match_id` dependency, so a null `match_id` computes correctly with no special-casing needed.

**This does NOT reuse `syncMatchEvents`** — that function is specifically built around `matches`-table regeneration (`AUTO_MATCH_EVENT_TYPES` is a delete-and-reinsert discriminator keyed by `match_id`, used so a tournament match's result can be overturned and recomputed idempotently). Friendly matches don't need that: a disputed staked friendly is resolved manually by admin, one time, not automatically regenerated. The new function is a simple one-time insert, not a regenerate-from-source engine.

## 8. Staked balance — same derived pattern as referrals, but flagged as the third of its kind

```sql
CREATE TABLE public.friendly_withdrawal_requests (
  -- same shape as referral_withdrawal_requests: id, player_id, amount,
  -- bank_name, account_number, account_name, status, admin_note,
  -- requested_at, resolved_at
);
```

Structurally identical to `referral_withdrawal_requests` — own table, `is_admin()`-only resolution, manual payout (matching prize/referral withdrawals' current state), notification-wired via `notifyInApp()`. Balance is derived, never stored: sum of `stake_amount * 2` for matches where the player is `winner_id` and `status = 'completed'`, minus non-rejected withdrawal amounts.

**Assumption in that formula, stated explicitly:** `stake_amount` is a single shared column — both players always pay the identical amount (there is no separate `challenger_stake`/`opponent_stake`), so the winner's payout is always exactly the full pot, `stake_amount * 2`, with no asymmetric-stake or partial-refund case to account for. This holds as long as staked friendlies only ever reach `completed` via the normal both-paid-the-same-amount path. A `disputed` match that somehow needed a partial refund would NOT go through this formula at all — disputes are resolved manually by admin (§3, §9) outside the automated balance calculation, so this scenario doesn't arise without a deliberate, separate future change.

**Flag, not fixed here:** this is now the **third** separate withdrawal table (prize, referral, staked-friendly) with near-identical shape and manual-resolution logic duplicated three times. A unified withdrawal system (one table with a `source` discriminator column, or a shared query/UI layer across the three) should be seriously considered before a fourth withdrawal type is ever added — noted for v4.0 planning, not addressed in this spec.

## 9. Out of scope

- Friend-request decline cooldown/rate-limiting (§2).
- Automated refunds on a disputed staked friendly — admin resolves manually.
- Unifying the three withdrawal tables into one system (§8) — flagged for future work, not built here.
- Any scheduling/expiry concept for friendlies (unlike #24's full-day tournament matches) — a friendly stays `active` indefinitely until a result is submitted.
