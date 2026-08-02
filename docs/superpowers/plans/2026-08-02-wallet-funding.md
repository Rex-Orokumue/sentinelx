# Wallet Funding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a player top up their own wallet balance via Paystack, paying the transaction fee on top, with a "Fund wallet" entry point on the wallet panel and inline on the betting flow when a bet fails for insufficient balance.

**Architecture:** A new `wallet_deposits` table tracks each Paystack attempt (mirrors how `tournament_registrations.paystack_reference` tracks registration payments — `wallet_transactions.reference_id` is a `uuid` column and can't hold a Paystack text reference directly). A new `lib/wallet/deposit.ts` server action inserts a pending row and redirects to Paystack's hosted checkout (same server-redirect pattern as tournament registration — no client-side Paystack SDK). A new `lib/wallet/confirm.ts` provides the idempotent "verify with Paystack and credit" step, called from both `app/api/paystack/webhook/route.ts` and `app/api/paystack/callback/route.ts` as a third fallback after the existing tournament/friendly-match confirm attempts — exactly mirroring `lib/tournaments/confirm.ts` and `lib/friendly-matches/confirm.ts`'s shape (a pure `decide*Confirmation` function unit-tested in isolation, plus a thin IO wrapper that isn't unit tested, per this codebase's established convention).

**Tech Stack:** Next.js 14 Server Components + Server Actions, Supabase (Postgres + RLS), Paystack REST API, Vitest.

## Global Constraints

- Server-side redirect flow only — no Paystack inline popup/SDK, matching every existing Paystack integration in this codebase.
- Deposit minimum is ₦100 (matches `walletWithdrawalSchema`'s floor in `lib/wallet/schema.ts`).
- The player pays Paystack's fee on top: `computePaystackFee(amountNgn)` = `1.5% + ₦100` (the ₦100 waived under ₦2,500), capped at `₦2,000`. This is Paystack's standard published Nigeria rate, not a confirmed rate on this specific account — flagged as the one place to correct if the account's actual negotiated rate differs.
- The wallet is credited with exactly the amount the player typed — never `amount + fee` (the fee portion is not wallet balance).
- Every write to `wallets`/`wallet_transactions` goes through `lib/wallet/service.ts`'s `creditWallet`, called with the service-role client (`createAdminClient()`), matching every other caller of `creditWallet`.
- Confirmation is never trusted from the client or from the browser callback alone — `confirmWalletDeposit` always re-verifies with Paystack server-to-server (`verifyTransaction`) before crediting, and only the request that flips `wallet_deposits.status` from `pending` to `paid` (a conditional `UPDATE ... WHERE status = 'pending'`) performs the credit, so a webhook/callback race can't double-credit.
- No unit tests for thin server-action/IO wrappers (`initiateWalletDeposit`, `confirmWalletDeposit` itself) — matches this codebase's established convention (see `lib/tournaments/confirm.ts`'s split of `decideConfirmation` (tested) vs `confirmRegistration` (not tested), and the admin-listing-management plan's note on this). Pure decision/formula functions (`computePaystackFee`, `decideDepositConfirmation`, `buildWalletDepositReference`) are unit tested.

---

### Task 1: `wallet_deposits` table + `wallet_transactions` type extension

**Files:**
- Create: `supabase/migrations/044_wallet_deposits.sql`
- Modify: `lib/wallet/service.ts:4-13`

**Interfaces:**
- Produces: `public.wallet_deposits` table (`id, player_id, amount, fee, paystack_reference, status, created_at, updated_at`); `WalletTxnType` now includes `'deposit'`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/044_wallet_deposits.sql`:

```sql
-- 044_wallet_deposits.sql
-- Tracks a player's Paystack wallet top-up attempts. wallet_transactions.
-- reference_id is a uuid FK-shaped column and can't hold a Paystack text
-- reference directly, so — mirroring how tournament_registrations carries
-- its own paystack_reference column — this table exists as the thing
-- creditWallet's referenceId points at (wallet_deposits.id), not the
-- Paystack reference itself.
-- See docs/superpowers/plans/2026-08-02-wallet-funding.md.

CREATE TABLE public.wallet_deposits (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id          uuid        NOT NULL REFERENCES public.profiles(id),
  amount             integer     NOT NULL,  -- NGN credited to the wallet on success
  fee                integer     NOT NULL,  -- NGN surcharge the player also pays
  paystack_reference text        NOT NULL UNIQUE,
  status             text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON public.wallet_deposits (player_id);

CREATE TRIGGER set_wallet_deposits_updated_at
  BEFORE UPDATE ON public.wallet_deposits
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.wallet_deposits ENABLE ROW LEVEL SECURITY;

-- Player reads their own deposit history; staff can read all. No client
-- INSERT/UPDATE/DELETE policy — every write goes through the service-role
-- client from the deposit action and the Paystack confirm path, same as
-- marketplace_orders.
CREATE POLICY "wd_select" ON public.wallet_deposits
  FOR SELECT USING (auth.uid() = player_id OR public.is_staff());

-- Extend wallet_transactions.type for the new 'deposit' ledger entries.
ALTER TABLE public.wallet_transactions DROP CONSTRAINT wallet_transactions_type_check;
ALTER TABLE public.wallet_transactions ADD CONSTRAINT wallet_transactions_type_check
  CHECK (type IN (
    'prize', 'referral', 'friendly_stake', 'admin_credit',
    'withdrawal_request', 'withdrawal_reversal',
    'bet_stake', 'bet_payout', 'bet_refund',
    'deposit'
  ));
```

- [ ] **Step 2: Apply the migration**

Run: `npx supabase db push`

If the CLI hangs (known Windows connectivity gotcha — a schannel TLS check can hang for extended periods even though the project's Supabase MCP tools still work), apply it via the `mcp__claude_ai_Supabase__apply_migration` MCP tool instead (project id `itxubrkbropttfdackmi`, name `044_wallet_deposits`, body = the SQL from Step 1).

- [ ] **Step 3: Extend the `WalletTxnType` union**

In `lib/wallet/service.ts`, change:

```ts
export type WalletTxnType =
  | 'prize'
  | 'referral'
  | 'friendly_stake'
  | 'admin_credit'
  | 'withdrawal_request'
  | 'withdrawal_reversal'
  | 'bet_stake'
  | 'bet_payout'
  | 'bet_refund'
```

to:

```ts
export type WalletTxnType =
  | 'prize'
  | 'referral'
  | 'friendly_stake'
  | 'admin_credit'
  | 'withdrawal_request'
  | 'withdrawal_reversal'
  | 'bet_stake'
  | 'bet_payout'
  | 'bet_refund'
  | 'deposit'
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/044_wallet_deposits.sql lib/wallet/service.ts
git commit -m "feat(wallet): add wallet_deposits table and deposit transaction type"
```

---

### Task 2: Paystack fee formula

**Files:**
- Create: `lib/paystack/fees.ts`
- Test: `lib/paystack/fees.test.ts`

**Interfaces:**
- Produces: `computePaystackFee(amountNgn: number): number`, consumed by Task 5's deposit action.

- [ ] **Step 1: Write the failing test**

Create `lib/paystack/fees.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { computePaystackFee } from './fees'

describe('computePaystackFee', () => {
  it('waives the flat ₦100 fee under ₦2,500', () => {
    expect(computePaystackFee(1000)).toBe(15) // 1.5% of 1000 = 15, no flat fee
  })

  it('charges 1.5% + ₦100 at or above ₦2,500', () => {
    expect(computePaystackFee(2500)).toBe(138) // 37.5 + 100 = 137.5 -> rounds to 138
  })

  it('caps the fee at ₦2,000 for large amounts', () => {
    expect(computePaystackFee(200_000)).toBe(2000) // 3000 + 100 = 3100, capped at 2000
  })

  it('rounds to the nearest whole naira', () => {
    expect(computePaystackFee(10_000)).toBe(250) // 150 + 100 = 250, already whole
  })

  it('returns 0 for a zero amount', () => {
    expect(computePaystackFee(0)).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/paystack/fees.test.ts`
Expected: FAIL — `Cannot find module './fees'`

- [ ] **Step 3: Write the implementation**

Create `lib/paystack/fees.ts`:

```ts
// Paystack's standard published Nigeria rate: 1.5% of the amount, plus a
// flat ₦100 that's waived for amounts under ₦2,500, capped at ₦2,000
// total. This is the DEFAULT published rate — if this Paystack account has
// a negotiated custom rate, this is the one place to correct it.
const PERCENTAGE_RATE = 0.015
const FLAT_FEE_NGN = 100
const FLAT_FEE_WAIVED_BELOW_NGN = 2500
const FEE_CAP_NGN = 2000

export function computePaystackFee(amountNgn: number): number {
  const percentageFee = amountNgn * PERCENTAGE_RATE
  const flatFee = amountNgn < FLAT_FEE_WAIVED_BELOW_NGN ? 0 : FLAT_FEE_NGN
  const fee = Math.round(percentageFee + flatFee)
  return Math.min(fee, FEE_CAP_NGN)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/paystack/fees.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/paystack/fees.ts lib/paystack/fees.test.ts
git commit -m "feat(paystack): add wallet deposit fee formula"
```

---

### Task 3: Deposit Paystack reference builder

**Files:**
- Modify: `lib/paystack/server.ts`
- Modify: `lib/paystack/server.test.ts`

**Interfaces:**
- Produces: `buildWalletDepositReference(playerId: string): string`, consumed by Task 5's deposit action.

- [ ] **Step 1: Add the failing test**

In `lib/paystack/server.test.ts`, add `buildWalletDepositReference` to the existing import (line 4-11 becomes):

```ts
import {
  buildReference,
  buildWalletDepositReference,
  verifyWebhookSignature,
  buildIdentificationPayload,
  buildRecipientPayload,
  buildTransferPayload,
  buildTransferReference,
  isTestModeKey,
} from './server'
```

Then add this new `describe` block after the existing `buildReference` block (after line 29):

```ts
describe('buildWalletDepositReference', () => {
  it('is prefixed and encodes the truncated player id', () => {
    const ref = buildWalletDepositReference('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    expect(ref).toMatch(/^sxdep_aaaaaaaa_[a-z0-9]{8}$/)
  })

  it('produces distinct references on repeat calls', () => {
    expect(buildWalletDepositReference('u')).not.toBe(buildWalletDepositReference('u'))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/paystack/server.test.ts`
Expected: FAIL — `buildWalletDepositReference is not a function` (or similar import error)

- [ ] **Step 3: Add the implementation**

In `lib/paystack/server.ts`, add this function right after `buildFriendlyStakeReference` (after line 23):

```ts
export function buildWalletDepositReference(playerId: string): string {
  const u = playerId.replace(/-/g, '').slice(0, 8)
  const rand = Math.random().toString(36).slice(2, 10).padEnd(8, '0')
  return `sxdep_${u}_${rand}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/paystack/server.test.ts`
Expected: PASS (all tests in the file, including the 2 new ones)

- [ ] **Step 5: Commit**

```bash
git add lib/paystack/server.ts lib/paystack/server.test.ts
git commit -m "feat(paystack): add wallet deposit reference builder"
```

---

### Task 4: Deposit amount schema + confirm decision logic

**Files:**
- Modify: `lib/wallet/schema.ts`
- Create: `lib/wallet/confirm.ts`
- Test: `lib/wallet/confirm.test.ts`

**Interfaces:**
- Produces: `walletDepositSchema` (zod, `{ amount: number }`, min ₦100); `WalletDepositConfirmResult = 'confirmed' | 'already_paid' | 'not_found' | 'not_successful'`; `decideDepositConfirmation(args): WalletDepositConfirmResult` (pure, tested); `confirmWalletDeposit(reference): Promise<WalletDepositConfirmResult>` (IO wrapper, consumed by Task 6's webhook/callback routes).
- Consumes: `verifyTransaction` from `@/lib/paystack/server`; `createAdminClient` from `@/lib/supabase/admin`; `creditWallet` from `./service`; `notifyInApp` from `@/lib/notifications/inbox`; `formatNaira` from `@/lib/format`.

- [ ] **Step 1: Add the deposit schema**

In `lib/wallet/schema.ts`, add after the existing `walletWithdrawalSchema`:

```ts
export const walletDepositSchema = z.object({
  amount: z.coerce
    .number()
    .int('Amount must be a whole number of naira')
    .min(100, 'Minimum top-up is ₦100')
    .max(100_000_000, 'Amount is too large'),
})

export type WalletDepositInput = z.infer<typeof walletDepositSchema>
```

- [ ] **Step 2: Write the failing test for the decision function**

Create `lib/wallet/confirm.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { decideDepositConfirmation } from './confirm'

const pending = { status: 'pending' }
const paid = { status: 'paid' }
const ok = { status: 'success', amountKobo: 110_000 } // ₦1,000 + ₦100 fee, in kobo
const expectedKobo = 110_000

describe('decideDepositConfirmation', () => {
  it('returns not_found when there is no deposit row', () => {
    expect(decideDepositConfirmation({ existing: null, verify: ok, expectedKobo })).toBe('not_found')
  })

  it('returns already_paid before verifying (idempotent short-circuit)', () => {
    expect(decideDepositConfirmation({ existing: paid, verify: ok, expectedKobo })).toBe('already_paid')
  })

  it('confirms on success with the exact expected amount', () => {
    expect(decideDepositConfirmation({ existing: pending, verify: ok, expectedKobo })).toBe('confirmed')
  })

  it('rejects when Paystack status is not success', () => {
    expect(
      decideDepositConfirmation({
        existing: pending,
        verify: { status: 'failed', amountKobo: 110_000 },
        expectedKobo,
      }),
    ).toBe('not_successful')
  })

  it('rejects underpayment', () => {
    expect(
      decideDepositConfirmation({
        existing: pending,
        verify: { status: 'success', amountKobo: 100 },
        expectedKobo,
      }),
    ).toBe('not_successful')
  })

  it('confirms overpayment (customer-bears-fee accounts can verify slightly higher)', () => {
    expect(
      decideDepositConfirmation({
        existing: pending,
        verify: { status: 'success', amountKobo: 110_500 },
        expectedKobo,
      }),
    ).toBe('confirmed')
  })

  it('rejects when verify data is unavailable', () => {
    expect(decideDepositConfirmation({ existing: pending, verify: null, expectedKobo })).toBe('not_successful')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run lib/wallet/confirm.test.ts`
Expected: FAIL — `Cannot find module './confirm'`

- [ ] **Step 4: Write `lib/wallet/confirm.ts`**

```ts
import { verifyTransaction } from '@/lib/paystack/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { creditWallet } from './service'
import { notifyInApp } from '@/lib/notifications/inbox'
import { formatNaira } from '@/lib/format'

export type WalletDepositConfirmResult = 'confirmed' | 'already_paid' | 'not_found' | 'not_successful'

// Pure decision: given the current row status and Paystack's verify result,
// decide the outcome. No IO — unit tested directly. Mirrors
// lib/tournaments/confirm.ts's decideConfirmation exactly.
export function decideDepositConfirmation(args: {
  existing: { status: string } | null
  verify: { status: string; amountKobo: number } | null
  expectedKobo: number
}): WalletDepositConfirmResult {
  if (!args.existing) return 'not_found'
  if (args.existing.status === 'paid') return 'already_paid'
  if (!args.verify) return 'not_successful'
  if (args.verify.status !== 'success') return 'not_successful'
  if (args.verify.amountKobo < args.expectedKobo) return 'not_successful'
  return 'confirmed'
}

// Idempotent source of truth, called by BOTH the callback and the webhook —
// same pattern as confirmRegistration/confirmFriendlyStake. Returns
// 'not_found' (never throws) when the reference matches no deposit row,
// which is what lets the Paystack webhook/callback safely try this AFTER
// the tournament and friendly-match confirm attempts both return 'not_found'.
export async function confirmWalletDeposit(reference: string): Promise<WalletDepositConfirmResult> {
  const db = createAdminClient()

  const { data: existing } = await db
    .from('wallet_deposits')
    .select('id, player_id, amount, fee, status')
    .eq('paystack_reference', reference)
    .maybeSingle()

  if (!existing) return 'not_found'
  if (existing.status === 'paid') return 'already_paid'

  const expectedKobo = (existing.amount + existing.fee) * 100

  let verify: { status: string; amountKobo: number } | null = null
  try {
    verify = await verifyTransaction(reference)
  } catch (err) {
    console.error('[confirmWalletDeposit] Paystack verify failed', {
      reference,
      message: err instanceof Error ? err.message : String(err),
    })
    verify = null
  }

  const decision = decideDepositConfirmation({ existing, verify, expectedKobo })
  if (decision === 'not_successful') {
    console.error('[confirmWalletDeposit] Paystack verify did not confirm the payment', {
      reference,
      verify,
    })
  }
  if (decision !== 'confirmed') return decision

  // Guard against races: only the pending -> paid transition credits the wallet.
  const { data: claimed } = await db
    .from('wallet_deposits')
    .update({ status: 'paid' })
    .eq('id', existing.id)
    .eq('status', 'pending')
    .select('id')

  if (claimed && claimed.length > 0) {
    await creditWallet(db, existing.player_id, existing.amount, 'deposit', existing.id, 'Wallet top-up via Paystack')
    await notifyInApp({
      playerId: existing.player_id,
      type: 'wallet_credited',
      title: 'Wallet credited',
      body: `${formatNaira(existing.amount)} was added to your wallet.`,
      link: '/dashboard',
    })
  }

  return 'confirmed'
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/wallet/confirm.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/wallet/schema.ts lib/wallet/confirm.ts lib/wallet/confirm.test.ts
git commit -m "feat(wallet): add deposit schema and idempotent confirm logic"
```

---

### Task 5: `initiateWalletDeposit` server action

**Files:**
- Create: `lib/wallet/deposit.ts`

**Interfaces:**
- Consumes: `walletDepositSchema` from `./schema` (Task 4); `computePaystackFee` from `@/lib/paystack/fees` (Task 2); `buildWalletDepositReference`, `initializeTransaction` from `@/lib/paystack/server` (Task 3 + existing); `createClient` from `@/lib/supabase/server`; `createAdminClient` from `@/lib/supabase/admin`.
- Produces: `initiateWalletDeposit(_prev: WalletDepositState, formData: FormData): Promise<WalletDepositState>` where `WalletDepositState = { error?: string } | undefined`, consumed by Task 7's `WalletPanel.tsx`.

No automated test for this task — thin server-action wrapper, matches this codebase's convention (see Global Constraints). Exercised manually in Task 9.

- [ ] **Step 1: Write the action**

Create `lib/wallet/deposit.ts`:

```ts
'use server'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { initializeTransaction, buildWalletDepositReference } from '@/lib/paystack/server'
import { computePaystackFee } from '@/lib/paystack/fees'
import { walletDepositSchema } from './schema'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sentinelx.gg'

export type WalletDepositState = { error?: string } | undefined

export async function initiateWalletDeposit(
  _prev: WalletDepositState,
  formData: FormData,
): Promise<WalletDepositState> {
  const parsed = walletDepositSchema.safeParse({ amount: formData.get('amount') })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in to fund your wallet.' }

  const amount = parsed.data.amount
  const fee = computePaystackFee(amount)
  const reference = buildWalletDepositReference(user.id)

  const admin = createAdminClient()
  const { error: insertErr } = await admin.from('wallet_deposits').insert({
    player_id: user.id,
    amount,
    fee,
    paystack_reference: reference,
    status: 'pending',
  })
  if (insertErr) return { error: 'Could not start your top-up. Please try again.' }

  let authorizationUrl: string
  try {
    authorizationUrl = await initializeTransaction({
      email: user.email!,
      amountKobo: (amount + fee) * 100,
      reference,
      callbackUrl: `${SITE_URL}/api/paystack/callback`,
      metadata: { player_id: user.id, amount, fee },
    })
  } catch (err) {
    console.error('[initiateWalletDeposit] Paystack initialize failed', {
      reference,
      message: err instanceof Error ? err.message : String(err),
    })
    return { error: 'Payment could not be started. Please try again.' }
  }

  redirect(authorizationUrl)
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/wallet/deposit.ts
git commit -m "feat(wallet): add initiateWalletDeposit server action"
```

---

### Task 6: Wire deposit confirmation into the Paystack webhook and callback routes

**Files:**
- Modify: `app/api/paystack/webhook/route.ts`
- Modify: `app/api/paystack/callback/route.ts`

**Interfaces:**
- Consumes: `confirmWalletDeposit` from `@/lib/wallet/confirm` (Task 4).

- [ ] **Step 1: Extend the webhook's fallback chain**

In `app/api/paystack/webhook/route.ts`, change the import block (lines 1-5) to add:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { verifyWebhookSignature } from '@/lib/paystack/server'
import { confirmRegistration } from '@/lib/tournaments/confirm'
import { confirmFriendlyStake } from '@/lib/friendly-matches/confirm'
import { confirmWalletDeposit } from '@/lib/wallet/confirm'
import { applyIdentificationWebhook, extractIdentificationCustomerCode } from '@/lib/kyc/webhook'
```

Then change the `charge.success` branch (lines 36-44) from:

```ts
  if (type === 'charge.success' && event.data?.reference) {
    const result = await confirmRegistration(event.data.reference)
    // Fan-out is gated strictly on this exact return value — never on
    // catching an exception. confirmRegistration doesn't throw in practice
    // (every path resolves to a ConfirmResult string); if that ever changes,
    // a genuine error must still propagate as a 500, not fall through here.
    if (result === 'not_found') {
      await confirmFriendlyStake(event.data.reference)
    }
  } else if (type === 'customeridentification.success' || type === 'customeridentification.failed') {
```

to:

```ts
  if (type === 'charge.success' && event.data?.reference) {
    const result = await confirmRegistration(event.data.reference)
    // Fan-out is gated strictly on this exact return value — never on
    // catching an exception. confirmRegistration doesn't throw in practice
    // (every path resolves to a ConfirmResult string); if that ever changes,
    // a genuine error must still propagate as a 500, not fall through here.
    if (result === 'not_found') {
      const friendlyResult = await confirmFriendlyStake(event.data.reference)
      if (friendlyResult === 'not_found') {
        await confirmWalletDeposit(event.data.reference)
      }
    }
  } else if (type === 'customeridentification.success' || type === 'customeridentification.failed') {
```

- [ ] **Step 2: Extend the callback's fallback chain**

In `app/api/paystack/callback/route.ts`, change the import block (lines 1-4) to add:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { confirmRegistration } from '@/lib/tournaments/confirm'
import { confirmFriendlyStake } from '@/lib/friendly-matches/confirm'
import { confirmWalletDeposit } from '@/lib/wallet/confirm'
import { createAdminClient } from '@/lib/supabase/admin'
```

Then change the friendly-match block (lines 30-51) from:

```ts
  // Not a tournament registration reference — try a friendly-match stake.
  const friendlyResult = await confirmFriendlyStake(reference)
  const db = createAdminClient()
  const { data: byChallenger } = await db
    .from('friendly_matches')
    .select('id')
    .eq('challenger_paystack_reference', reference)
    .maybeSingle()
  const { data: byOpponent } = byChallenger
    ? { data: null }
    : await db
        .from('friendly_matches')
        .select('id')
        .eq('opponent_paystack_reference', reference)
        .maybeSingle()
  const matchId = byChallenger?.id ?? byOpponent?.id
  const success = friendlyResult === 'confirmed' || friendlyResult === 'already_paid'
  const dest = matchId
    ? `/dashboard/friendlies/${matchId}?${success ? 'paid=1' : 'payment=failed'}`
    : '/dashboard'
  return NextResponse.redirect(new URL(dest, origin))
}
```

to:

```ts
  // Not a tournament registration reference — try a friendly-match stake.
  const friendlyResult = await confirmFriendlyStake(reference)
  const db = createAdminClient()
  const { data: byChallenger } = await db
    .from('friendly_matches')
    .select('id')
    .eq('challenger_paystack_reference', reference)
    .maybeSingle()
  const { data: byOpponent } = byChallenger
    ? { data: null }
    : await db
        .from('friendly_matches')
        .select('id')
        .eq('opponent_paystack_reference', reference)
        .maybeSingle()
  const matchId = byChallenger?.id ?? byOpponent?.id

  if (matchId) {
    const success = friendlyResult === 'confirmed' || friendlyResult === 'already_paid'
    const dest = `/dashboard/friendlies/${matchId}?${success ? 'paid=1' : 'payment=failed'}`
    return NextResponse.redirect(new URL(dest, origin))
  }

  // Not a friendly-match stake either — try a wallet deposit.
  const depositResult = await confirmWalletDeposit(reference)
  const depositSuccess = depositResult === 'confirmed' || depositResult === 'already_paid'
  const depositDest = `/dashboard?${depositSuccess ? 'deposit=paid' : 'deposit=failed'}`
  return NextResponse.redirect(new URL(depositDest, origin))
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: all existing tests pass, plus Tasks 2/3/4's new tests.

- [ ] **Step 5: Commit**

```bash
git add app/api/paystack/webhook/route.ts app/api/paystack/callback/route.ts
git commit -m "feat(wallet): wire wallet deposit confirmation into Paystack webhook/callback"
```

---

### Task 7: "Fund wallet" form on the wallet panel

**Files:**
- Modify: `components/dashboard/WalletPanel.tsx`
- Modify: `app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `initiateWalletDeposit`, `type WalletDepositState` from `@/lib/wallet/deposit` (Task 5); `computePaystackFee` from `@/lib/paystack/fees` (Task 2, used client-side just for the live fee preview — safe to import into a client component since it's a pure arithmetic function with no secrets).

- [ ] **Step 1: Add the deposit form to `WalletPanel.tsx`**

In `components/dashboard/WalletPanel.tsx`, add to the imports (top of file):

```tsx
'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { requestWalletWithdrawal, type WalletWithdrawalState } from '@/lib/wallet/actions'
import { initiateWalletDeposit, type WalletDepositState } from '@/lib/wallet/deposit'
import { computePaystackFee } from '@/lib/paystack/fees'
import { formatDate, formatNaira } from '@/lib/format'
import { maskAccountNumber, kycPanelMode } from '@/lib/kyc/logic'
import { KycForm } from './KycForm'
import { Field } from './FormField'
```

Then add a `FundWalletForm` component before `VerifiedWithdrawalForm` (after the closing `}` of the top-level `WalletPanel` function, i.e. right after line 77 in the original file):

```tsx
function FundWalletForm() {
  const [state, formAction] = useFormState<WalletDepositState, FormData>(initiateWalletDeposit, undefined)
  const [amount, setAmount] = useState<number | ''>('')
  const fee = typeof amount === 'number' && amount >= 100 ? computePaystackFee(amount) : 0
  const total = typeof amount === 'number' && amount >= 100 ? amount + fee : 0

  return (
    <form
      action={formAction}
      className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-5"
    >
      <Field
        name="amount"
        label="Amount to add (₦)"
        type="number"
        min={100}
        placeholder="1000"
        value={amount}
        onChange={(e) => setAmount(e.target.value === '' ? '' : Number(e.target.value))}
      />
      {total > 0 && (
        <p className="text-xs text-slate-500">
          You&apos;ll pay {formatNaira(total)} total — {formatNaira(amount as number)} to your wallet +{' '}
          {formatNaira(fee)} fee.
        </p>
      )}
      {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
      <button
        type="submit"
        className="w-full rounded-xl bg-emerald-600 px-7 py-3 text-sm font-bold text-white transition-colors hover:bg-emerald-500"
      >
        Fund wallet
      </button>
    </form>
  )
}
```

Then render it inside `WalletPanel`, right after the balance display and before the KYC/withdrawal blocks — change:

```tsx
      <p className="mb-4 rounded-2xl border border-slate-800 bg-slate-900 p-4 text-2xl font-black text-white">
        {formatNaira(balance)}
      </p>

      {mode === 'form' && <KycForm banks={banks} failureReason={kycFailureReason} />}
```

to:

```tsx
      <p className="mb-4 rounded-2xl border border-slate-800 bg-slate-900 p-4 text-2xl font-black text-white">
        {formatNaira(balance)}
      </p>

      <div className="mb-4">
        <FundWalletForm />
      </div>

      {mode === 'form' && <KycForm banks={banks} failureReason={kycFailureReason} />}
```

- [ ] **Step 2: Add the `?deposit=` banner to the dashboard page**

In `app/dashboard/page.tsx`, change the function signature (line 95) from:

```ts
export default async function DashboardPage() {
```

to:

```ts
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { deposit?: string }
}) {
```

Then, in the JSX, change the wallet section (originally lines 539-549) from:

```tsx
      <CollapsibleSection id="wallet" title="Wallet" defaultOpen={walletBalance > 0 || hasActive}>
        <WalletPanel
```

to:

```tsx
      <CollapsibleSection id="wallet" title="Wallet" defaultOpen={walletBalance > 0 || hasActive}>
        {searchParams.deposit === 'paid' && (
          <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-400">
            🎉 Wallet funded — your balance is updated below.
          </div>
        )}
        {searchParams.deposit === 'failed' && (
          <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-400">
            Payment was not completed. You can try again below.
          </div>
        )}
        <WalletPanel
```

(the closing `/>` and `</CollapsibleSection>` that already follow stay as-is).

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (`Field`'s props come from `InputHTMLAttributes<HTMLInputElement>` per `components/dashboard/FormField.tsx:8`, so `value`/`onChange` are already valid props on it.)

- [ ] **Step 4: Commit**

```bash
git add components/dashboard/WalletPanel.tsx app/dashboard/page.tsx
git commit -m "feat(wallet): add Fund wallet form to the wallet panel"
```

---

### Task 8: "Fund wallet" link on insufficient-balance bet errors

**Files:**
- Modify: `components/match/BettingPanel.tsx`

**Interfaces:**
- No new exports — purely a UI change reading the existing `state.error` string.

- [ ] **Step 1: Add the conditional link**

In `components/match/BettingPanel.tsx`, add `Link` to the imports:

```tsx
'use client'
import Link from 'next/link'
import { useFormState } from 'react-dom'
import { placeBet, type BetState } from '@/lib/betting/actions'
import { impliedPayoutMultiplier, type SidePools, type Side } from '@/lib/betting/market'
```

Then change the error line (line 64) from:

```tsx
          {state?.error && <p className="text-xs text-red-400">{state.error}</p>}
```

to:

```tsx
          {state?.error && (
            <p className="text-xs text-red-400">
              {state.error}
              {state.error === 'Insufficient wallet balance.' && (
                <>
                  {' '}
                  <Link href="/dashboard#wallet" className="font-bold text-violet-400 hover:text-violet-300">
                    Fund wallet →
                  </Link>
                </>
              )}
            </p>
          )}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/match/BettingPanel.tsx
git commit -m "feat(betting): link to Fund wallet on insufficient-balance error"
```

---

### Task 9: Full test suite, build, and manual verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass (existing + this plan's new tests across Tasks 2, 3, 4).

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: builds successfully with no errors.

- [ ] **Step 3: Manual verification — read-only DB sanity check first**

Before clicking anything in a browser, use the Supabase MCP `execute_sql` tool (read-only) against project id `itxubrkbropttfdackmi` to confirm the migration applied: `select conname, pg_get_constraintdef(oid) from pg_constraint where conname in ('wallet_transactions_type_check');` should include `'deposit'`, and `select * from public.wallet_deposits limit 1;` should succeed (empty result is fine — confirms the table exists and RLS doesn't error on a staff/service query).

- [ ] **Step 4: Manual verification — happy path**

Using Paystack **test-mode** keys (confirm `PAYSTACK_SECRET_KEY` starts with `sk_test_` before doing this — never run a real charge against live keys as a test), start the dev server, log in as a real player account, open the dashboard, use the new "Fund wallet" form with a small amount (e.g. ₦100), confirm the fee preview text appears, submit, complete Paystack's test checkout, and confirm: the browser lands back on `/dashboard?deposit=paid` with the success banner, the wallet balance increased by exactly the typed amount (not amount+fee), and `wallet_transactions` has exactly one new `'deposit'` row (read-only check via `execute_sql`).

- [ ] **Step 5: Manual verification — betting link**

Using a test account with a low/zero wallet balance, attempt to place a bet larger than the balance on a live match's betting panel, confirm the "Insufficient wallet balance." error shows the new "Fund wallet →" link, and that it navigates to the dashboard's wallet section.

- [ ] **Step 6: Manual verification — failed payment**

Start a deposit, then cancel/fail the Paystack checkout instead of completing it, confirm the browser lands on `/dashboard?deposit=failed` with the failure banner and the wallet balance is unchanged.

No commit for this task — it's verification of Tasks 1–8's already-committed work.
