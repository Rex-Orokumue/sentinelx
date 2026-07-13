# Referral Program (#22) — Design Spec

**Date:** 2026-07-13
**Status:** Approved design → ready for implementation plan
**Depends on:** #14 (KYC + withdrawal system — referral withdrawals reuse its KYC gate and admin-resolution pattern).

---

## 1. Goal

Players get a shareable link that earns them ₦100 whenever someone signs up through it. Once a player has referred at least 5 people, they can request a payout from a referral balance that is tracked completely separately from prize winnings — different table, different admin queue, no mixing of the two money flows.

## 2. Data model

**Migration `019_referral_program.sql`:**

```sql
-- Set once at signup via handle_new_user(); never edited afterward.
ALTER TABLE public.profiles ADD COLUMN referred_by uuid REFERENCES public.profiles(id);

-- One row per CONFIRMED referral (credited at email verification, not raw
-- signup — see §4). This is the source of truth; referral balance is derived
-- from it, never stored directly.
CREATE TABLE public.referrals (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid        NOT NULL REFERENCES public.profiles(id),
  referred_id uuid        NOT NULL REFERENCES public.profiles(id) UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.referrals (referrer_id);

-- Entirely separate from withdrawal_requests (prize money). Same shape,
-- same manual-resolution flow, different table — per explicit instruction.
CREATE TABLE public.referral_withdrawal_requests (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id       uuid        NOT NULL REFERENCES public.profiles(id),
  amount          integer     NOT NULL CHECK (amount > 0),
  bank_name       text        NOT NULL,
  account_number  text        NOT NULL,
  account_name    text        NOT NULL,
  status          text        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'rejected', 'paid')),
  admin_note      text,
  requested_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz
);

-- One active (pending) referral withdrawal per player at a time.
CREATE UNIQUE INDEX referral_withdrawal_requests_one_active_per_player
  ON public.referral_withdrawal_requests (player_id)
  WHERE status = 'pending';
```

RLS:
- `referrals`: player reads rows where `auth.uid() = referrer_id` (their own referral list); staff read all (`is_staff()`); **no client INSERT policy at all** — the only writer is `app/auth/confirm/route.ts`, which uses the service-role client.
- `referral_withdrawal_requests`: same self-or-staff read pattern as `withdrawal_requests`; player INSERT for their own row (gated in the Server Action, not RLS, matching the existing `requestWithdrawal` pattern); all UPDATEs (resolve) go through the service-role admin client from a staff-only Server Action.

**Referral balance is derived, never stored:**

```
available balance (₦) = (count of referrals where referrer_id = player) × 100
                       − (sum of amount where player_id = player
                          AND status IN ('pending', 'paid'))
```

`rejected` requests are excluded from the subtraction — rejecting a request restores that amount to the player's available balance so they can re-request it. `pending` is subtracted (not just `paid`) so a player can't open two requests that together overdraw their balance.

## 3. Referral link

`https://sentinelxesports.vercel.app/signup?ref=<username>` — no new `/join` route. The player's own username is the code: already unique, already indexed, and (since profile editing intentionally excludes username, see the profile-edit fix shipped earlier) immutable, so a shared link never goes stale.

**Known constraint, documented not solved:** if username editing is ever added later, existing referral links using the old username would break. Out of scope for this spec — flagging so it's not a surprise later.

## 4. Credit flow — fires on email confirmation, not raw signup

1. Signup page reads `?ref=` from the URL into a hidden form field.
2. `signupSchema` (`lib/auth/schema.ts`) gains an optional `ref: z.string().optional()`.
3. `signup()` action passes it through: `auth.signUp({ options: { data: { username, ref } } })`.
4. `handle_new_user()` trigger — already resolving `username`/`display_name` from `raw_user_meta_data` — additionally does a lookup: if `raw_user_meta_data->>'ref'` matches an existing `profiles.username`, set `referred_by` to that profile's `id` on the new row. Unknown/missing ref codes are silently ignored (no signup error, no partial-match fuzziness).
5. **The ₦100 credit does not fire here.** It fires in `app/auth/confirm/route.ts`, after `verifyOtp` succeeds for `type=signup` (not `type=recovery`): look up the now-confirmed user's `profiles.referred_by`; if set, `INSERT INTO referrals (referrer_id, referred_id) VALUES (referred_by, user.id)`, relying on the `UNIQUE(referred_id)` constraint to make this idempotent if the confirm route is ever hit twice for the same user.
6. A signup that's abandoned before email confirmation never credits anyone — consistent with "registers via that link" meaning a real, verified account.

## 5. Player dashboard

New section on `/dashboard` (own component, `components/dashboard/ReferralPanel.tsx`), following the existing section pattern (`<section className="mb-10">` + `<h2>`):

- Referral link with a copy-to-clipboard button.
- Referral count and current available balance.
- List of referred players (username/display name), so the player can see who's counted.
- Once referral count ≥ 5 (equivalently, balance ≥ ₦500): a withdrawal request form, gated on `player_kyc.kyc_status === 'verified'` — same KYC gate as prize withdrawals, reusing the bank details already on file. Below 5 referrals: a simple "Refer N more players to unlock withdrawals" message, no form.
- Request history (pending/rejected/paid), same display pattern as the existing withdrawal history list.

## 6. Admin: new `/admin/referrals` page

Structurally cloned from `/admin/withdrawals` (`app\admin\withdrawals\page.tsx` + `WithdrawalQueueRow`): pending queue → resolved history, admin-only (`requireAdmin()`, same as prize withdrawals — moderators don't touch money). New nav entry in `lib/admin/nav.ts` alongside `Withdrawals`.

The one structural difference: each pending row also shows the requester's full referred-players list (a live query — `referrals` joined to `profiles` for `referrer_id = request.player_id` — not a snapshot, so Samuel always sees current truth) so he can eyeball it for forgery before approving.

**Resolution is manual, matching the current prize-withdrawal flow exactly** (per explicit instruction: keep both manual rather than re-enabling automated Paystack Transfer for either):
- "Pay" → `status = 'paid'`, `resolved_at = now()`, no Paystack call. Admin pays the player outside the app.
- "Reject" → `status = 'rejected'`, requires an `admin_note` reason, `resolved_at = now()`. Rejected amount becomes available again (per the balance formula in §2).

`lib/referrals/admin-actions.ts` mirrors `lib/withdrawals/admin-actions.ts`'s current (manual) shape — no commented-out automated block needed here since there's no prior automated version of this specific flow to preserve.

## 7. Out of scope

- Anti-abuse beyond email verification (e.g. device/IP fingerprinting against multi-account farming) — not addressed; email confirmation is the only bar, matching the platform's existing trust level.
- Referral link click tracking / analytics (who clicked but didn't sign up) — not tracked, only completed+confirmed signups count.
- Tiered or bonus referral rewards — flat ₦100 per referral only, no escalation.
