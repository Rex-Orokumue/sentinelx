# Design: Admin wallet credit/refund + zero-fee tournament registration

**Date:** 2026-07-22
**Context:** Season 2 was cancelled and needs its paid registrations refunded. A free community tournament is also planned. Neither cancellation, refunds, nor zero-fee registration exist in the codebase today.

## Background — what already exists

Exploration before this design turned up several pieces already built that the original request assumed didn't exist:

- `/admin/wallet` (singular) already exists: a withdrawal-queue manager plus a username-keyed `WalletCreditForm` → `adminCreditWallet` server action, with no confirm step.
- `creditWallet(admin, playerId, amount, type, referenceId, note)` in `lib/wallet/service.ts` already lazily upserts the `wallets` row (read-then-branch INSERT/UPDATE, not race-safe against concurrent double-create — pre-existing, out of scope here) and always writes a `wallet_transactions` row.
- `wallet_transactions` already has a `note` column and its `type` CHECK already allows `'admin_credit'` and `'prize'` (among others). No migration needed for either.
- `tournament_registrations.payment_status` CHECK already allows `'refunded'` — currently unused by any code path.
- `tournaments.status` CHECK does **not** include `'cancelled'`, and there is no admin action anywhere that sets tournament status to cancelled. This is a real gap that must be filled for the Refund feature to be reachable at all.
- `wallets` has no `created_at` column, only `updated_at`.

## Migration `032_tournament_cancellation.sql`

The only schema change required:

```sql
ALTER TABLE public.tournaments DROP CONSTRAINT tournaments_status_check;
ALTER TABLE public.tournaments ADD CONSTRAINT tournaments_status_check
  CHECK (status IN ('draft','registration_open','registration_closed','active','completed','cancelled'));
```

Refund tracking reuses the existing `payment_status = 'refunded'` value — no new `refunded` boolean column, no new `wallet_transactions` column.

## Cancel tournament (prerequisite for Refund)

- New action `cancelTournament(_prev, formData)` in `lib/tournaments/admin-actions.ts`, gated by `requireAdmin()` (financial-adjacent, unlike the existing `requireStaff()`-gated lifecycle actions).
- Allowed from `registration_open`, `registration_closed`, or `active` → sets `status = 'cancelled'`. Not allowed from `draft` (delete already covers unpublished tournaments with no paid registrations) or `completed`.
- Only flips the status column. Does not touch registrations or wallets — refunding stays a separate, explicit per-player admin action.
- On success: `revalidatePath('/admin/tournaments')` and `revalidatePath('/admin/tournaments/${id}/registrations')`, so the Refund buttons on the registrations page appear immediately without a hard reload.
- UI: new button on `TournamentListRow` (alongside Edit/Registrations/Bracket/Matches), admin-only, RecomputeButton-style two-step confirm. The tournaments list query gains a per-tournament paid-registration count so the confirm step reads: *"Confirm — cancel [Title]? N paid registrations will need manual refunds."* Cancelling itself does not trigger any refund — that stays manual per player via the Refund button below.

## Feature A — wallet list + manual credit

### Wallet list
No new route or nav entry. `/admin/wallet` gets a new "All wallets" table added above/alongside its existing sections: `wallets` joined to `profiles`, showing display name, username, balance, and `updated_at` (labeled "Last updated" — there is no `created_at` to show). No filters (wallet count is small).

### `lib/admin/wallet-actions.ts` (new file)

```ts
export type WalletTxnType = 'prize' | 'referral' | 'friendly_stake' | 'admin_credit' | 'withdrawal_request' | 'withdrawal_reversal'

export async function manualCreditWallet(
  playerId: string,
  amount: number,
  reason: string,
  type: WalletTxnType = 'admin_credit',
): Promise<{ balance: number } | { error: string }>
```

