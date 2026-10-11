# Mobile Phase 6a — Wallet, deposits, withdrawals, payout account

Status: design for review, 2026-10-11. Master spec §8.12 defines the screens; this spec defines the API they need. The owner approved the authorization boundary on 2026-10-11 (see "Approved boundary"). Nothing in this spec has been implemented. Written before any plan or code, per the three-tier access model (master spec §3).

## Goal

Give a signed-in player the complete `/dashboard/wallet` surface in the app: balance and pending withdrawal, earnings breakdown, transaction history, ₦ deposit through Paystack, payout-account add/remove, and withdrawal requests with their status. Payouts remain **manual, by an admin** (Paystack Transfer is not enabled); the app shows the request queue and says so. No money logic moves to Dart.

## Approved boundary

The existing signed-in web deposit, payout-account (KYC) and withdrawal flows are exposed to the **same player** through bearer-authenticated `/api/mobile/v1/*`:

1. Every request authenticates the owner; `ctx.userId` scopes every query. No player id is accepted from a body, path or query.
2. Reads return only a **masked** payout account number (`•••1234`, via the existing `maskAccountNumber`).
3. The bank account name is **resolved on the server**; the client never supplies it.
4. The endpoints reuse the existing web money and KYC services (extracted so web and mobile call one function, as 6d did with `lib/referrals/overview.ts`).
5. Deposit and withdrawal creation require an `Idempotency-Key`.
6. No BVN prompt. No new production-data write during development; write-path tests use fakes or staging only.

## Ground truth (web `main`, 2026-10-11)

| Fact | Source |
|---|---|
| Balance lives in `wallets.balance` (integer naira); the ledger is append-only `wallet_transactions` with `type`, `category`, signed `amount`, `reference_id`. No status column; only `withdrawal_request` rows take a display status from `withdrawal_requests`. | `lib/wallet/service.ts`, `transactions.ts` |
| Deposit: amount ₦100–₦100,000,000 integer; fee = `computePaystackFee(amount)`; Paystack is charged `(amount + fee) * 100` kobo; a `wallet_deposits` row (`pending`) is inserted first; credit happens in `confirmWalletDeposit` via the pending→paid claim, called by both the callback and the webhook. | `lib/wallet/deposit.ts`, `confirm.ts` |
| Withdrawal: amount ₦100–₦100,000,000 integer; requires `player_kyc.kyc_status = 'verified'` with bank name, number, name; one `pending` request per player (partial unique index, `23505`); inserts the request, then debits, and deletes the request if the debit fails; notifies staff. | `lib/wallet/actions.ts`, migration 005 |
| Payout account: `submitKyc` resolves the name via Paystack, finds the bank name in `listBanks()`, upserts `player_kyc` as `verified`, sets `profiles.kyc_verified`. `firstName`/`lastName` are required by `kycSchema` but never used. `removePayoutAccount` deletes the row and clears the flag; pending requests keep their own snapshot. | `lib/kyc/actions.ts`, `schema.ts` |
| Both money actions are blocked while the account is pending deletion (`assertNotPendingDeletion`). | `lib/settings/restriction.ts` |
| `withdrawal_requests` has no client write path (S3 lockdown); every write is service-role. `wallets`, `wallet_transactions`, `wallet_deposits`, `withdrawal_requests`, `player_kyc` are own-row readable under RLS. | migration `20260918200000_lock_down_profiles_and_write_paths.sql` |
| The mobile app already opens Paystack in a WebView (`PaystackCheckoutScreen`), treats a navigation to `/api/paystack/callback` as "done", and polls `GET /payments/{reference}` (registration only; it returns `not_found` for a deposit reference). The callback route already confirms a wallet deposit as its last fallback. | mobile `paystack_checkout.dart`; web `app/api/paystack/callback/route.ts`, `endpoints/payments.ts` |
| The web wallet page reads with the service role scoped to `user.id`; the transactions page filters `all / winnings / withdrawals / deposits` and pages by offset. `admin_note` is never shown to the player on web. | `app/[locale]/dashboard/wallet/*` |
| `account_rate_limit_events` + `hitLimit` (6e) is the per-user limiter; it fails open if the ledger is unreachable. | `lib/rate-limit/account-limiter.ts` |

## Pre-existing defect that this phase must not inherit

`debitWallet` and `creditWallet` are read-modify-write: they read `balance`, then write `balance = read ± amount`. The `.gte('balance', amount)` guard only checks the *current* row; the value written is computed from the stale read. Two concurrent writers (a prize credit landing during a withdrawal, a deposit confirm racing a withdrawal, the Paystack callback and webhook arriving together) can each write a number derived from the same old balance, so **one of them is silently lost**. A lost credit loses a player's money; a lost debit lets a withdrawal be paid twice. The one-pending-withdrawal index narrows the withdrawal–withdrawal case only. Withdrawal also inserts the request before debiting and relies on a compensating delete, and a ledger insert can fail after the balance moved.

Mobile does not create this defect but raises the number of concurrent paths (retries, background polling, a second device). See Ruling R1 and Open decision D1.

## Contract

