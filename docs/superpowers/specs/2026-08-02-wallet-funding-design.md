# Wallet funding (Paystack top-up)

## Problem

Players have no way to add their own money to their SentinelX wallet. The wallet
today only grows via prize payouts, referral credits, friendly-match stakes, and
admin manual credits (`lib/wallet/service.ts`, `lib/wallet/admin-actions.ts`). This
matters now because betting (`lib/betting/`) debits the wallet directly, and a
player who runs out of balance mid-season currently has no self-serve way to top up
— only an admin can credit them.

This is the second of three related-but-independent features requested together
(admin listing management — shipped; wallet funding — this spec; buy-requests next).

## Current state (relevant facts)

- Paystack is already integrated for tournament registration fees, via a
  **server-side redirect** flow (not an inline popup) — no Paystack JS SDK is used
  anywhere in the codebase today, and `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` is unused.
- `lib/paystack/server.ts`: `initializeTransaction({ email, amountKobo, reference,
  callbackUrl, metadata? }): Promise<string>` POSTs to Paystack and returns
  `authorization_url`, which the caller `redirect()`s to.
  `verifyWebhookSignature(rawBody, signature)` does HMAC-SHA512 + timing-safe
  compare. `verifyTransaction(reference)` does a server-to-server GET to confirm a
  payment before trusting it.
- `lib/tournaments/confirm.ts`'s `confirmRegistration(reference)` is the reference
  implementation for the "verify and credit, idempotently" pattern: look up the
  pending row by reference (never trust the client) → re-derive the expected amount
  from a server-owned value (never a client-supplied one) → verify with Paystack →
  conditionally `UPDATE ... WHERE status = 'pending'` so concurrent webhook +
  browser-callback calls can't double-apply.
- `app/api/paystack/webhook/route.ts` handles `charge.success` by calling
  `confirmRegistration(reference)`, falling back to `confirmFriendlyStake(reference)`
  on a `'not_found'` result (dispatch by trying each confirm function in turn, not
  by an explicit type in metadata).
- `app/api/paystack/callback/route.ts` is the same fallback chain, triggered by
  Paystack redirecting the player's browser back — cosmetic only, the webhook is
  the trusted source of truth.
- `lib/wallet/service.ts` exports `creditWallet(admin, playerId, amount, type,
  referenceId, note?)` and `debitWallet(...)`. **`wallet_transactions.reference_id`
  is a `uuid` column** — it cannot hold a Paystack text reference directly, which is
  why the registration flow keeps its own `paystack_reference text` column on
  `tournament_registrations` rather than trying to stuff it into the wallet ledger.
- `wallet_transactions.type` CHECK (`042_match_betting.sql`) currently allows:
  `'prize', 'referral', 'friendly_stake', 'admin_credit', 'withdrawal_request',
  'withdrawal_reversal', 'bet_stake', 'bet_payout', 'bet_refund'`.
- `lib/wallet/schema.ts`'s `walletWithdrawalSchema` sets a ₦100 minimum, ₦100,000,000
  maximum — the deposit minimum should match.
- `components/match/BettingPanel.tsx:64` renders `state.error` from `placeBet`
  (`lib/betting/actions.ts`, which calls `debitWallet`) with no further action —
  this is the only other player-facing flow that can hit "Insufficient wallet
  balance." (withdrawal's `debitWallet` call is not a "spend" flow, so it's out of
  scope here).

## Design

### New table: `wallet_deposits`

```sql
CREATE TABLE public.wallet_deposits (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id         uuid        NOT NULL REFERENCES public.profiles(id),
  amount            integer     NOT NULL,  -- NGN credited to the wallet on success
  fee               integer     NOT NULL,  -- NGN surcharge the player also pays
  paystack_reference text       NOT NULL UNIQUE,
  status            text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
```

Exists for the same reason `tournament_registrations.paystack_reference` does:
`wallet_transactions.reference_id` is a uuid, so a Paystack text reference needs its
own row to live on, and `creditWallet`'s `referenceId` then points at
`wallet_deposits.id` (matching how a `prize` credit points at `tournament_id` and a
`bet_payout` credit points at `bet.id`).

RLS: player can `SELECT` their own rows; no client `INSERT`/`UPDATE` policy — writes
happen only via the service-role client from the server action and the
confirm/webhook path, same as `marketplace_orders`.

### Fee formula

A pure function, e.g. `computePaystackFee(amountNgn: number): number` in
`lib/paystack/fees.ts`:
- `1.5%` of the amount, `+ ₦100` unless the amount is under `₦2,500` (fee waived),
  capped at `₦2,000` total.
- This is Paystack's standard published Nigeria rate. If the actual account has a
  negotiated custom rate, this one function is the single place to correct it later
  — flagged explicitly since getting it wrong either overcharges players or has the
  platform silently eat the difference.

### Server actions — `lib/wallet/deposit.ts`

