# Player Wallet System (#28) — Design Spec

**Date:** 2026-07-13
**Status:** Approved design → ready for implementation plan
**Depends on:** #14 (KYC — the withdrawal KYC gate carries over unchanged), #22 (referral credit flow being replaced), #26 (staked-friendly credit flow being replaced).
**Retires:** `withdrawal_requests`, `referral_withdrawal_requests`, `friendly_withdrawal_requests`, and the derived-balance helpers `computeReferralBalance` / `computeStakedBalance`.

---

## 1. Goal

Replace three near-identical withdrawal tables (prize, referral, staked-friendly) with one virtual wallet: a stored ₦ balance per player, credited automatically by three event types (prize win, referral confirmation, staked-friendly win) or manually by admin, debited by one withdrawal-request flow with one admin queue. Every balance change is logged to a ledger. The wallet is not a real bank account — it never touches Paystack; a withdrawal request is still resolved manually by Samuel outside the app, exactly like today's three flows.

**Live-data check before designing the migration:** `withdrawal_requests`, `referral_withdrawal_requests`, `friendly_withdrawal_requests`, `referrals`, and completed staked `friendly_matches` are all currently empty in the live database. There is nothing to backfill and nothing lost by dropping the three old tables outright as part of this migration.

## 2. Data model

**Migration `024_wallet_system.sql`:**

```sql
CREATE TABLE public.wallets (
  player_id  uuid        PRIMARY KEY REFERENCES public.profiles(id),
  balance    integer     NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Append-only audit ledger. Every credit and debit gets a row here, written
-- in the same server-role call that updates wallets.balance.
CREATE TABLE public.wallet_transactions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id    uuid        NOT NULL REFERENCES public.profiles(id),
  amount       integer     NOT NULL,  -- positive = credit, negative = debit; never zero
  type         text        NOT NULL CHECK (type IN (
                  'prize', 'referral', 'friendly_stake', 'admin_credit',
                  'withdrawal_request', 'withdrawal_reversal'
                )),
  reference_id uuid,  -- match id / referral id / friendly_matches id / withdrawal_requests id — polymorphic, no FK
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.wallet_transactions (player_id, created_at DESC);

-- One unified withdrawal queue. No `source` column — once money is in the
-- wallet it's fungible (a withdrawal isn't "prize money" or "referral money"),
-- so there is nothing meaningful to tag a withdrawal row with. The ledger
-- (wallet_transactions) is where per-credit provenance lives, not here.
CREATE TABLE public.withdrawal_requests (
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
CREATE INDEX ON public.withdrawal_requests (player_id);
CREATE INDEX ON public.withdrawal_requests (status);
CREATE UNIQUE INDEX withdrawal_requests_one_pending_per_player
  ON public.withdrawal_requests (player_id) WHERE status = 'pending';

DROP TABLE public.referral_withdrawal_requests;
DROP TABLE public.friendly_withdrawal_requests;
-- public.withdrawal_requests is dropped and recreated above with the same
-- name (no application code needs to learn a new table name for the
-- withdrawal-queue concept; only its meaning widens from "prize only" to
-- "wallet in general").
```

RLS, mirroring the existing prize/referral/friendly patterns:
- `wallets`: self-read (`player_id = auth.uid()`) + staff-read-all. **No client INSERT/UPDATE policy at all** — the row is created and mutated exclusively by the service-role `creditWallet`/`debitWallet` helpers (§3), the same "no client write policy" pattern `referrals` already uses.
- `wallet_transactions`: self-read + staff-read-all. No client write policy — append-only, service-role only.
- `withdrawal_requests`: self-or-staff read (same as today); player INSERT for their own row gated in the Server Action (not RLS, matching the existing `requestWithdrawal` pattern); UPDATE (resolve) via the service-role admin client from a staff-only Server Action.

A `wallets` row is created lazily (upsert) the first time a player is credited — no trigger on `profiles` insert, since most players never earn anything.

## 3. `creditWallet` / `debitWallet` — the only writers, `lib/wallet/service.ts`

```ts
export type WalletTxnType =
  | 'prize' | 'referral' | 'friendly_stake' | 'admin_credit'
  | 'withdrawal_request' | 'withdrawal_reversal'

export async function creditWallet(
  admin: AdminClient, playerId: string, amount: number,
  type: WalletTxnType, referenceId: string | null, note?: string,
): Promise<void>

export async function debitWallet(
  admin: AdminClient, playerId: string, amount: number,
  type: WalletTxnType, referenceId: string | null, note?: string,
): Promise<{ ok: true } | { ok: false; error: string }>
```

Both `amount` arguments are always positive; `creditWallet` writes `+amount` to the ledger, `debitWallet` writes `-amount`.

`creditWallet` upserts the wallet row (`balance = balance + amount`, `updated_at = now()`) and inserts the ledger row. No balance ceiling to check — only a floor matters, and credits only ever increase the balance.