- `requireAdmin()` first.
- Validates `playerId` non-empty, `amount` is a positive integer, `reason` non-empty.
- Calls the existing `creditWallet(admin, playerId, amount, type, null, reason)` — never writes `wallets.balance` directly. `creditWallet`'s existing lazy-upsert already handles the "player never opened their wallet" edge case (no separate upsert needed here).
- Returns the new balance via the existing `getWalletBalance`.
- The `type` parameter (defaulting to `'admin_credit'`) resolves an inconsistency in the original request — it named `'admin_credit'` as the log type for the general credit form, but also asked for `type: 'prize'` when crediting a free-tournament winner. Making `type` an explicit parameter (reusing `creditWallet`'s existing enum) satisfies both without a special case.
- A thin `useFormState`-compatible wrapper, `manualCreditWalletFormAction(_prev, formData)`, adapts this for form use (reads `playerId`/`amount`/`reason`/optional `type` from `FormData`, calls `manualCreditWallet`, returns `{ error }` or `{ success: true }`).
- This is additive: the existing username-based `adminCreditWallet` / `WalletCreditForm` is untouched and keeps serving the withdrawal-queue page's ad-hoc use case. The new playerId-keyed action is used by the per-wallet-row form and by the Refund button below.

### Per-row credit form
Each wallet row gets a small "Credit wallet" form (amount + reason inputs), RecomputeButton two-step confirm pattern, posting to `manualCreditWalletFormAction` with a hidden `playerId`.

### Refund button
On `/admin/tournaments/[id]/registrations`, shown per row only when the tournament's `status === 'cancelled'` and that row's `payment_status === 'paid'`. The page/query and `RegistrationsTable` gain `tournament.status`, `registration_fee`, and each row's `player_id`.

- RecomputeButton-style two-step confirm. Amount and reason are fixed (not editable in the UI), pre-filled per spec: `tournament.registration_fee`, `"Season 2 registration refund"`.
- New action `refundRegistration(_prev, formData)` in `lib/tournaments/admin-actions.ts`, `requireAdmin()`:
  1. Atomic conditional update: `tournament_registrations` `payment_status: 'paid' → 'refunded'`, `.eq('id', registrationId).eq('payment_status', 'paid')`, with `.select('id')` to detect whether the row actually matched. Same non-race pattern as waiver redemption — if the returned set is empty, someone already refunded (or the state changed) and the action returns an error rather than proceeding to credit the wallet.
  2. On success, calls `manualCreditWallet(playerId, amount, reason)` (default `type: 'admin_credit'`).
  3. `revalidatePath` the registrations page.
- Row shows "Refunded ✓" once `payment_status === 'refunded'`, replacing the button.

## Feature B — zero-fee tournament registration

### `registerForTournament` (`lib/tournaments/actions.ts`)
New branch inserted immediately after the existing waiver block and before `buildReference`/Paystack init:

```ts
if (tournament.registration_fee === 0) {
  // same insert/update shape as the waiver path, but fee_waived: false —
  // there is no fee here to waive, so this is not a waiver.
  // payment_status: 'paid', paystack_reference: null
  // redirect(`/tournaments/${tournament.slug}?paid=1`)
}
```

`fee_waived` is explicitly `false` here (not `true`): `fee_waived` means "a fee exists but was comped for this player." A zero-fee tournament has no fee to waive, so despite the practical outcome being identical (no Paystack, immediately paid), the semantic distinction from the waiver case is preserved. This branch does not read or write `tournament_fee_waivers` at all.

### UI — `RegistrationPanel.tsx` / `RegisterForm`
When `fee === 0`:
- Button label: `"Register — Free"` instead of `"Register — ₦0"` (applies to both the `guest` view's login link and the `can_register` form button).
- Subtext under the form: `"Free entry — no payment required."` instead of `"Secure payment via Paystack. Entry fee ₦0."`.
- `pendingLabel`: `"Registering…"` instead of `"Redirecting to payment…"`.

No other client-side branching is needed — same as the existing waiver flow, the server action's `redirect()` target differs (in-app success vs. Paystack authorization URL), not the client.

### Prize crediting for free tournaments
No change to prize-pool logic. For a free tournament's ₦5,000 winner prize, the admin uses the wallet-list credit form (Feature A) with `type: 'prize'`, reason `"Community tournament winner"`. Manual, not automated.

## Out of scope / explicitly not changed
- `creditWallet`'s lazy-upsert race condition (read-then-branch INSERT/UPDATE) — pre-existing, not touched by this work.
- The existing username-based `adminCreditWallet` / `WalletCreditForm` on the withdrawal-queue page.
- Any change to `tournament_fee_waivers` or the waiver redemption flow.
- Automating prize payout for free tournaments.
