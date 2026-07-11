# #14 — KYC (BVN) + prize withdrawals via Paystack Transfer

**Date:** 2026-07-11
**Status:** Approved design
**Depends on:** existing `withdrawal_requests` table (#9, migration 005), existing
Paystack lib (`lib/paystack/server.ts`), existing webhook route
(`app/api/paystack/webhook/route.ts`), notification helper (`lib/notifications/notify.ts`)

## ⚠️ Prerequisite — must be done in the Paystack dashboard before this works

Paystack's Transfer API requires OTP confirmation on every transfer **by default**.
A server-initiated transfer will sit stuck in OTP-pending forever unless this is
turned off. Before this feature can move real money:

**Paystack Dashboard → Settings → Preferences → uncheck "Confirm transfers before
sending".**

Until that box is unchecked, `initiateTransfer` calls will appear to succeed (the
transfer is created) but never settle — no `transfer.success` webhook will ever
arrive, and the withdrawal will sit in `processing` indefinitely. This is
dashboard configuration, not something the code can do. Flagging here so it isn't
mistaken for a bug during testing.

## Summary

Upgrade the existing manual withdrawal flow (admin wires money by hand, then
self-reports "paid") into a real Paystack-automated payout, gated behind one-time
BVN identity verification. Concretely:

1. A player verifies their identity once: picks their bank, enters their account
   number (auto-resolved to a name via Paystack), and their BVN. Paystack validates
   the BVN against that bank account asynchronously.
2. Once verified, that bank account becomes the player's permanent payout account.
   Withdrawal requests only ask for an amount.
3. Admin still reviews and approves each request (the fraud checkpoint stays) —
   but clicking "Pay" now fires a real Paystack Transfer instead of the admin
   manually sending money and self-certifying.
4. A transfer's actual settlement (`transfer.success` / `transfer.failed` /
   `transfer.reversed`) is confirmed asynchronously via the existing Paystack
   webhook route, extended with two new event handlers.

**Note on scope vs. CLAUDE.md:** CLAUDE.md currently says "KYC required before
first withdrawal (BVN or NIN via Paystack)". Paystack's identity verification API
only supports `type: "bank_account"` today — it validates a BVN against a bank
account, and NIN is not a valid identifier type on that endpoint. This design
implements BVN-only verification; CLAUDE.md will be updated to match as part of
this work (see Out of scope / follow-ups).

## Data model

### `profiles` — add KYC + payout columns (new migration `014_kyc_withdrawals.sql`)

| Column | Type | Notes |
|---|---|---|
| `kyc_status` | text | `unverified` (default) \| `pending` \| `verified` \| `failed`; CHECK-constrained |
| `kyc_failure_reason` | text | nullable; last failure reason from Paystack, shown to player on retry |
| `kyc_verified` | boolean | **already exists** (migration 001, default `false`). Kept as an explicit convenience flag — see "Why keep both" below |
| `paystack_customer_code` | text | nullable; Paystack Customer object, created on first KYC attempt, reused on retry |
| `paystack_recipient_code` | text | nullable; Paystack Transfer Recipient, created once BVN verification succeeds; durable — reused for every future withdrawal |
| `payout_bank_code` | text | nullable; snapshot of the verified bank, set on verification success |
| `payout_bank_name` | text | nullable; snapshot (display only) |
| `payout_account_number` | text | nullable; snapshot |
| `payout_account_name` | text | nullable; snapshot — the Paystack-resolved name, not player-typed |

**BVN itself is never stored.** It is read from the KYC form submission, sent
directly to Paystack in the identification API call, and discarded — it never
appears in any INSERT/UPDATE statement or column. This must stay true through any
future changes to this flow; do not add a `bvn` column "for retry convenience."

