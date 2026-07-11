# #14 KYC (BVN) + Paystack Transfer withdrawals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manual "admin wires money by hand" withdrawal flow with BVN-verified,
Paystack-Transfer-automated payouts, gated by a one-time identity check.

**Architecture:** A player verifies their BVN once against their payout bank account
(Paystack Customer Identification, async via webhook). Verification success creates a
durable Paystack Transfer Recipient stored in a new `player_kyc` table — kept separate
from the public `profiles` table so a real bank account number and legal name are
never world-readable. Every subsequent withdrawal request only needs an amount; admin
still reviews and clicks "Pay", which now calls Paystack's Transfer API instead of
moving money by hand. Real settlement is confirmed asynchronously via two new event
types on the existing Paystack webhook route.

**Tech Stack:** Next.js 14 Server Actions, Supabase (Postgres + RLS + service-role
client), Paystack REST API (Customer, Identification, Transfer Recipient, Transfer,
Bank/Resolve), Vitest.

## Global Constraints

- Mobile-first UI (375px baseline) — CLAUDE.md.
- RLS enabled on every table; sensitive columns must not be writable by a player's own
  authenticated session — CLAUDE.md + this feature's own finding (see Task 1).
- All Paystack verification happens server-side (webhook/API route), never trusted from
  the client — CLAUDE.md.
- Every financial admin action is gated `admin`-only, not `moderator` — CLAUDE.md.
- Next.js Server Components by default; `'use client'` only where interactivity is
  required — CLAUDE.md.
- BVN is never persisted to any column, ever — approved design
  (`docs/superpowers/specs/2026-07-11-kyc-paystack-withdrawals-design.md`).

⚠️ **Operational prerequisite, not part of this plan's tasks:** Paystack Dashboard →
Settings → Preferences → uncheck "Confirm transfers before sending". Until that's done,
`initiateTransfer` calls will appear to succeed but never settle (no `transfer.success`
webhook will ever fire). This must be done in the Paystack dashboard directly.

---

### Task 1: Migration — `player_kyc` table (isolated from `profiles`), withdrawal status lifecycle

**Why a new table, not columns on `profiles`:** `profiles` has
`profiles_public_read` (`FOR SELECT USING (true)`, migration 001) — every profile row
is world-readable, by design, for public player-profile pages. A player's real bank
account number and BVN-matched legal name must never be world-readable. Column-level
privileges can't carve out exceptions per-column under a single row policy, so the
correct fix is the same one already used for `marketplace_orders` (migration 013):
a separate table with its own tight RLS, no client write policies at all (writes
only via the service-role client). `profiles.kyc_verified` (already existing since
migration 001) stays put as a public, non-sensitive "badge" boolean — it carries no
PII and this feature does not gate any financial behavior on it (gating is on
`player_kyc.kyc_status`, which a player cannot self-write).

**Files:**
- Create: `supabase/migrations/014_kyc_withdrawals.sql`
- Modify: `lib/supabase/types.ts:865-911` (withdrawal_requests), and add a new
  `player_kyc` block to the same file's `Tables` object.

**Interfaces:**
- Produces: table `public.player_kyc(player_id PK/FK->profiles, kyc_status,
  kyc_failure_reason, paystack_customer_code UNIQUE, paystack_recipient_code UNIQUE,
  payout_bank_code, payout_bank_name, payout_account_number, payout_account_name,
  updated_at)`. `withdrawal_requests.status` gains `processing`/`failed`; gains
  `paystack_transfer_code`, `paystack_transfer_reference`.

- [ ] **Step 1: Write the migration**

```sql
-- #14 KYC (BVN) + Paystack Transfer prize withdrawals.

-- 1. player_kyc: BVN verification state + payout account, isolated from
--    profiles (see task header for why). Self may read their own row; staff
--    may read any row (the admin withdrawals queue needs to look up a
--    player's paystack_recipient_code). No INSERT/UPDATE/DELETE policies at
--    all — every write goes through the service-role client (submitKyc, the
--    identification webhook, resetKycForPlayer), same "server-only writes"
--    pattern as marketplace_orders (migration 013).
CREATE TABLE public.player_kyc (
  player_id               uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  kyc_status               text NOT NULL DEFAULT 'unverified'
                              CHECK (kyc_status IN ('unverified', 'pending', 'verified', 'failed')),
  kyc_failure_reason       text,
  paystack_customer_code   text UNIQUE,
  paystack_recipient_code  text UNIQUE,
  payout_bank_code         text,
  payout_bank_name         text,
  payout_account_number    text,
  payout_account_name      text,
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER set_player_kyc_updated_at
  BEFORE UPDATE ON public.player_kyc
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.player_kyc ENABLE ROW LEVEL SECURITY;

CREATE POLICY "player_kyc_self_or_staff_read" ON public.player_kyc
  FOR SELECT USING (auth.uid() = player_id OR public.is_staff());

-- 2. withdrawal_requests: transfer automation columns + statuses --------
ALTER TABLE public.withdrawal_requests
  DROP CONSTRAINT withdrawal_requests_status_check;
ALTER TABLE public.withdrawal_requests
  ADD CONSTRAINT withdrawal_requests_status_check
  CHECK (status IN ('pending', 'processing', 'paid', 'rejected', 'failed'));
ALTER TABLE public.withdrawal_requests
  ADD COLUMN paystack_transfer_code      text,
  ADD COLUMN paystack_transfer_reference text UNIQUE;

-- 3. One *active* (pending or processing) request per player, not just
--    pending — a player shouldn't be able to file a second request while
--    one is actively being paid out.
DROP INDEX public.withdrawal_requests_one_pending_per_player;
CREATE UNIQUE INDEX withdrawal_requests_one_active_per_player
  ON public.withdrawal_requests (player_id)
  WHERE status IN ('pending', 'processing');

-- No RLS policy changes needed on withdrawal_requests itself: wr_own_insert
-- already requires status = 'pending' at insert time (unaffected);
-- wr_admin_update already lets any admin update any column on any row
-- (unaffected, used by resolveWithdrawal via the regular authenticated
-- client, same as before this feature).
```

- [ ] **Step 2: Add `player_kyc` and the `withdrawal_requests` columns to `lib/supabase/types.ts`**

Add a new block to the `Tables` object (alongside `marketplace_orders`, matching that
block's structure exactly):

```ts
      player_kyc: {
        Row: {
          kyc_failure_reason: string | null
          kyc_status: string
          paystack_customer_code: string | null
          paystack_recipient_code: string | null
          payout_account_name: string | null
          payout_account_number: string | null
          payout_bank_code: string | null
          payout_bank_name: string | null
          player_id: string
          updated_at: string
        }
        Insert: {
          kyc_failure_reason?: string | null
          kyc_status?: string
          paystack_customer_code?: string | null
          paystack_recipient_code?: string | null
          payout_account_name?: string | null
          payout_account_number?: string | null
          payout_bank_code?: string | null
          payout_bank_name?: string | null
          player_id: string
          updated_at?: string
        }
        Update: {
          kyc_failure_reason?: string | null
          kyc_status?: string
          paystack_customer_code?: string | null
          paystack_recipient_code?: string | null
          payout_account_name?: string | null
          payout_account_number?: string | null
          payout_bank_code?: string | null
          payout_bank_name?: string | null
          player_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_kyc_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
```

In the `withdrawal_requests` block (`lib/supabase/types.ts:865-911`), add to `Row`,
`Insert`, `Update`:

```ts
          paystack_transfer_code: string | null
          paystack_transfer_reference: string | null
```

(`Insert`/`Update` versions suffixed `?`, same pattern as `admin_note?: string | null`
already in that block.)

- [ ] **Step 3: Verify the migration against the live schema**

Run the migration SQL through the Supabase SQL editor (or `psql`) inside a transaction
you roll back, confirming: `player_kyc`'s CHECK constraint rejects an invalid
`kyc_status` (e.g. `'bogus'`); a normal authenticated session (not the row's own
`player_id`, not staff) gets zero rows back on `SELECT * FROM player_kyc` for another
player's row (RLS enforced) and cannot `INSERT`/`UPDATE` any row at all (no policy
exists for those, so they're denied outright — confirm this from a non-service-role
session); the `withdrawal_requests` CHECK constraint accepts `processing`/`failed`
and rejects an invalid value; the partial unique index rejects a second
`pending`/`processing` row for the same `player_id`. Roll back afterward — do not
leave test rows in the live tables.

- [ ] **Step 4: `npx tsc --noEmit`**