All operations are `auth: 'user'` and live under `/api/mobile/v1/wallet`. `Idempotency-Key` is required where marked. Errors use the standard envelope; money-specific codes are listed below. Amounts are integer naira. Timestamps are ISO-8601.

| operationId | Method / path | Notes |
|---|---|---|
| `getMyWallet` | `GET /wallet` | Single overview, as the web page: `balance`, `pendingWithdrawal` (sum of pending), `earnings: { tournamentPrize, referral, bonus, tournamentPrizeTrendPct\|null }`, `recentTransactions` (5, with display `status`), `payoutAccount: { bankName, accountName, accountNumberMasked } \| null`, `kycVerified`, `activeWithdrawal: { id, amount, requestedAt } \| null`. Coin balance is **not** here; it belongs to 6b. |
| `listMyWalletTransactions` | `GET /wallet/transactions?filter=all\|winnings\|withdrawals\|deposits&cursor=` | Keyset cursor from `history-cursor.ts` (`created_at`, `id`), page size `HISTORY_PAGE_SIZE`. Same filter predicates and `mapTransactionRows` as the web page. Replaces the web's offset paging, so a new ledger row cannot shift pages. |
| `listWalletBanks` | `GET /wallet/banks` | `listBanks()` (24 h cached upstream). The sandbox test bank appears only under a test key, as on web. |
| `resolvePayoutAccount` | `POST /wallet/payout-account/resolve` | Body `{ bankCode, accountNumber }` (10 digits). Returns `{ accountName }`. Limited with `hitLimit` (10 per 15 min per user) because Paystack caps live resolves; limiter outage fails open. Errors: `validation`, `account_unresolvable`, `rate_limited` (with `retryAfterSeconds`). |
| `setPayoutAccount` | `PUT /wallet/payout-account` | Body `{ bankCode, accountNumber }` only (no names). Server resolves the name and bank name, then upserts as `submitKyc` does. Returns the masked account. Errors: `already_verified` (409, as web), `account_unresolvable`, `unknown_bank`, `payout_unavailable` (503 if Paystack fails). |
| `removePayoutAccount` | `DELETE /wallet/payout-account` | Same effect as the web action. Allowed while a withdrawal is pending (snapshot rule). |
| `startWalletDeposit` | `POST /wallet/deposits` (**idempotent**) | Body `{ amount }`. Returns `{ reference, authorizationUrl, amount, fee, total }`. Uses `ctx.email`; if the account has no email, `email_required`. Limited with `hitLimit` (10 starts per hour) so abandoned pending rows cannot be mass-created. |
| `getWalletDeposit` | `GET /wallet/deposits/{reference}` | Polls one deposit. Verifies the row belongs to `ctx.userId` first (else `not_found`, identical for unknown and foreign references), then calls `confirmWalletDeposit`. Returns `{ status: confirmed \| already_paid \| not_successful \| not_found, balance? }`. The webhook stays the source of truth; this is UI polling and is safe to repeat. |
| `requestWithdrawal` | `POST /wallet/withdrawals` (**idempotent**) | Body `{ amount }`. Bank details come from the stored payout account, never the body. Returns `{ id, amount, status: 'pending', requestedAt, payoutAccount }`. Errors: `kyc_required`, `insufficient_balance`, `withdrawal_pending` (409), `account_pending_deletion` (403), `validation`. |
| `listMyWithdrawals` | `GET /wallet/withdrawals?cursor=` | Own requests newest first: `{ id, amount, status: pending\|paid\|rejected, requestedAt, resolvedAt, payoutAccount (masked snapshot) }`. `admin_note` is **not** returned (web never shows it to the player). |

Rules common to all: the pending-deletion guard (`assertNotPendingDeletion`) runs on `startWalletDeposit`, `requestWithdrawal`, `setPayoutAccount`; error bodies never echo a full account number; logs never contain a full account number, an email, or a Paystack key. No operation accepts, returns, or logs a BVN.

### Shared services

Extract, without changing web behavior (characterization tests first, as in 6d):

- `lib/wallet/overview.ts` — `loadWalletOverview(admin, playerId)`; the web wallet page and `getMyWallet` call it.
- `lib/wallet/transactions-page.ts` — the filter predicate and row mapping shared by the transactions page and `listMyWalletTransactions`.
- `lib/wallet/deposit-service.ts` — `startDeposit(admin, { playerId, email, amount })` returning a typed result; `initiateWalletDeposit` keeps its `redirect()` shell around it.
- `lib/wallet/withdrawal-service.ts` — `submitWithdrawal(admin, { playerId, amount })` returning a typed result; `requestWalletWithdrawal` keeps its form-state shell around it. Includes the staff notification.
- `lib/kyc/payout-service.ts` — `resolvePayout`, `savePayoutAccount`, `clearPayoutAccount`; `lib/kyc/actions.ts` calls these.

Each endpoint is one route file plus one `ALL_ENDPOINTS` entry and a regenerated OpenAPI. The mobile client copies the contract byte-for-byte and adds the operations to `ApiClient.usedOperations`.

## Rulings