`debitWallet` is the one place the explicit no-negative-balance handling matters, per your instruction not to rely on the `CHECK (balance >= 0)` constraint as the user-facing error path:

```sql
UPDATE wallets SET balance = balance - $amount, updated_at = now()
WHERE player_id = $playerId AND balance >= $amount
RETURNING balance;
```

If this returns zero rows, `debitWallet` returns `{ ok: false, error: 'Insufficient wallet balance.' }` — no exception, no reliance on the Postgres constraint firing. This conditional `UPDATE ... WHERE balance >= $amount` is also the atomic safety net against a race between two concurrent withdrawal requests: even if both requests' calling code read a stale balance, only one `UPDATE` can succeed once the first has already lowered it below the second's amount. Only on `{ ok: true }` does `debitWallet` insert the ledger row (negative amount) — never insert a debit ledger row for a debit that didn't actually happen.

**Defense in depth, not either/or:** the calling Server Action (§4) still checks `wallet.balance >= requested_amount` *before* calling `debitWallet`, exactly as `registerForTournament` checks tournament status before calling Paystack — that gives the normal request path a clean, fast, expected error without even attempting a write. `debitWallet`'s conditional update is the second, atomic layer that makes the outcome correct even if two requests race between that pre-check and the write. Neither layer alone is sufficient: the pre-check alone has a race window; the DB `CHECK` constraint alone would surface as an unhandled Postgres error, not a form error.

## 4. Withdrawal request — one flow, debit-on-request