Expected: no new errors (nothing yet consumes the new table/columns).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/014_kyc_withdrawals.sql lib/supabase/types.ts
git commit -m "feat: #14 player_kyc table (isolated RLS) + withdrawal status lifecycle"
```

---

### Task 2: Paystack lib — banks, resolve, customer, identification, recipient, transfer

**Files:**
- Modify: `lib/paystack/server.ts`
- Modify: `lib/paystack/server.test.ts`

**Interfaces:**
- Consumes: `PAYSTACK_BASE_URL` from `lib/paystack/index.ts` (existing), `secret()`
  (existing private helper in this file).
- Produces: `Bank { name, code }`, `listBanks(): Promise<Bank[]>`,
  `resolveAccount(accountNumber, bankCode): Promise<{ accountName: string }>`,
  `createCustomer(email, firstName, lastName): Promise<string>`,
  `submitBvnIdentification(customerCode, params): Promise<void>`,
  `createTransferRecipient(params): Promise<string>`, `buildTransferReference(id):
  string`, `initiateTransfer(params): Promise<{ transferCode: string }>`. Pure
  builders `buildIdentificationPayload`, `buildRecipientPayload`,
  `buildTransferPayload` — exported for testing.

- [ ] **Step 1: Write the failing tests for the pure payload builders**

Append to `lib/paystack/server.test.ts` (keep the existing `buildReference` /
`verifyWebhookSignature` describe blocks untouched):

```ts
import {
  buildIdentificationPayload,
  buildRecipientPayload,
  buildTransferPayload,
  buildTransferReference,
} from './server'

describe('buildIdentificationPayload', () => {
  it('maps to the Paystack bank_account identification shape', () => {
    expect(
      buildIdentificationPayload({
        bvn: '12345678901',
        bankCode: '058',
        accountNumber: '0123456789',
        firstName: 'Ada',
        lastName: 'Lovelace',
      }),
    ).toEqual({
      country: 'NG',
      type: 'bank_account',
      bvn: '12345678901',
      bank_code: '058',
      account_number: '0123456789',
      first_name: 'Ada',
      last_name: 'Lovelace',
    })
  })
})

describe('buildRecipientPayload', () => {
  it('maps to the Paystack transfer recipient shape', () => {
    expect(
      buildRecipientPayload({
        accountName: 'ADA LOVELACE',
        accountNumber: '0123456789',
        bankCode: '058',
      }),
    ).toEqual({
      type: 'nuban',
      name: 'ADA LOVELACE',
      account_number: '0123456789',
      bank_code: '058',
      currency: 'NGN',
    })
  })
})

describe('buildTransferPayload', () => {
  it('maps to the Paystack transfer shape with balance as source', () => {
    expect(
      buildTransferPayload({
        amountKobo: 500000,
        recipientCode: 'RCP_abc',
        reference: 'sxwd_abc_123',
      }),
    ).toEqual({
      source: 'balance',
      amount: 500000,
      recipient: 'RCP_abc',
      reason: 'SentinelX prize withdrawal',
      reference: 'sxwd_abc_123',
    })
  })
})