**Why keep both `kyc_status` and `kyc_verified`:** `kyc_status` carries the full
state machine (`pending`/`failed` matter for UI branching); `kyc_verified` is a
simple boolean any other part of the codebase can check without knowing the state
machine (e.g. a future eligibility check elsewhere). The webhook handler that sets
`kyc_status = 'verified'` sets `kyc_verified = true` in the **same UPDATE
statement** — no trigger, no computed column, no second write. Same discipline in
reverse is not needed: once verified, `kyc_verified` does not need to be unset by
this feature (see the admin reset action below for the one path that changes it).

### `withdrawal_requests` — extend for automated payout

- Extend `status` CHECK: `pending | processing | paid | rejected | failed`
  (was `pending | paid | rejected`).
- Add `paystack_transfer_code` (text, nullable) and `paystack_transfer_reference`
  (text, nullable) — set when admin clicks "Pay" (initiate transfer call).
- `bank_name` / `account_number` / `account_name` columns are **kept** (no schema
  removal) but are now populated by copying the player's verified
  `payout_*` snapshot at request-insert time, not typed by the player. This
  preserves a point-in-time record on the request even if the player's verified
  account changes later.

**Status lifecycle:** `pending` (player submitted) → admin clicks Pay →
`processing` (transfer initiated, awaiting webhook) → webhook resolves to `paid`
(success) or `failed` (transfer.failed / transfer.reversed). Admin may still
`reject` a `pending` request directly (no Paystack call, unchanged from today).
From `failed`, admin can retry (re-run the same "Pay" action — it reuses the
durable `paystack_recipient_code`, no re-verification needed) which moves it back
to `processing`.

The partial unique index "one pending per player" (migration 005) is updated to
cover both `pending` and `processing` — a player should not be able to file a
second request while one is actively being paid out.

## Components

### `lib/paystack/server.ts` — new functions

All server-only (existing file convention). Extends the module with the pieces
`lib/paystack/index.ts`'s `PAYSTACK_BASE_URL` already anchors:

- `listBanks(): Promise<{ name: string; code: string }[]>` — `GET /bank?country=nigeria&currency=NGN&type=nuban`. Cached via Next.js `fetch` with `next: { revalidate: 86400 }` (bank list changes rarely).
- `resolveAccount(accountNumber, bankCode): Promise<{ accountName: string }>` — `GET /bank/resolve?account_number=...&bank_code=...`. Surfaces a friendly error if the account can't be resolved (typo'd number, wrong bank).
- `createCustomer(email, firstName, lastName): Promise<string>` — `POST /customer`, returns `customer_code`. Idempotent-safe: if the profile already has a `paystack_customer_code`, reuse it instead of creating a duplicate.
- `submitBvnIdentification(params): Promise<void>` — `POST /customer/{code}/identification` with `{ country: 'NG', type: 'bank_account', bvn, bank_code, account_number, first_name, last_name }`. Fire-and-forget from our side — result comes back via webhook, not the HTTP response (Paystack acks with 202-style "in progress").
- `createTransferRecipient(params): Promise<string>` — `POST /transferrecipient` with `{ type: 'nuban', name: accountName, account_number, bank_code, currency: 'NGN' }`, returns `recipient_code`.
- `initiateTransfer(params): Promise<{ transferCode: string; reference: string }>` — `POST /transfer` with `{ source: 'balance', amount: amountKobo, recipient: recipientCode, reason, reference }`.

### `lib/kyc/` — new module

- `schema.ts` — `kycSchema`: `bankCode` (non-empty), `accountNumber` (10-digit
  regex, matches existing withdrawal schema pattern), `bvn` (11-digit regex),
  `firstName`/`lastName` (non-empty, matches existing field conventions).
- `actions.ts`:
  - `resolveAccountName(bankCode, accountNumber)` — thin server action wrapping
    `resolveAccount`, called on blur from the client form to populate the
    read-only resolved name before final submit.
  - `submitKyc(prevState, formData)` — server action: validates input, ensures/creates
    the Paystack customer, calls `submitBvnIdentification`, sets
    `kyc_status = 'pending'` on the profile. Does **not** touch `bvn` in any DB
    write.
  - `resetKycForPlayer(playerId)` — **admin-only** server action (`requireAdmin()`
    guard, same pattern as `resolveWithdrawal`). Resets `kyc_status =
    'unverified'`, `kyc_verified = false`, clears `paystack_recipient_code` and the
    `payout_*` snapshot columns. No UI for this yet — it's a lever for support to
    pull (e.g. via a one-off SQL-free admin action, callable from a future admin
    screen or, for now, invoked directly if a player is stuck with a bad/changed
    bank account and needs to re-verify). Exists so there's a recovery path from day
    one instead of a stuck player with no lever.