`lib/wallet/actions.ts` — `requestWalletWithdrawal(prev, formData)`:
1. Same KYC gate as today (`player_kyc.kyc_status === 'verified'` + bank fields on file) — unchanged, applies to all withdrawal types now.
2. Load the player's `wallets.balance`. If `formData.amount > balance`, return `{ error: 'That amount is more than your available balance.' }` (the fast, expected-case error path from §3).
3. Insert the `withdrawal_requests` row (`status: 'pending'`), then call `debitWallet(admin, playerId, amount, 'withdrawal_request', withdrawalRequestId)`. If `debitWallet` returns `{ ok: false }` (the race case — balance dropped between step 2's read and now, e.g. two tabs submitting at once), delete the just-inserted `withdrawal_requests` row and return the same "more than your available balance" error — the player never sees a partial/inconsistent state.
4. The existing partial unique index (`one pending request per player`) still applies, surfaced as Postgres `23505` exactly as today.

Debiting **at request time** (not at admin-paid time) means the requested amount is immediately unavailable for a second request — this is what makes it impossible to submit two requests that together overdraw the balance, matching how the current referral/friendly balance formulas already subtract `pending` amounts from what's available.

`lib/wallet/admin-actions.ts` — `resolveWalletWithdrawal(prev, formData)`, `requireAdmin`:
- **Reject:** `status = 'rejected'`, `resolved_at = now()`, requires an `admin_note`. Calls `creditWallet(admin, playerId, amount, 'withdrawal_reversal', withdrawalRequestId, note)` to give the debited amount back — the wallet-native replacement for "rejected amount becomes available again" in the old derived-balance formulas.
- **Paid:** `status = 'paid'`, `resolved_at = now()`. No wallet change — the amount was already debited at request time; paying just closes out the request. No Paystack call — manual payout, matching prize/referral/friendly withdrawals' current state (Paystack Transfer automation exists but is blocked pending Paystack enabling it on the account; when that's resolved, the unified withdrawal flow upgrades the same way prize withdrawals do, so there's no drift to reconcile across separate flows going forward).

## 5. Automatic credit hooks — three call sites, no new endpoints

- **Prize, on final confirmation.** `lib/matches/verify-actions.ts`'s `confirmResult()` already has the exact "the final was just confirmed" branch: `if (nextRoundName(m.round) === null) { await admin.from('tournaments').update({ status: 'completed' })... }`. `confirmResult` already has the just-confirmed `scoreA`/`scoreB` in scope (the parsed form values it just wrote to the match row); `matchWinnerId` (already used elsewhere in the advancement engine) needs those plus `player_a_id`/`player_b_id`, which the existing `matches` select in that function doesn't currently include — a small addition to that select, not a new query. In that same branch, once the winner is known: `creditWallet(admin, winnerId, tournament.prize_pool, 'prize', tournament.id)`. **Winner-take-all**, per your confirmation — the full `prize_pool` goes to the final's winner only; there is no per-placement (1st/2nd/3rd) tracking in the schema today and none is being added here. If Samuel wants to split a pool with a runner-up, he uses the admin manual-credit path (§6) — not built as an automated tier system until an actual tournament needs it.
- **Referral, on email confirmation.** `app/auth/confirm/route.ts`, right after the existing `INSERT INTO referrals (referrer_id, referred_id)` (see the #22 referral-program spec §4), add `creditWallet(admin, referrerId, 100, 'referral', referral.id)`. The `UNIQUE(referred_id)` constraint on `referrals` still makes the whole flow idempotent if the confirm route is ever hit twice — the credit only fires once because the `INSERT INTO referrals` only succeeds once.
- **Staked friendly, on admin confirmation.** `lib/friendly-matches/admin-actions.ts`'s `confirmFriendlyResult()`, inside the existing `if (fm.stake_amount && fm.winner_id)` block (right alongside the Sentinel Score event insert), add `creditWallet(admin, fm.winner_id, fm.stake_amount * 2, 'friendly_stake', fm.id)`.

All three call sites already run behind a service-role admin client in a Server Action gated by `requireStaff`/`requireAdmin` or (for the referral case) the server-only auth-confirm route — `creditWallet` never needs its own additional auth check, it trusts its caller like every other internal helper in this codebase.

## 6. Admin manual credit

A small form on the new unified admin page (§7): search a player by username, enter an amount and a required note (e.g. "compensation for match dispute", "sponsored prize — DLS Cup #4"), submit → `requireAdmin` → `creditWallet(admin, playerId, amount, 'admin_credit', null, note)`. The note is mandatory here (unlike the other three automatic credit types, which have self-explanatory `reference_id`s) since `admin_credit` has no reference row to explain itself later.

## 7. Dashboard and admin surfaces

- **Dashboard:** one `WalletPanel` component (`components/dashboard/WalletPanel.tsx`) replaces `WithdrawalPanel`, `ReferralPanel`'s balance/withdrawal section, and `FriendlyWithdrawalPanel` — shows current balance, the withdrawal request form (gated on KYC, same UX as today's three), and request history (pending/rejected/paid). `ReferralPanel`'s non-balance content (referral link, copy button, referral count, list of referred players) stays — it's about the referral relationship, not money, so it keeps its own section; only the balance/withdrawal portion moves into `WalletPanel`. Same for `FriendsPanel`/friendly-match UI — unaffected, only the staked-balance withdrawal bit moves.
- **Admin:** one `/admin/wallet` page replaces `/admin/withdrawals`, `/admin/referrals`' withdrawal-queue content, and `/admin/friendly-withdrawals`. Sections: manual credit form (§6) at the top, then the pending queue, then resolved history — same two-bucket layout every existing withdrawal admin page already uses. `lib/admin/nav.ts`'s `ADMIN_NAV` loses the `Withdrawals`, `Referrals`, and `Friendly withdrawals` entries and gains one `{ label: 'Wallet', href: '/admin/wallet', adminOnly: true }`. (`/admin/referrals` itself is retired entirely — per the #22 spec, that page is *only* the withdrawal queue with an extra referred-players column; it carries no other content that needs to survive. `/admin/friendlies`, the friendly-match confirm/dispute queue, is unrelated and stays exactly as is — only `/admin/friendly-withdrawals` goes.)
- **Fraud-check parity:** today's `/admin/referrals` shows each pending row's live referred-players list so Samuel can eyeball it before paying (per the #26 spec's §6 note on the same pattern). Since a wallet balance is now pooled across sources, that check generalizes to "does this player's recent `wallet_transactions` history look legitimate" rather than "does this specific withdrawal look legitimate" — each pending row on `/admin/wallet` can expand to show that player's recent ledger entries (type, amount, date), and a `type = 'referral'` row's `reference_id` still joins back to `referrals` if Samuel needs to see exactly who was referred. The exact expand-row UI is an implementation-plan detail, not specified further here.

## 8. Notifications

`player_notifications.type` CHECK gains `'wallet_credited'`, `'withdrawal_paid'`, `'withdrawal_rejected'` stays (already exists from the original prize flow and is reused as-is, now describing any wallet withdrawal). `'referral_withdrawal_paid'`, `'referral_withdrawal_rejected'`, `'friendly_withdrawal_paid'`, `'friendly_withdrawal_rejected'` are dropped from the CHECK list along with their now-dead call sites (nothing in the live DB uses them — confirmed in §1). `'referral_credited'` stays as a distinct notification (it fires with different copy than a generic wallet credit, from `app/auth/confirm/route.ts`) — `notifyInApp` calls at each of the three automatic-credit call sites (§5) keep firing their existing per-context notification (`referral_credited`, `result_confirmed` for the friendly match, and a new `wallet_credited` specifically for the prize case, since there's no existing prize-specific in-app notification type to reuse).

## 9. Out of scope

- Placement-tiered prizes (1st/2nd/3rd) — winner-take-all only; see §5.
- Any backfill migration — confirmed empty tables, nothing to backfill (§1).
- Re-enabling automated Paystack Transfer payout — withdrawals stay manual, same as today; see `[[project_paystack_transfer_blocked]]`.
- A dedicated per-player admin profile/detail page — the manual-credit form (§6) is a lightweight username-search form on `/admin/wallet`, not a new player-detail surface.
- Negative wallet balances of any kind, including holds/pending-debit states beyond the simple debit-on-request model in §4.