describe('buildTransferReference', () => {
  it('is prefixed and derived from the withdrawal id', () => {
    const ref = buildTransferReference('11111111-2222-3333-4444-555555555555')
    expect(ref).toMatch(/^sxwd_111111112222_[a-z0-9]{8}$/)
  })

  it('produces distinct references on repeat calls for the same id', () => {
    expect(buildTransferReference('abc')).not.toBe(buildTransferReference('abc'))
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- lib/paystack/server.test.ts`
Expected: FAIL — `buildIdentificationPayload`, `buildRecipientPayload`,
`buildTransferPayload`, `buildTransferReference` are not exported yet.

- [ ] **Step 3: Implement the additions in `lib/paystack/server.ts`**

Append to the end of the existing file (after `verifyTransaction`):

```ts
export interface Bank {
  name: string
  code: string
}

export async function listBanks(): Promise<Bank[]> {
  const res = await fetch(`${PAYSTACK_BASE_URL}/bank?country=nigeria&currency=NGN&type=nuban`, {
    headers: { Authorization: `Bearer ${secret()}` },
    next: { revalidate: 86400 },
  })
  const json = await res.json()
  if (!res.ok || !json.status) throw new Error(json?.message || 'Paystack bank list failed')
  return (json.data as Array<{ name: string; code: string }>).map((b) => ({
    name: b.name,
    code: b.code,
  }))
}

export interface ResolvedAccount {
  accountName: string
}

export async function resolveAccount(
  accountNumber: string,
  bankCode: string,
): Promise<ResolvedAccount> {
  const res = await fetch(
    `${PAYSTACK_BASE_URL}/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,
    { headers: { Authorization: `Bearer ${secret()}` }, cache: 'no-store' },
  )
  const json = await res.json()
  if (!res.ok || !json.status) {
    throw new Error(json?.message || 'Could not resolve this account number')
  }
  return { accountName: json.data.account_name as string }
}

export async function createCustomer(
  email: string,
  firstName: string,
  lastName: string,
): Promise<string> {
  const res = await fetch(`${PAYSTACK_BASE_URL}/customer`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, first_name: firstName, last_name: lastName }),
  })
  const json = await res.json()
  if (!res.ok || !json.status) throw new Error(json?.message || 'Paystack customer creation failed')
  return json.data.customer_code as string
}

export function buildIdentificationPayload(params: {
  bvn: string
  bankCode: string
  accountNumber: string
  firstName: string
  lastName: string
}) {
  return {
    country: 'NG',
    type: 'bank_account',
    bvn: params.bvn,
    bank_code: params.bankCode,
    account_number: params.accountNumber,
    first_name: params.firstName,
    last_name: params.lastName,
  }
}

export async function submitBvnIdentification(
  customerCode: string,
  params: { bvn: string; bankCode: string; accountNumber: string; firstName: string; lastName: string },
): Promise<void> {
  const res = await fetch(
    `${PAYSTACK_BASE_URL}/customer/${encodeURIComponent(customerCode)}/identification`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildIdentificationPayload(params)),
    },
  )
  const json = await res.json()
  if (!res.ok || !json.status) {
    throw new Error(json?.message || 'Paystack identification submission failed')
  }
}

export function buildRecipientPayload(params: {
  accountName: string
  accountNumber: string
  bankCode: string
}) {
  return {
    type: 'nuban',
    name: params.accountName,
    account_number: params.accountNumber,
    bank_code: params.bankCode,
    currency: 'NGN',
  }
}

export async function createTransferRecipient(params: {
  accountName: string
  accountNumber: string
  bankCode: string
}): Promise<string> {
  const res = await fetch(`${PAYSTACK_BASE_URL}/transferrecipient`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildRecipientPayload(params)),
  })
  const json = await res.json()
  if (!res.ok || !json.status) throw new Error(json?.message || 'Paystack recipient creation failed')
  return json.data.recipient_code as string
}

export function buildTransferReference(withdrawalId: string): string {
  const w = withdrawalId.replace(/-/g, '').slice(0, 12)
  const rand = Math.random().toString(36).slice(2, 10).padEnd(8, '0')
  return `sxwd_${w}_${rand}`
}

export function buildTransferPayload(params: {
  amountKobo: number
  recipientCode: string
  reference: string
}) {
  return {
    source: 'balance',
    amount: params.amountKobo,
    recipient: params.recipientCode,
    reason: 'SentinelX prize withdrawal',
    reference: params.reference,
  }
}

export async function initiateTransfer(params: {
  amountKobo: number
  recipientCode: string
  reference: string
}): Promise<{ transferCode: string }> {
  const res = await fetch(`${PAYSTACK_BASE_URL}/transfer`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildTransferPayload(params)),
  })
  const json = await res.json()
  if (!res.ok || !json.status) throw new Error(json?.message || 'Paystack transfer initiation failed')
  return { transferCode: json.data.transfer_code as string }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- lib/paystack/server.test.ts`
Expected: PASS (all describe blocks, old and new).

- [ ] **Step 5: `npx tsc --noEmit`**

Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add lib/paystack/server.ts lib/paystack/server.test.ts
git commit -m "feat: #14 Paystack bank/resolve/customer/identification/transfer client"
```

---

### Task 3: `lib/kyc/` module — schema, pure logic, server actions, webhook handler

**Files:**
- Create: `lib/kyc/schema.ts`, `lib/kyc/schema.test.ts`, `lib/kyc/logic.ts`,
  `lib/kyc/logic.test.ts`, `lib/kyc/actions.ts`, `lib/kyc/webhook.ts`,
  `lib/kyc/webhook.test.ts`

**Interfaces:**
- Consumes: `resolveAccount`, `createCustomer`, `submitBvnIdentification`,
  `createTransferRecipient` from `lib/paystack/server.ts` (Task 2); `createClient` from
  `lib/supabase/server.ts`; `createAdminClient` from `lib/supabase/admin.ts`;
  `requireAdmin` from `lib/admin/auth.ts`.
- Produces: `kycSchema`, `type KycInput`; `maskAccountNumber(accountNumber): string`,
  `type KycPanelMode = 'form' | 'pending' | 'verified'`,
  `kycPanelMode(kycStatus: string): KycPanelMode`; `type KycState`,
  `resolveAccountName(bankCode, accountNumber): Promise<{ accountName?: string; error?:
  string }>`, `submitKyc(prevState, formData): Promise<KycState>`,
  `resetKycForPlayer(playerId): Promise<{ error?: string; success?: boolean }>`;
  `identificationEventTarget(event): 'verified' | 'failed' | null`,
  `applyIdentificationWebhook(customerCode, event, reason): Promise<'applied' | 'noop'
  | 'not_found' | 'unknown_event'>`.

- [ ] **Step 1: Write the failing tests for `lib/kyc/schema.ts`**

```ts
// lib/kyc/schema.test.ts
import { describe, it, expect } from 'vitest'
import { kycSchema } from './schema'

const valid = {
  bankCode: '058',
  accountNumber: '0123456789',
  bvn: '12345678901',
  firstName: 'Ada',
  lastName: 'Lovelace',
}

describe('kycSchema', () => {
  it('accepts a valid submission', () => {
    expect(kycSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects a missing bank', () => {
    expect(kycSchema.safeParse({ ...valid, bankCode: '' }).success).toBe(false)
  })

  it('rejects an account number that is not exactly 10 digits', () => {
    expect(kycSchema.safeParse({ ...valid, accountNumber: '123456789' }).success).toBe(false)
    expect(kycSchema.safeParse({ ...valid, accountNumber: '01234567890' }).success).toBe(false)
  })

  it('rejects a BVN that is not exactly 11 digits', () => {
    expect(kycSchema.safeParse({ ...valid, bvn: '1234567890' }).success).toBe(false)
    expect(kycSchema.safeParse({ ...valid, bvn: '123456789012' }).success).toBe(false)
    expect(kycSchema.safeParse({ ...valid, bvn: '1234567890a' }).success).toBe(false)
  })

  it('rejects empty first or last name', () => {
    expect(kycSchema.safeParse({ ...valid, firstName: '  ' }).success).toBe(false)
    expect(kycSchema.safeParse({ ...valid, lastName: '' }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- lib/kyc/schema.test.ts`
Expected: FAIL — `./schema` does not exist.

- [ ] **Step 3: Implement `lib/kyc/schema.ts`**

```ts
import { z } from 'zod'

export const kycSchema = z.object({
  bankCode: z.string().trim().min(1, 'Select your bank'),
  accountNumber: z
    .string()
    .trim()
    .regex(/^\d{10}$/, 'Account number must be 10 digits'),
  bvn: z
    .string()
    .trim()
    .regex(/^\d{11}$/, 'BVN must be 11 digits'),
  firstName: z.string().trim().min(1, 'First name is required').max(100, 'First name is too long'),
  lastName: z.string().trim().min(1, 'Last name is required').max(100, 'Last name is too long'),
})

export type KycInput = z.infer<typeof kycSchema>
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- lib/kyc/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing tests for `lib/kyc/logic.ts`**

```ts
// lib/kyc/logic.test.ts
import { describe, it, expect } from 'vitest'
import { maskAccountNumber, kycPanelMode } from './logic'

describe('maskAccountNumber', () => {
  it('shows only the last 4 digits', () => {
    expect(maskAccountNumber('0123456789')).toBe('•••6789')
  })
})

describe('kycPanelMode', () => {
  it('maps unverified to form', () => {
    expect(kycPanelMode('unverified')).toBe('form')
  })
  it('maps failed to form (retry)', () => {
    expect(kycPanelMode('failed')).toBe('form')
  })
  it('maps pending to pending', () => {
    expect(kycPanelMode('pending')).toBe('pending')
  })
  it('maps verified to verified', () => {
    expect(kycPanelMode('verified')).toBe('verified')
  })
  it('falls back to form for an unknown value', () => {
    expect(kycPanelMode('bogus')).toBe('form')
  })
})
```

- [ ] **Step 6: Run to verify it fails**

Run: `npm test -- lib/kyc/logic.test.ts`
Expected: FAIL — `./logic` does not exist.

- [ ] **Step 7: Implement `lib/kyc/logic.ts`**

```ts
export function maskAccountNumber(accountNumber: string): string {
  return `•••${accountNumber.slice(-4)}`
}

export type KycPanelMode = 'form' | 'pending' | 'verified'

export function kycPanelMode(kycStatus: string): KycPanelMode {
  if (kycStatus === 'verified') return 'verified'
  if (kycStatus === 'pending') return 'pending'
  return 'form' // 'unverified' | 'failed' | any unrecognized value
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `npm test -- lib/kyc/logic.test.ts`
Expected: PASS.

- [ ] **Step 9: Write the failing test for the pure part of `lib/kyc/webhook.ts`**

```ts
// lib/kyc/webhook.test.ts
import { describe, it, expect } from 'vitest'
import { identificationEventTarget } from './webhook'

describe('identificationEventTarget', () => {
  it('maps customeridentification.success to verified', () => {
    expect(identificationEventTarget('customeridentification.success')).toBe('verified')
  })
  it('maps customeridentification.failed to failed', () => {
    expect(identificationEventTarget('customeridentification.failed')).toBe('failed')
  })
  it('returns null for an unrelated event', () => {
    expect(identificationEventTarget('charge.success')).toBeNull()
  })
})
```

- [ ] **Step 10: Run to verify it fails**

Run: `npm test -- lib/kyc/webhook.test.ts`
Expected: FAIL — `./webhook` does not exist.

- [ ] **Step 11: Implement `lib/kyc/webhook.ts`**

```ts
import { createAdminClient } from '@/lib/supabase/admin'
import { createTransferRecipient } from '@/lib/paystack/server'

export type IdentificationWebhookResult = 'applied' | 'noop' | 'not_found' | 'unknown_event'

// Pure decision: which player_kyc.kyc_status a given Paystack identification
// event should produce. No IO — unit tested directly.
export function identificationEventTarget(event: string): 'verified' | 'failed' | null {
  if (event === 'customeridentification.success') return 'verified'
  if (event === 'customeridentification.failed') return 'failed'
  return null
}

export async function applyIdentificationWebhook(
  customerCode: string,
  event: string,
  reason: string | null,
): Promise<IdentificationWebhookResult> {
  const target = identificationEventTarget(event)
  if (!target) return 'unknown_event'

  const admin = createAdminClient()
  const { data: kyc } = await admin
    .from('player_kyc')
    .select('player_id, kyc_status, payout_bank_code, payout_account_number, payout_account_name')
    .eq('paystack_customer_code', customerCode)
    .maybeSingle()
  if (!kyc) return 'not_found'
  if (kyc.kyc_status === target) return 'noop' // idempotent: Paystack may retry

  if (target === 'verified') {
    try {
      const recipientCode = await createTransferRecipient({
        accountName: kyc.payout_account_name ?? '',
        accountNumber: kyc.payout_account_number ?? '',
        bankCode: kyc.payout_bank_code ?? '',
      })
      // Two explicit writes, not a trigger or computed column: player_kyc
      // (the authoritative state) and profiles.kyc_verified (the public,
      // non-sensitive "badge" boolean) are updated together right here so
      // they never drift apart.
      await admin
        .from('player_kyc')
        .update({
          kyc_status: 'verified',
          kyc_failure_reason: null,
          paystack_recipient_code: recipientCode,
        })
        .eq('player_id', kyc.player_id)
        .eq('kyc_status', 'pending')
      await admin.from('profiles').update({ kyc_verified: true }).eq('id', kyc.player_id)
    } catch {
      // BVN matched but recipient setup failed — surface as a failure so the
      // player can retry rather than being stuck "verified" with no payout route.
      await admin
        .from('player_kyc')
        .update({
          kyc_status: 'failed',
          kyc_failure_reason: 'Could not set up your payout account. Please try again.',
        })
        .eq('player_id', kyc.player_id)
        .eq('kyc_status', 'pending')
    }
  } else {
    await admin
      .from('player_kyc')
      .update({ kyc_status: 'failed', kyc_failure_reason: reason ?? 'Verification failed' })
      .eq('player_id', kyc.player_id)
      .eq('kyc_status', 'pending')
  }

  return 'applied'
}
```

- [ ] **Step 12: Run to verify it passes**

Run: `npm test -- lib/kyc/webhook.test.ts`
Expected: PASS.

- [ ] **Step 13: Implement `lib/kyc/actions.ts` (no test — matches this codebase's
  convention that Supabase-touching server actions aren't unit tested; see
  `lib/withdrawals/actions.ts`, `lib/exchange/purchase.ts` for precedent)**

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/admin/auth'
import { kycSchema } from './schema'
import { resolveAccount, createCustomer, submitBvnIdentification, listBanks } from '@/lib/paystack/server'

const GENERIC_ERROR = 'Could not submit your verification. Please try again.'

export async function resolveAccountName(
  bankCode: string,
  accountNumber: string,
): Promise<{ accountName?: string; error?: string }> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }
  if (!bankCode || !/^\d{10}$/.test(accountNumber)) {
    return { error: 'Enter a valid account number.' }
  }
  try {
    const { accountName } = await resolveAccount(accountNumber, bankCode)
    return { accountName }
  } catch {
    return { error: 'Could not verify this account number. Check the details and try again.' }
  }
}

export type KycState = { error?: string; success?: boolean } | undefined

export async function submitKyc(_prev: KycState, formData: FormData): Promise<KycState> {
  const parsed = kycSchema.safeParse({
    bankCode: formData.get('bankCode'),
    accountNumber: formData.get('accountNumber'),
    bvn: formData.get('bvn'),
    firstName: formData.get('firstName'),
    lastName: formData.get('lastName'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user || !user.email) return { error: 'Please log in to verify your identity.' }

  // A brand-new player has no player_kyc row yet — maybeSingle() returns null,
  // which is the same as 'unverified' for gating purposes.
  const { data: kyc } = await supabase
    .from('player_kyc')
    .select('kyc_status, paystack_customer_code')
    .eq('player_id', user.id)
    .maybeSingle()
  if (kyc?.kyc_status === 'verified') return { error: 'You are already verified.' }
  if (kyc?.kyc_status === 'pending') return { error: 'Verification is already in progress.' }

  // account_name is never trusted from the client — resolved server-side here,
  // same as the amount-from-server rule used elsewhere in this codebase.
  let accountName: string
  try {
    ;({ accountName } = await resolveAccount(parsed.data.accountNumber, parsed.data.bankCode))
  } catch {
    return { error: 'Could not verify this account number. Check the details and try again.' }
  }

  let bankName: string
  try {
    const banks = await listBanks()
    const match = banks.find((b) => b.code === parsed.data.bankCode)
    if (!match) return { error: 'Unrecognized bank. Please select your bank again.' }
    bankName = match.name
  } catch {
    return { error: GENERIC_ERROR }
  }

  const admin = createAdminClient()
  let customerCode = kyc?.paystack_customer_code ?? null
  if (!customerCode) {
    try {
      customerCode = await createCustomer(user.email, parsed.data.firstName, parsed.data.lastName)
    } catch {
      return { error: 'Could not start identity verification. Please try again.' }
    }
  }

  try {
    // BVN is read from parsed.data here and never appears in the update() call
    // below — it must never be written to any column.
    await submitBvnIdentification(customerCode, {
      bvn: parsed.data.bvn,
      bankCode: parsed.data.bankCode,
      accountNumber: parsed.data.accountNumber,
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
    })
  } catch {
    return { error: GENERIC_ERROR }
  }

  // No player_kyc row exists yet on a first attempt (player_id is the PK, not
  // auto-created) — upsert so both the first attempt and a retry-after-'failed'
  // go through the same call.
  await admin.from('player_kyc').upsert(
    {
      player_id: user.id,
      kyc_status: 'pending',
      kyc_failure_reason: null,
      paystack_customer_code: customerCode,
      payout_bank_code: parsed.data.bankCode,
      payout_bank_name: bankName,
      payout_account_number: parsed.data.accountNumber,
      payout_account_name: accountName,
    },
    { onConflict: 'player_id' },
  )

  revalidatePath('/dashboard')
  return { success: true }
}

// Admin-only lever: no dedicated UI yet. Lets support unstick a player whose
// verified payout account needs to change (e.g. closed bank account) by
// resetting them back to 'unverified' so they can re-run submitKyc. Deleting
// the row is the reset — 'no row' already means 'unverified' everywhere this
// table is read (see submitKyc and requestWithdrawal, both maybeSingle()).
export async function resetKycForPlayer(playerId: string): Promise<{ error?: string; success?: boolean }> {
  await requireAdmin()
  const admin = createAdminClient()
  const { error } = await admin.from('player_kyc').delete().eq('player_id', playerId)
  if (error) return { error: 'Could not reset KYC status.' }
  await admin.from('profiles').update({ kyc_verified: false }).eq('id', playerId)
  revalidatePath('/dashboard')
  return { success: true }
}
```

- [ ] **Step 14: `npx tsc --noEmit`**

Expected: no new errors.

- [ ] **Step 15: Commit**

```bash
git add lib/kyc/
git commit -m "feat: #14 KYC schema, pure logic, server actions, identification webhook handler"
```

---

### Task 4: `lib/withdrawals/` rewrite — amount-only request, Paystack-backed resolve, transfer webhook

**Files:**
- Modify: `lib/withdrawals/schema.ts`, `lib/withdrawals/schema.test.ts`,
  `lib/withdrawals/actions.ts`, `lib/withdrawals/admin-actions.ts`
- Create: `lib/withdrawals/webhook.ts`, `lib/withdrawals/webhook.test.ts`

**Interfaces:**
- Consumes: `initiateTransfer`, `buildTransferReference` from `lib/paystack/server.ts`
  (Task 2); `notify`, `prizeKey`, `formatNaira` (existing).
- Produces: `withdrawalSchema` (amount-only now), `requestWithdrawal` (unchanged
  signature, new gating + data source), `resolveWithdrawal` (unchanged signature, new
  Paystack-calling behavior for the `'paid'` action), `transferEventTarget(event):
  'paid' | 'failed' | null`, `applyTransferWebhook(reference, event, reason):
  Promise<'applied' | 'noop' | 'not_found' | 'unknown_event'>`.

- [ ] **Step 1: Update the failing/passing tests for `lib/withdrawals/schema.ts`**

Replace `lib/withdrawals/schema.test.ts` entirely (the schema is now amount-only —
bank fields move to `lib/kyc/schema.ts`, tested in Task 3):

```ts
import { describe, it, expect } from 'vitest'
import { withdrawalSchema } from './schema'

describe('withdrawalSchema', () => {
  it('accepts a valid amount and coerces it to a number', () => {
    const r = withdrawalSchema.safeParse({ amount: '5000' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.amount).toBe(5000)
  })

  it('rejects amounts below the ₦1,000 floor', () => {
    expect(withdrawalSchema.safeParse({ amount: '0' }).success).toBe(false)
    expect(withdrawalSchema.safeParse({ amount: '1' }).success).toBe(false)
    expect(withdrawalSchema.safeParse({ amount: '999' }).success).toBe(false)
  })

  it('accepts the floor exactly', () => {
    expect(withdrawalSchema.safeParse({ amount: '1000' }).success).toBe(true)
  })

  it('rejects a non-integer amount', () => {
    expect(withdrawalSchema.safeParse({ amount: '1500.5' }).success).toBe(false)
  })

  it('rejects amounts over the ceiling', () => {
    expect(withdrawalSchema.safeParse({ amount: '100000001' }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- lib/withdrawals/schema.test.ts`
Expected: FAIL — `withdrawalSchema` still requires `bankName`/`accountName`/`accountNumber`.

- [ ] **Step 3: Rewrite `lib/withdrawals/schema.ts`**

```ts
import { z } from 'zod'

export const withdrawalSchema = z.object({
  amount: z.coerce
    .number()
    .int('Amount must be a whole number of naira')
    .min(1000, 'Minimum withdrawal is ₦1,000')
    .max(100_000_000, 'Amount is too large'),
})

export type WithdrawalInput = z.infer<typeof withdrawalSchema>
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- lib/withdrawals/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test for the pure part of `lib/withdrawals/webhook.ts`**

```ts
// lib/withdrawals/webhook.test.ts
import { describe, it, expect } from 'vitest'
import { transferEventTarget } from './webhook'

describe('transferEventTarget', () => {
  it('maps transfer.success to paid', () => {
    expect(transferEventTarget('transfer.success')).toBe('paid')
  })
  it('maps transfer.failed to failed', () => {
    expect(transferEventTarget('transfer.failed')).toBe('failed')
  })
  it('maps transfer.reversed to failed', () => {
    expect(transferEventTarget('transfer.reversed')).toBe('failed')
  })
  it('returns null for an unrelated event', () => {
    expect(transferEventTarget('charge.success')).toBeNull()
  })
})
```

- [ ] **Step 6: Run to verify it fails**

Run: `npm test -- lib/withdrawals/webhook.test.ts`
Expected: FAIL — `./webhook` does not exist.

- [ ] **Step 7: Implement `lib/withdrawals/webhook.ts`**

```ts
import { createAdminClient } from '@/lib/supabase/admin'
import { notify } from '@/lib/notifications/notify'
import { prizeKey } from '@/lib/notifications/keys'
import { formatNaira } from '@/lib/format'

export type TransferWebhookResult = 'applied' | 'noop' | 'not_found' | 'unknown_event'

// Pure decision: which withdrawal_requests.status a given Paystack transfer
// event should produce. No IO — unit tested directly.
export function transferEventTarget(event: string): 'paid' | 'failed' | null {
  if (event === 'transfer.success') return 'paid'
  if (event === 'transfer.failed' || event === 'transfer.reversed') return 'failed'
  return null
}

export async function applyTransferWebhook(
  reference: string,
  event: string,
  reason: string | null,
): Promise<TransferWebhookResult> {
  const target = transferEventTarget(event)
  if (!target) return 'unknown_event'

  const admin = createAdminClient()
  const { data: wr } = await admin
    .from('withdrawal_requests')
    .select('id, player_id, amount, status')
    .eq('paystack_transfer_reference', reference)
    .maybeSingle()
  if (!wr) return 'not_found'
  if (wr.status === target) return 'noop' // idempotent: Paystack may retry

  if (target === 'paid') {
    await admin
      .from('withdrawal_requests')
      .update({ status: 'paid', resolved_at: new Date().toISOString() })
      .eq('id', wr.id)
      .eq('status', 'processing')
    await notify({
      type: 'prize_credited',
      playerId: wr.player_id,
      dedupeKey: prizeKey(wr.id),
      amount: formatNaira(wr.amount),
    })
  } else {
    await admin
      .from('withdrawal_requests')
      .update({ status: 'failed', admin_note: reason ?? 'Transfer failed' })
      .eq('id', wr.id)
      .eq('status', 'processing')
  }

  return 'applied'
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `npm test -- lib/withdrawals/webhook.test.ts`
Expected: PASS.

- [ ] **Step 9: Rewrite `lib/withdrawals/actions.ts`**

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { withdrawalSchema } from './schema'

export type WithdrawalState = { error?: string; success?: boolean } | undefined

export async function requestWithdrawal(
  _prev: WithdrawalState,
  formData: FormData,
): Promise<WithdrawalState> {
  const parsed = withdrawalSchema.safeParse({ amount: formData.get('amount') })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in to request a withdrawal.' }

  const { data: kyc } = await supabase
    .from('player_kyc')
    .select('kyc_status, payout_bank_name, payout_account_number, payout_account_name')
    .eq('player_id', user.id)
    .maybeSingle()
  if (
    kyc?.kyc_status !== 'verified' ||
    !kyc.payout_bank_name ||
    !kyc.payout_account_number ||
    !kyc.payout_account_name
  ) {
    return { error: 'Verify your identity before requesting a withdrawal.' }
  }

  const { error } = await supabase.from('withdrawal_requests').insert({
    player_id: user.id,
    amount: parsed.data.amount,
    bank_name: kyc.payout_bank_name,
    account_number: kyc.payout_account_number,
    account_name: kyc.payout_account_name,
    status: 'pending',
  })

  if (error) {
    // Partial unique index (one active request per player) surfaces as 23505.
    if ((error as { code?: string }).code === '23505') {
      return { error: 'You already have a pending withdrawal request.' }
    }
    return { error: 'Could not submit your request. Please try again.' }
  }

  revalidatePath('/dashboard')
  return { success: true }
}
```

- [ ] **Step 10: Rewrite `lib/withdrawals/admin-actions.ts`**

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin/auth'
import { initiateTransfer, buildTransferReference } from '@/lib/paystack/server'

export type WithdrawalResolveState = { error?: string; success?: boolean } | undefined

export async function resolveWithdrawal(
  _prev: WithdrawalResolveState,
  formData: FormData,
): Promise<WithdrawalResolveState> {
  await requireAdmin()
  const id = String(formData.get('id') ?? '')
  const action = String(formData.get('action') ?? '')
  const note = String(formData.get('note') ?? '').trim()
  if (!id) return { error: 'Missing request.' }
  if (action !== 'paid' && action !== 'rejected') return { error: 'Choose paid or rejected.' }
  if (action === 'rejected' && !note) return { error: 'Enter a reason for the rejection.' }

  const supabase = createClient()
  const { data: wr } = await supabase
    .from('withdrawal_requests')
    .select('status, player_id, amount')
    .eq('id', id)
    .maybeSingle()
  if (!wr) return { error: 'Request not found.' }

  if (action === 'rejected') {
    if (wr.status !== 'pending') return { error: 'This request has already been resolved.' }
    const { error } = await supabase
      .from('withdrawal_requests')
      .update({ status: 'rejected', admin_note: note || null, resolved_at: new Date().toISOString() })
      .eq('id', id)
    if (error) return { error: 'Could not resolve the request. Please try again.' }
    revalidatePath('/admin/withdrawals')
    revalidatePath('/dashboard')
    return { success: true }
  }

  // action === 'paid': initiate (or retry, from a 'failed' row) the real payout.
  if (wr.status !== 'pending' && wr.status !== 'failed') {
    return { error: 'This request is already being processed or has been resolved.' }
  }

  const { data: kyc } = await supabase
    .from('player_kyc')
    .select('paystack_recipient_code')
    .eq('player_id', wr.player_id)
    .maybeSingle()
  if (!kyc?.paystack_recipient_code) {
    return { error: 'This player has no verified payout account on file.' }
  }

  const reference = buildTransferReference(id)
  let transferCode: string
  try {
    ;({ transferCode } = await initiateTransfer({
      amountKobo: wr.amount * 100,
      recipientCode: kyc.paystack_recipient_code,
      reference,
    }))
  } catch {
    return { error: 'Could not initiate the transfer. Please try again.' }
  }

  const { error } = await supabase
    .from('withdrawal_requests')
    .update({
      status: 'processing',
      admin_note: note || null,
      paystack_transfer_code: transferCode,
      paystack_transfer_reference: reference,
    })
    .eq('id', id)
  if (error) return { error: 'Transfer started but could not update the request record.' }

  revalidatePath('/admin/withdrawals')
  revalidatePath('/dashboard')
  return { success: true }
}
```

Note: the `prize_credited` notification is **removed** from this file — it now fires
from `applyTransferWebhook` (Step 7) on confirmed settlement, not on admin click.

- [ ] **Step 11: `npx tsc --noEmit`**

Expected: no new errors.

- [ ] **Step 12: Commit**

```bash
git add lib/withdrawals/
git commit -m "feat: #14 amount-only withdrawal request, Paystack-backed admin resolve, transfer webhook handler"
```

---

### Task 5: Wire both webhook handlers into the Paystack webhook route

**Files:**
- Modify: `app/api/paystack/webhook/route.ts`

**Interfaces:**
- Consumes: `applyIdentificationWebhook` (Task 3), `applyTransferWebhook` (Task 4),
  `verifyWebhookSignature` + `confirmRegistration` (existing, unchanged).

⚠️ **Assumption to verify during manual QA:** the exact JSON shape of
`customeridentification.*` and `transfer.*` webhook payloads could not be confirmed
against live Paystack documentation while writing this plan (public docs pages
returned 403 to automated fetches; only search-result summaries were available). The
extraction below assumes Paystack's general convention of a nested `data.customer.
customer_code` for identification events (matching the shape of `data.customer` on
`charge.success` events) and `data.reference` + `data.reason`/`data.message` for
transfer events. **Before relying on this in production**, trigger a real test event
from the Paystack dashboard's webhook log (or capture a real sandbox event) and
compare the actual payload against the extraction below — adjust the field paths if
they differ. This does not block shipping the code, but does block trusting it live
without that one manual check.

- [ ] **Step 1: Rewrite `app/api/paystack/webhook/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { verifyWebhookSignature } from '@/lib/paystack/server'
import { confirmRegistration } from '@/lib/tournaments/confirm'
import { applyIdentificationWebhook } from '@/lib/kyc/webhook'
import { applyTransferWebhook } from '@/lib/withdrawals/webhook'

export const runtime = 'nodejs'

// Machine-to-machine. Fires independently of the user's browser — the reliable
// source of truth for payment, identification, and transfer status.
export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const signature = req.headers.get('x-paystack-signature')

  if (!verifyWebhookSignature(rawBody, signature)) {
    return new NextResponse('Invalid signature', { status: 401 })
  }

  let event: {
    event?: string
    data?: {
      reference?: string
      reason?: string
      message?: string
      customer?: { customer_code?: string }
    }
  }
  try {
    event = JSON.parse(rawBody)
  } catch {
    return new NextResponse('Bad payload', { status: 400 })
  }

  const type = event.event

  if (type === 'charge.success' && event.data?.reference) {
    await confirmRegistration(event.data.reference)
  } else if (type === 'customeridentification.success' || type === 'customeridentification.failed') {
    const customerCode = event.data?.customer?.customer_code
    if (customerCode) {
      await applyIdentificationWebhook(customerCode, type, event.data?.message ?? null)
    }
  } else if (
    type === 'transfer.success' ||
    type === 'transfer.failed' ||
    type === 'transfer.reversed'
  ) {
    if (event.data?.reference) {
      await applyTransferWebhook(
        event.data.reference,
        type,
        event.data?.reason ?? event.data?.message ?? null,
      )
    }
  }

  // Always 200 on a well-formed, signed request; Paystack retries non-2xx.
  return new NextResponse('ok', { status: 200 })
}
```

- [ ] **Step 2: `npx tsc --noEmit`**

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/paystack/webhook/route.ts
git commit -m "feat: #14 handle identification + transfer events on the Paystack webhook route"
```

---

### Task 6: `FormField` extraction + `KycForm` component

**Files:**
- Create: `components/dashboard/FormField.tsx`, `components/dashboard/KycForm.tsx`
- Modify: `components/dashboard/WithdrawalPanel.tsx:78-99` (remove the local `Field`,
  import the extracted one — done together with Task 7's rewrite, not here)

**Interfaces:**
- Consumes: `submitKyc`, `resolveAccountName`, `type KycState` from `lib/kyc/actions.ts`
  (Task 3).
- Produces: `Field` component (props: `name`, `label`, `type?`, plus any
  `InputHTMLAttributes<HTMLInputElement>`); `KycForm` component (props: `banks: {
  name: string; code: string }[]`, `failureReason?: string | null`).

- [ ] **Step 1: Extract `components/dashboard/FormField.tsx`**

```tsx
import type { InputHTMLAttributes } from 'react'

export function Field({
  name,
  label,
  type = 'text',
  ...rest
}: { name: string; label: string; type?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="text-sm font-medium text-slate-300">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required
        {...rest}
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
      />
    </div>
  )
}
```

- [ ] **Step 2: Write `components/dashboard/KycForm.tsx`**

```tsx
'use client'
import { useState, useTransition } from 'react'
import { useFormState } from 'react-dom'
import { submitKyc, resolveAccountName, type KycState } from '@/lib/kyc/actions'
import { Field } from './FormField'

export function KycForm({
  banks,
  failureReason,
}: {
  banks: { name: string; code: string }[]
  failureReason?: string | null
}) {
  const [state, formAction] = useFormState<KycState, FormData>(submitKyc, undefined)
  const [bankCode, setBankCode] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [resolvedName, setResolvedName] = useState<string | null>(null)
  const [resolveError, setResolveError] = useState<string | null>(null)
  const [isResolving, startResolving] = useTransition()

  function handleAccountBlur() {
    setResolvedName(null)
    setResolveError(null)
    if (!bankCode || !/^\d{10}$/.test(accountNumber)) return
    startResolving(async () => {
      const result = await resolveAccountName(bankCode, accountNumber)
      if (result.error) setResolveError(result.error)
      else setResolvedName(result.accountName ?? null)
    })
  }

  return (
    <form action={formAction} className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <p className="text-sm text-slate-400">
        Verify your identity once with your BVN and payout bank account. This account
        will receive every future prize withdrawal.
      </p>
      {failureReason && <p className="text-sm text-red-400">{failureReason}</p>}

      <div className="space-y-1.5">
        <label htmlFor="bankCode" className="text-sm font-medium text-slate-300">
          Bank
        </label>
        <select
          id="bankCode"
          name="bankCode"
          required
          value={bankCode}
          onChange={(e) => {
            setBankCode(e.target.value)
            setResolvedName(null)
          }}
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
        >
          <option value="">Select your bank</option>
          {banks.map((b) => (
            <option key={b.code} value={b.code}>
              {b.name}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="accountNumber" className="text-sm font-medium text-slate-300">
          Account number
        </label>
        <input
          id="accountNumber"
          name="accountNumber"
          required
          inputMode="numeric"
          maxLength={10}
          placeholder="10-digit NUBAN"
          value={accountNumber}
          onChange={(e) => setAccountNumber(e.target.value)}
          onBlur={handleAccountBlur}
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
        />
        {isResolving && <p className="text-xs text-slate-500">Checking account…</p>}
        {resolvedName && <p className="text-xs text-emerald-400">Resolved: {resolvedName}</p>}
        {resolveError && <p className="text-xs text-red-400">{resolveError}</p>}
      </div>

      <Field name="bvn" label="BVN" inputMode="numeric" maxLength={11} placeholder="11-digit BVN" />
      <Field name="firstName" label="First name" placeholder="As on your BVN" />
      <Field name="lastName" label="Last name" placeholder="As on your BVN" />

      {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
      <button
        type="submit"
        disabled={!resolvedName}
        className="w-full rounded-xl bg-violet-600 px-7 py-3 text-sm font-bold text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Verify identity
      </button>
    </form>
  )
}
```

- [ ] **Step 3: `npx tsc --noEmit`**

Expected: no new errors (this component isn't consumed anywhere yet, but must
typecheck on its own).

- [ ] **Step 4: Commit**

```bash
git add components/dashboard/FormField.tsx components/dashboard/KycForm.tsx
git commit -m "feat: #14 extract FormField, add KycForm (BVN + bank + auto-resolve)"
```

---

### Task 7: `WithdrawalPanel` rewrite — branch on KYC status

**Files:**
- Modify: `components/dashboard/WithdrawalPanel.tsx` (full rewrite)

**Interfaces:**
- Consumes: `kycPanelMode`, `maskAccountNumber` from `lib/kyc/logic.ts` (Task 3),
  `KycForm` (Task 6), `Field` from `./FormField` (Task 6), `requestWithdrawal` (Task 4,
  unchanged export name).
- Produces: `WithdrawalRow` (unchanged shape), `PayoutAccount { bankName,
  accountNumber, accountName }`, `WithdrawalPanel` props: `requests: WithdrawalRow[]`,
  `hasActive: boolean` (renamed from `hasPending`), `kycStatus: string`,
  `kycFailureReason: string | null`, `banks: { name: string; code: string }[]`,
  `payoutAccount: PayoutAccount | null`.

- [ ] **Step 1: Rewrite `components/dashboard/WithdrawalPanel.tsx`**

```tsx
'use client'
import { useFormState } from 'react-dom'
import { requestWithdrawal, type WithdrawalState } from '@/lib/withdrawals/actions'
import { formatDate, formatNaira } from '@/lib/format'
import { maskAccountNumber, kycPanelMode } from '@/lib/kyc/logic'
import { KycForm } from './KycForm'
import { Field } from './FormField'

export interface WithdrawalRow {
  id: string
  amount: number
  bank_name: string
  account_number: string
  account_name: string
  status: string
  admin_note: string | null
  requested_at: string
  resolved_at: string | null
}

export interface PayoutAccount {
  bankName: string
  accountNumber: string
  accountName: string
}

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Pending review', cls: 'text-amber-400' },
  processing: { label: 'Processing payout', cls: 'text-sky-400' },
  paid: { label: 'Paid', cls: 'text-emerald-400' },
  rejected: { label: 'Rejected', cls: 'text-red-400' },
  failed: { label: 'Payout failed', cls: 'text-red-400' },
}

export function WithdrawalPanel({
  requests,
  hasActive,
  kycStatus,
  kycFailureReason,
  banks,
  payoutAccount,
}: {
  requests: WithdrawalRow[]
  hasActive: boolean
  kycStatus: string
  kycFailureReason: string | null
  banks: { name: string; code: string }[]
  payoutAccount: PayoutAccount | null
}) {
  const mode = kycPanelMode(kycStatus)

  return (
    <section className="mb-10">
      <h2 className="mb-4 text-base font-bold text-white">Withdrawals</h2>

      {mode === 'form' && <KycForm banks={banks} failureReason={kycFailureReason} />}
      {mode === 'pending' && (
        <div className="rounded-2xl border border-sky-500/30 bg-sky-500/10 p-5 text-center text-sm font-semibold text-sky-300">
          Verifying your identity — usually completes within a few minutes.
        </div>
      )}
      {mode === 'verified' && payoutAccount && (
        <VerifiedWithdrawalForm hasActive={hasActive} payoutAccount={payoutAccount} />
      )}

      {requests.length > 0 && (
        <div className="mt-4 space-y-2">
          {requests.map((r) => (
            <RequestRow key={r.id} req={r} />
          ))}
        </div>
      )}
    </section>
  )
}

function VerifiedWithdrawalForm({
  hasActive,
  payoutAccount,
}: {
  hasActive: boolean
  payoutAccount: PayoutAccount
}) {
  const [state, formAction] = useFormState<WithdrawalState, FormData>(requestWithdrawal, undefined)

  return (
    <div className="space-y-3">
      <p className="rounded-xl border border-slate-800 bg-slate-900/50 p-3 text-xs text-slate-400">
        Paid to: <span className="text-slate-200">{payoutAccount.bankName}</span>{' '}
        {maskAccountNumber(payoutAccount.accountNumber)} {payoutAccount.accountName}
      </p>
      {hasActive || state?.success ? (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-center text-sm font-semibold text-amber-300">
          Request pending — we&apos;ll be in touch once it&apos;s reviewed.
        </div>
      ) : (
        <form
          action={formAction}
          className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-5"
        >
          <Field name="amount" label="Amount (₦)" type="number" min={1000} placeholder="1000" />
          {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
          <button
            type="submit"
            className="w-full rounded-xl bg-violet-600 px-7 py-3 text-sm font-bold text-white transition-colors hover:bg-violet-500"
          >
            Request withdrawal
          </button>
        </form>
      )}
    </div>
  )
}

function RequestRow({ req }: { req: WithdrawalRow }) {
  const s = STATUS[req.status] ?? { label: req.status, cls: 'text-slate-400' }
  const when = formatDate(req.resolved_at ?? req.requested_at) ?? ''
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-bold text-white">{formatNaira(req.amount)}</p>
        <span className={`text-xs font-semibold ${s.cls}`}>{s.label}</span>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {req.bank_name} · {req.account_number}
        {when ? ` · ${when}` : ''}
      </p>
      {req.admin_note && <p className="mt-1 text-xs text-slate-400">Note: {req.admin_note}</p>}
    </div>
  )
}
```

- [ ] **Step 2: `npx tsc --noEmit`**

Expected: errors at this point are expected and OK — `app/dashboard/page.tsx` (Task 8)
still calls `<WithdrawalPanel requests={withdrawals} hasPending={hasPending} />` with
the old prop shape. Confirm the *only* new errors are inside
`app/dashboard/page.tsx` referencing the old `hasPending` prop / missing new props —
if errors appear anywhere else, stop and investigate before continuing.

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/WithdrawalPanel.tsx
git commit -m "feat: #14 WithdrawalPanel branches on KYC status (form/pending/verified)"
```

---

### Task 8: Dashboard page — fetch `player_kyc` row + bank list, wire new props

**Files:**
- Modify: `app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `listBanks`, `type Bank` from `lib/paystack/server.ts` (Task 2);
  `WithdrawalPanel`, `type PayoutAccount` from `components/dashboard/WithdrawalPanel.tsx`
  (Task 7).

- [ ] **Step 1: Add the import**

In `app/dashboard/page.tsx`, alongside the existing imports (around line 8):

```ts
import { listBanks, type Bank } from '@/lib/paystack/server'
```

- [ ] **Step 2: Add a `player_kyc` query and the banks fetch to the parallel query**

`player_kyc` is intentionally a separate table from `profiles` (see Task 1) — query it
separately rather than joining it onto the `profileRes` select. Add two new entries to
the destructured `Promise.all` array (`app/dashboard/page.tsx:34-79`) — update both the
destructuring line and the array:

```ts
  const [
    profileRes,
    matchesRes,
    resultsRes,
    regsRes,
    wrRes,
    listingsRes,
    ordersRes,
    salesRes,
    kycRes,
    banks,
  ] = await Promise.all([
    // ...all 8 existing entries, unchanged...
    supabase
      .from('player_kyc')
      .select('kyc_status, kyc_failure_reason, payout_bank_name, payout_account_number, payout_account_name')
      .eq('player_id', user.id)
      .maybeSingle(),
    listBanks().catch(() => [] as Bank[]),
  ])
```

- [ ] **Step 3: Compute `payoutAccount` and `hasActive`**

Replace `app/dashboard/page.tsx:136-137`:

```ts
  const kyc = kycRes.data
  const withdrawals = (wrRes.data ?? []) as WithdrawalRow[]
  const hasActive = withdrawals.some((w) => w.status === 'pending' || w.status === 'processing')
  const payoutAccount =
    kyc?.payout_bank_name && kyc?.payout_account_number && kyc?.payout_account_name
      ? {
          bankName: kyc.payout_bank_name,
          accountNumber: kyc.payout_account_number,
          accountName: kyc.payout_account_name,
        }
      : null
```

- [ ] **Step 4: Update the `WithdrawalPanel` call site**

Replace `app/dashboard/page.tsx:162`:

```tsx
      <WithdrawalPanel
        requests={withdrawals}
        hasActive={hasActive}
        kycStatus={kyc?.kyc_status ?? 'unverified'}
        kycFailureReason={kyc?.kyc_failure_reason ?? null}
        banks={banks}
        payoutAccount={payoutAccount}
      />
```

- [ ] **Step 5: `npx tsc --noEmit`**

Expected: no errors.

- [ ] **Step 6: `npm run build`**

Expected: clean build.

- [ ] **Step 7: Commit**

```bash
git add app/dashboard/page.tsx
git commit -m "feat: #14 dashboard fetches player_kyc row + bank list, wires WithdrawalPanel"
```

---

### Task 9: Admin withdrawals queue — failed/retry state, processing section

**Files:**
- Modify: `components/admin/WithdrawalQueueRow.tsx` (full rewrite),
  `app/admin/withdrawals/page.tsx` (full rewrite)

**Interfaces:**
- Consumes: `resolveWithdrawal` from `lib/withdrawals/admin-actions.ts` (Task 4,
  unchanged export).
- Produces: `PendingWithdrawal { id, playerName, amount, bankName, accountNumber,
  accountName, status: 'pending' | 'failed', adminNote: string | null }`.

- [ ] **Step 1: Rewrite `components/admin/WithdrawalQueueRow.tsx`**

```tsx
'use client'
import { useFormState } from 'react-dom'
import { resolveWithdrawal, type WithdrawalResolveState } from '@/lib/withdrawals/admin-actions'
import { formatNaira } from '@/lib/format'

export interface PendingWithdrawal {
  id: string
  playerName: string
  amount: number
  bankName: string
  accountNumber: string
  accountName: string
  status: 'pending' | 'failed'
  adminNote: string | null
}

export function WithdrawalQueueRow({ req }: { req: PendingWithdrawal }) {
  const [state, action] = useFormState<WithdrawalResolveState, FormData>(resolveWithdrawal, undefined)
  const isFailed = req.status === 'failed'

  return (
    <form action={action} className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <input type="hidden" name="id" value={req.id} />
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 truncate font-bold text-white">{req.playerName}</p>
        <p className="shrink-0 font-black text-white">{formatNaira(req.amount)}</p>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {req.bankName} · {req.accountNumber} · {req.accountName}
      </p>
      {isFailed && req.adminNote && (
        <p className="mt-2 text-xs text-red-400">Last attempt failed: {req.adminNote}</p>
      )}
      {!isFailed && (
        <textarea
          name="note"
          rows={2}
          placeholder="Note (required to reject)"
          className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
        />
      )}
      {state?.error && <p className="mt-2 text-sm text-red-400">{state.error}</p>}
      <div className="mt-2 flex gap-2">
        <button
          type="submit"
          name="action"
          value="paid"
          className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500"
        >
          {isFailed ? 'Retry payout' : 'Pay'}
        </button>
        {!isFailed && (
          <button
            type="submit"
            name="action"
            value="rejected"
            className="rounded-lg border border-red-500/40 px-4 py-2 text-xs font-bold text-red-400 hover:bg-red-500/10"
          >
            Reject
          </button>
        )}
      </div>
    </form>
  )
}
```

- [ ] **Step 2: Rewrite `app/admin/withdrawals/page.tsx`**

```tsx
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin/auth'
import { formatDate, formatNaira } from '@/lib/format'
import { WithdrawalQueueRow, type PendingWithdrawal } from '@/components/admin/WithdrawalQueueRow'

export const metadata: Metadata = { title: 'Withdrawals · Admin · SentinelX' }

type ProfileRef = { username: string | null; display_name: string | null } | null
function nameOf(p: ProfileRef): string {
  return p?.display_name ?? p?.username ?? 'Player'
}
function firstP(p: ProfileRef | ProfileRef[]): ProfileRef {
  return Array.isArray(p) ? p[0] ?? null : p
}
const RESOLVED_STATUS: Record<string, string> = {
  paid: 'text-emerald-400',
  rejected: 'text-red-400',
}

export default async function AdminWithdrawalsPage() {
  await requireAdmin()
  const supabase = createClient()
  const [{ data: queueData }, { data: processingData }, { data: resolvedData }] = await Promise.all([
    supabase
      .from('withdrawal_requests')
      .select(
        'id, amount, bank_name, account_number, account_name, status, admin_note, profiles(username, display_name)',
      )
      .in('status', ['pending', 'failed'])
      .order('requested_at', { ascending: true }),
    supabase
      .from('withdrawal_requests')
      .select('id, amount, profiles(username, display_name)')
      .eq('status', 'processing')
      .order('requested_at', { ascending: true }),
    supabase
      .from('withdrawal_requests')
      .select('id, amount, status, admin_note, resolved_at, profiles(username, display_name)')
      .in('status', ['paid', 'rejected'])
      .order('resolved_at', { ascending: false })
      .limit(20),
  ])

  const queue: PendingWithdrawal[] = ((queueData as unknown[] | null) ?? []).map((raw) => {
    const w = raw as {
      id: string
      amount: number
      bank_name: string
      account_number: string
      account_name: string
      status: 'pending' | 'failed'
      admin_note: string | null
      profiles: ProfileRef | ProfileRef[]
    }
    return {
      id: w.id,
      playerName: nameOf(firstP(w.profiles)),
      amount: w.amount,
      bankName: w.bank_name,
      accountNumber: w.account_number,
      accountName: w.account_name,
      status: w.status,
      adminNote: w.admin_note,
    }
  })

  const processing = ((processingData as unknown[] | null) ?? []).map((raw) => {
    const w = raw as { id: string; amount: number; profiles: ProfileRef | ProfileRef[] }
    return { id: w.id, playerName: nameOf(firstP(w.profiles)), amount: w.amount }
  })

  const resolved = ((resolvedData as unknown[] | null) ?? []).map((raw) => {
    const w = raw as {
      id: string
      amount: number
      status: string
      admin_note: string | null
      resolved_at: string | null
      profiles: ProfileRef | ProfileRef[]
    }
    return {
      id: w.id,
      playerName: nameOf(firstP(w.profiles)),
      amount: w.amount,
      status: w.status,
      adminNote: w.admin_note,
      resolvedAt: w.resolved_at,
    }
  })

  return (
    <section className="space-y-8">
      <div>
        <h2 className="mb-4 text-base font-bold text-white">Needs action</h2>
        {queue.length === 0 ? (
          <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center text-sm text-slate-500">
            No withdrawals need action.
          </p>
        ) : (
          <div className="space-y-2">
            {queue.map((req) => (
              <WithdrawalQueueRow key={req.id} req={req} />
            ))}
          </div>
        )}
      </div>

      {processing.length > 0 && (
        <div>
          <h2 className="mb-4 text-base font-bold text-white">Processing (awaiting confirmation)</h2>
          <div className="space-y-2">
            {processing.map((p) => (
              <div key={p.id} className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="min-w-0 truncate font-bold text-white">{p.playerName}</p>
                  <p className="shrink-0 text-sm font-semibold text-sky-400">{formatNaira(p.amount)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {resolved.length > 0 && (
        <div>
          <h2 className="mb-4 text-base font-bold text-white">Recently resolved</h2>
          <div className="space-y-2">
            {resolved.map((r) => (
              <div key={r.id} className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="min-w-0 truncate font-bold text-white">{r.playerName}</p>
                  <p className="shrink-0 text-sm">
                    {formatNaira(r.amount)}{' '}
                    <span className={`font-semibold ${RESOLVED_STATUS[r.status] ?? 'text-slate-400'}`}>
                      {r.status}
                    </span>
                  </p>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {formatDate(r.resolvedAt) ?? ''}
                  {r.adminNote ? ` · ${r.adminNote}` : ''}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 3: `npx tsc --noEmit`**

Expected: no errors.

- [ ] **Step 4: `npm run build`**

Expected: clean build.

- [ ] **Step 5: Commit**

```bash
git add components/admin/WithdrawalQueueRow.tsx app/admin/withdrawals/page.tsx
git commit -m "feat: #14 admin queue: failed/retry state, processing (awaiting confirmation) section"
```

---

### Task 10: Full verification, CLAUDE.md/ROADMAP.md update, final commit

**Files:**
- Modify: `CLAUDE.md`, `ROADMAP.md`

**Interfaces:** none (documentation + verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including every new file from Tasks 2–4.

- [ ] **Step 2: Full typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: both clean.

- [ ] **Step 3: Manual QA checklist (requires the Paystack dashboard OTP toggle from
  this plan's header already turned off, and test-mode Paystack keys with a funded
  test balance)**

Walk the flow live in the running dev server:
1. As a test player with `kyc_status = 'unverified'`, open `/dashboard` — confirm the
   `KycForm` renders (not the withdrawal form), bank dropdown is populated.
2. Enter a valid test account number + a listed bank code; confirm the resolved name
   appears and the submit button un-disables.
3. Submit with a valid-format test BVN; confirm the panel switches to the "Verifying
   your identity" pending state and `player_kyc.kyc_status` is `'pending'` in the DB
   (a new `player_kyc` row should now exist for this player).
4. Trigger (or wait for) the `customeridentification.success` webhook; confirm
   `player_kyc.kyc_status` becomes `'verified'`, `profiles.kyc_verified` becomes
   `true`, and `player_kyc.paystack_recipient_code` is populated — **this is the step
   that validates the payload-shape assumption flagged in Task 5**; if the webhook
   doesn't apply, capture the real payload from the Paystack dashboard's webhook log
   and fix the extraction in `app/api/paystack/webhook/route.ts` before continuing.
5. Reload `/dashboard` — confirm the amount-only withdrawal form now renders with the
   verified account shown read-only.
6. Submit a withdrawal request; confirm it lands in `/admin/withdrawals` under "Needs
   action".
7. As admin, click "Pay"; confirm the row disappears from "Needs action" and appears
   under "Processing (awaiting confirmation)", and `paystack_transfer_reference` /
   `paystack_transfer_code` are populated on the row.
8. Trigger (or wait for) the `transfer.success` webhook; confirm the row moves to
   "Recently resolved" as `paid`, and the player's WhatsApp `prize_credited`
   notification fires (or no-ops cleanly if Termii isn't configured, per the existing
   ready-to-activate pattern).
9. Repeat steps 6–7 but force a `transfer.failed` webhook (or a deliberately invalid
   test recipient) — confirm the row appears back under "Needs action" with status
   `failed` and the failure reason visible, and "Retry payout" successfully re-attempts.

- [ ] **Step 4: Update `CLAUDE.md`**

In the "Payments — Paystack" section, replace the line:

```
- KYC required before first withdrawal (BVN or NIN via Paystack)
```

with:

```
- KYC required before first withdrawal (BVN via Paystack, validated against the payout bank account — Paystack's identification API does not support NIN as of this writing)
```

- [ ] **Step 5: Update `ROADMAP.md`**

Change the `14` row's status from `⬜` to `✅`, and add a summary line beneath the
v3.0 table matching the existing convention (see the `★ v2.0 COMPLETE` line):

```
**★ v3.0 COMPLETE (#13a–#14).** Gaming Exchange (catalog + escrow) and BVN KYC +
Paystack Transfer prize withdrawals all shipped.
```

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md ROADMAP.md
git commit -m "docs: mark #14 KYC + Paystack Transfer withdrawals complete"
```