### `components/dashboard/WithdrawalPanel.tsx` — branch on `kyc_status`

- `unverified` / `failed` → render `KycForm` (bank dropdown from `listBanks()`,
  account number input, resolve-on-blur read-only name, BVN input, submit). On
  `failed`, show `kyc_failure_reason` above the form.
- `pending` → static "Verification in progress — usually completes within a few
  minutes" message, no form (mirrors the existing "request pending" pattern already
  in this component for withdrawal requests).
- `verified` → existing withdrawal form, trimmed to just the amount field; the
  verified payout account renders read-only above it ("Paid to: {bank_name}
  •••{last 4 of account_number} {account_name}").

### `app/admin/withdrawals/page.tsx` + `WithdrawalQueueRow.tsx`

No structural change to the page. `WithdrawalQueueRow`'s "Mark paid" button now
calls the updated `resolveWithdrawal` action (below) instead of a simple status
flip. A `failed` withdrawal shows in the queue (alongside `pending`) with its
`admin_note` (failure reason) visible and a "Retry payout" button that re-submits
the same action.

### `lib/withdrawals/admin-actions.ts` — `resolveWithdrawal` rewrite

For `action === 'paid'` (renamed conceptually to "initiate payout", same wire
value for minimal diff):
1. `requireAdmin()` (unchanged).
2. Load the withdrawal row + the player's `paystack_recipient_code`. Missing
   recipient code → error (shouldn't happen since requests can only be filed by
   `verified` players, but defensive).
3. Call `initiateTransfer({ amountKobo: amount * 100, recipientCode, reason:
   'SentinelX prize withdrawal', reference: buildTransferReference(id) })`.
4. On success: update the row to `status: 'processing'`,
   `paystack_transfer_code`, `paystack_transfer_reference`. Do **not** send the
   `prize_credited` notification yet — that fires from the webhook on confirmed
   settlement.
5. On Paystack API error: leave status as-is (`pending` or `failed`), return the
   error to the admin UI. No partial state written.

`action === 'rejected'` path is unchanged.

### `app/api/paystack/webhook/route.ts` — two new event handlers

Existing route already verifies `x-paystack-signature` and handles
`charge.success`. Add:

- **`customeridentification.success`**: payload includes the `customer_code`.
  Look up the profile by `paystack_customer_code`. Idempotent (no-op if already
  `verified`). The `payout_*` columns already hold the bank details from the
  `submitKyc` call (written provisionally at `pending` time — see Assumptions),
  so this handler just needs one UPDATE: `kyc_status = 'verified'`,
  `kyc_verified = true`. Then call `createTransferRecipient` using those
  `payout_*` columns and store the result as `paystack_recipient_code`.
- **`customeridentification.failed`**: look up by `customer_code`, idempotent
  (no-op if already `failed` with the same reason). Set `kyc_status = 'failed'`,
  `kyc_failure_reason` from the event payload's reason field.
- **`transfer.success`**: look up `withdrawal_requests` by
  `paystack_transfer_reference`. Idempotent (no-op if already `paid`). Set
  `status = 'paid'`, `resolved_at = now()`, fire the existing `prize_credited`
  notification (same call already present in `resolveWithdrawal` today, just
  moved to fire from here instead).
- **`transfer.failed`** / **`transfer.reversed`**: look up the same way.
  Idempotent. Set `status = 'failed'`, `admin_note` from the event's failure
  reason (visible in the admin queue, drives the "Retry payout" affordance).

All four handlers follow the existing route's pattern: verify signature once at
the top (already done), parse event type, dispatch, always return `200` on a
well-formed signed request (Paystack retries non-2xx).

## Security

- BVN never persisted (see Data model). Sent to Paystack over HTTPS in the
  identification call body, never written to a column, never logged.
- Webhook signature verification reused as-is (`verifyWebhookSignature`,
  HMAC-SHA512, timing-safe compare) — already covers the new event types since
  it's the same route.
- Payout account is Paystack-resolved, not player-typed — the account name shown
  and stored is what Paystack's `/bank/resolve` returns, not user input,
  preventing a fat-fingered account number from silently paying the wrong person.
- Admin approval remains a required checkpoint before any transfer fires — the
  automation only removes the *manual bank transfer + self-report* step, not
  the review step.
- `resetKycForPlayer` is admin-gated (`requireAdmin()`), same as all other
  financial admin actions in this codebase.
- Transfer amount is server-computed from the `withdrawal_requests.amount`
  column (already validated at request time, 1,000–100,000,000 NGN), never from
  a client-supplied value on the admin action.

## Assumptions

- **Paystack account is business-verified for Transfers.** Paystack requires
  KYB (Know Your Business) approval before the Transfer API is usable at all —
  this is an account-level prerequisite outside this codebase's control,
  assumed already true or in progress.
- **Threading pending-KYC form data to the webhook handler:** the identification
  webhook payload does not echo back the bank/account details the player
  submitted (only `customer_code` + validation result). The design stores the
  submitted bank details on the profile at `submitKyc` time under
  `kyc_status = 'pending'` (in the same `payout_*` columns, provisionally) rather
  than in a separate side table — the webhook handler then just flips the status
  rather than needing to look the data up elsewhere. If verification fails, those
  provisional columns are overwritten on the next attempt (they're not
  authoritative until `kyc_status = 'verified'`).
- **Paystack transfer `source: 'balance'`** assumes the SentinelX Paystack
  account is funded (from collected registration fees / manual top-up) — funding
  the balance is an operational concern, not something this code manages.

## Out of scope (keeping #14 tight)

- No UI for changing a verified payout account after the fact — the seam for
  that is `resetKycForPlayer` (admin-invoked, no dedicated screen yet). A
  self-service "change my bank account" flow is a future follow-up if it turns
  out to be needed often.
- No NIN support (Paystack API constraint — see Summary). CLAUDE.md's Payments
  section line "KYC required before first withdrawal (BVN or NIN via Paystack)"
  is updated to "KYC required before first withdrawal (BVN via Paystack,
  validated against the payout bank account)" as part of this work.