- **R1 — money mutations become atomic before mobile can reach them.** Recommended (needs owner approval, D1): one Postgres function per mutation, executed by the service role — `wallet_apply(player, delta, type, reference, note, category)` doing `UPDATE wallets SET balance = balance + delta WHERE player_id = $1 AND balance + delta >= 0 RETURNING` and the ledger insert in the **same transaction**; and `wallet_request_withdrawal(player, amount, bank snapshot)` doing the pending-row insert and the debit in one transaction. `creditWallet`/`debitWallet` become thin callers, so web, prizes, referrals and deposits all gain the fix. Cost if wrong: a migration (applied to staging first, then production by the owner) and a deviation from "business logic lives in TypeScript" (the stated four-RPC convention). Alternative if declined: ship the endpoints on the current read-modify-write code and document the race as an accepted risk; money loss under concurrency then remains possible.
- **R2 — one overview read, like web and like 6d.** Cost if wrong: the screen reloads the recent list with the summary; acceptable at 5 rows.
- **R3 — keyset paging for history, not offset.** Cost if wrong: none vs. web parity; a different cursor shape than the web page's `?page=`.
- **R4 — deposit completion is confirmed by polling the owner-scoped deposit endpoint**, not by trusting the WebView navigation. The WebView only signals "the user finished or closed". Cost if wrong: a few seconds of "confirming…" while the webhook lands.
- **R5 — the app never receives a full account number after it is saved.** The user types it once; reads return masked. Cost if wrong: a player cannot see the number they saved; they can only compare the last four digits and the account name, which is the intended trade.
- **R6 — `firstName`/`lastName` are dropped from the mobile payout request.** The web requires and ignores them. Cost if wrong: if the product later compares names, the endpoint gains optional fields.
- **R7 — the API serves the same rules as web; the *app* hides the wallet from moderators.** Master spec open question 7 ("moderators get the 8a queues but never the wallet screen") is a UI decision; web allows a moderator's own wallet, so the API does not add a role check that web lacks. Cost if wrong: add `forbidden` for staff-only accounts on these operations.
- **R8 — no coin balance and no store in 6a.** Coin display on the Wallet screen arrives with 6b.
- **R9 — a money request that fails ambiguously is retried with the same key.** Idempotency replays success *and* error, so a client that changes the amount must mint a new key (mobile spec §6.3 step 6).

## Mobile design (summary; the screens get their own plan)

- Routes under the Account area: `/account/wallet` (overview), `/account/wallet/deposit`, `/account/wallet/withdraw`, `/account/wallet/transactions`, `/account/wallet/payout-account`. Add `resolveWebLink` mappings for `/dashboard/wallet/**` and the Paystack return path. Not part of the tab bar.
- Deposit: amount entry shows the server-computed fee only after `startWalletDeposit` returns (the fee function is never ported to Dart); opens the existing `PaystackCheckoutScreen`; then polls `getWalletDeposit` with backoff and a visible "confirming" state and a manual "Check again". A closed WebView leaves the pending deposit; the screen says it may still arrive.
- Withdraw: gate on `kycVerified` → payout account, amount ≤ balance, one request at a time; the status timeline reads `listMyWithdrawals`; copy states that payouts are made by an administrator, not instantly.
- Payout account: bank picker from `listWalletBanks`, 10-digit field, resolve button showing the returned account name for the player to confirm, then save. The saved account shows masked.
- Copy comes from ARB (`app_en/fr/pcm.arb`); mobile-authored keys fall back to English in Pidgin, as in 6e. Every `DateFormat` locale goes through `dateLocale()`. Screens read providers over a `WalletRepository`; none constructs an `ApiClient`. Verify 320–375 px in en/fr/pcm.
- A wallet screen never writes via PostgREST and never reads `wallets`/`wallet_transactions` directly, even though RLS allows it: balance and ledger come from the API so the web and mobile numbers cannot disagree.

## Review focus and verification limits

Tests (vitest, fakes for Paystack and Supabase): owner scoping on every query and the foreign-reference `not_found` on deposit polling; idempotency replay for deposit and withdrawal (same key → same body, no second row, no second debit); amount bounds and non-integers; `kyc_required`, `insufficient_balance`, `withdrawal_pending`, pending-deletion; the masked-number guarantee on every response; no `admin_note`; limiter exhaustion and outage; extracted services reproduce the web's current results (characterization first). If R1 is approved: concurrent-credit/debit tests against a staging database proving no lost update, and a rollback test for the withdrawal function.

Not verifiable without hardware or accounts: real Paystack checkout inside the WebView on a device, live bank resolves (daily-capped in test mode), and the manual-payout admin queue end to end. Those need a Paystack test-mode pass on **staging** plus a device pass. No production data is written or changed by this phase's development or tests.

## Open decisions for the owner

- **D1 — Approve R1 (atomic wallet functions + migration)?** Recommended: yes, before any mobile money endpoint is exposed.
- **D2 — Deposit rate limit** of 10 starts/hour/user and resolve limit of 10/15 min: acceptable?
- **D3 — Does staging have working Paystack test keys and a webhook URL pointing at the staging web deployment?** Without them the deposit confirm path can only be covered by unit tests.