**`initiateWalletDeposit(_prev, formData)`** (form action, `walletDepositSchema` —
new zod schema mirroring `walletWithdrawalSchema`'s ₦100 minimum):
1. Auth check (any logged-in player, no staff gate).
2. Validate `amount` (min ₦100).
3. `fee = computePaystackFee(amount)`; `totalKobo = (amount + fee) * 100`.
4. Insert a `pending` `wallet_deposits` row with a fresh reference from
   `buildWalletDepositReference(playerId)` (new function in `lib/paystack/server.ts`,
   prefix `sxdep_`, mirroring `buildReference`/`buildFriendlyStakeReference`).
5. `initializeTransaction({ email, amountKobo: totalKobo, reference, callbackUrl })`.
6. `redirect(authorizationUrl)`.

**`confirmWalletDeposit(reference): Promise<ConfirmResult>`**, where
`ConfirmResult = 'confirmed' | 'already_paid' | 'not_found' | 'not_successful'` —
exactly `lib/tournaments/confirm.ts`'s `ConfirmResult` shape, called by both the
webhook and the callback route. Split into a pure decision function
(`decideDepositConfirmation`, unit tested directly, mirroring `decideConfirmation`)
and the IO-performing `confirmWalletDeposit` wrapper (untested, matches this
codebase's thin-wrapper convention):
1. Look up the `wallet_deposits` row by `paystack_reference`; `'not_found'` if none
   (lets the webhook's fallback chain move to the next confirm function).
2. If found and already `'paid'`, `'already_paid'` (benign no-op — both the webhook
   and the callback call this for the same reference by design).
3. `verifyTransaction(reference)` — server-to-server ground truth.
4. `decideDepositConfirmation({ existing, verify, expectedKobo: (amount + fee) *
   100 })` — `'not_successful'` unless `verify.status === 'success'` and
   `verify.amountKobo >= expectedKobo` (same overpayment-tolerant /
   underpayment-rejecting rule as `decideConfirmation`).
5. On `'confirmed'`: conditional `UPDATE wallet_deposits SET status = 'paid' WHERE
   paystack_reference = $1 AND status = 'pending'` — only the call that actually
   flips the row credits the wallet, so a webhook/callback race can't double-credit.
6. On the row that won the flip: `creditWallet(admin, playerId, amount, 'deposit',
   depositRow.id, 'Wallet top-up via Paystack')` — credits only `amount`, not
   `amount + fee` (the fee portion isn't wallet balance, it went to Paystack).
7. Best-effort `notifyInApp` (`wallet_credited` type already exists — reused, no new
   notification type needed).

### Wiring into existing infra

- `app/api/paystack/webhook/route.ts`: extend the existing
  `confirmRegistration` → `confirmFriendlyStake` fallback chain with
  `confirmWalletDeposit` as a third `'not_found'` fallback.
- `app/api/paystack/callback/route.ts`: same fallback chain; on a deposit reference,
  redirect to `/dashboard?deposit=paid` or `/dashboard?deposit=failed` (mirrors the
  tournament callback's `?paid=1` pattern).
- Migration: add `'deposit'` to `wallet_transactions.type` CHECK (full
  drop-and-recreate, matching every prior migration touching this constraint) and to
  the `WalletTxnType` TS union in `lib/wallet/service.ts`.

### UI

- `components/dashboard/WalletPanel.tsx`: new "Fund wallet" section — amount input
  (min ₦100, same shape as the existing withdrawal form), showing the computed fee
  and total before submit (e.g. "You'll pay ₦1,038 total — ₦1,000 to your wallet +
  ₦38 fee"), submitting to `initiateWalletDeposit`. Button pending-label:
  "Redirecting to payment…" (matches `RegistrationPanel.tsx`'s convention).
- `components/match/BettingPanel.tsx`: when `state.error` is the insufficient-balance
  message, render a "Fund wallet →" link to `/dashboard` next to the error at line
  64, instead of a dead-end error message.
- `app/dashboard/page.tsx`: read `?deposit=paid`/`?deposit=failed` and show a
  confirmation/error banner (mirrors how the tournament page handles `?paid=1`).

## Out of scope

- Preset/quick-tap amount buttons — free-form entry only.
- Surfacing a "fund wallet" prompt anywhere other than the wallet panel and the
  betting flow (e.g. friendly-match staking doesn't currently debit the wallet in
  this codebase, so it has nothing to prompt from).
- Refunds of a wallet deposit (distinct from a withdrawal — a deposit, once
  credited, is just wallet balance; no separate "deposit refund" flow is being
  built).
- Changing how withdrawals work.

## Testing

- Unit tests for `computePaystackFee`: below-₦2,500 waives the flat fee, at/above
  applies 1.5% + ₦100, caps at ₦2,000.
- Unit tests for `decideDepositConfirmation` (mirroring `decideConfirmation`'s test
  shape): success+sufficient-amount confirms, success+underpaid rejects,
  failed-status rejects, missing-row returns not_found, already-paid row returns
  already_paid.
- No unit test for `initiateWalletDeposit` or `confirmWalletDeposit` themselves
  (thin IO wrappers, matches this codebase's established convention — see the
  admin-listing-management plan's note on this).
- Manual check: fund a real test amount through Paystack's test-mode checkout,
  confirm wallet balance increases by exactly the typed amount (not
  amount+fee), confirm the webhook and callback both handle it without double-
  crediting (check `wallet_transactions` has exactly one `'deposit'` row per
  successful payment).