- No bulk transfers / batch payout UI — one transfer per admin "Pay" click,
  matching today's one-row-at-a-time admin queue UX.
- No retry backoff/scheduling automation for `failed` transfers — retry is a
  manual admin click.

## Testing

- Unit: `lib/kyc/schema.ts` validation (BVN must be 11 digits, account number 10
  digits, etc.), mirroring the existing `withdrawal_requests/schema.test.ts`
  pattern.
- Unit: `submitKyc` — unauth guard, reuses existing `paystack_customer_code`
  instead of creating a duplicate customer, never includes `bvn` in any Supabase
  `.insert()`/`.update()` call (assert on the mocked client call args).
- Unit: `resolveWithdrawal` — missing `paystack_recipient_code` errors cleanly;
  successful initiate sets `processing` + transfer code/reference; Paystack API
  error leaves status unchanged.
- Unit: webhook route — all four new event types: idempotency (repeat event is a
  no-op), correct state transition, `customeridentification.success` creates the
  transfer recipient exactly once.
- Unit: `resetKycForPlayer` — admin guard enforced, clears exactly the documented
  columns.
- Migration verified against the live schema (new `profiles` columns, extended
  `withdrawal_requests` status CHECK, updated partial unique index covering
  `pending`+`processing`) via rolled-back SQL, matching the existing migration
  verification pattern.
- `npx tsc --noEmit` + `npm run build` clean before push.
