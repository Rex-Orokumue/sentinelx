# Referral Program (#22) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Players get a `/signup?ref=<username>` link that credits the referrer ₦100 (to a balance kept entirely separate from prize money) once the referred player confirms their email. At 5+ referrals a player can request a manual payout, reviewed by the admin in a new `/admin/referrals` queue that shows their referred players for fraud verification.

**Architecture:** New tables (`referrals`, `referral_withdrawal_requests`) plus a `profiles.referred_by` column, all additive. Credit fires from `app/auth/confirm/route.ts` at signup-email-confirmation, not raw signup. Balance is derived at read time from the `referrals` count and non-rejected withdrawal requests — never stored. Player-facing and admin-facing code mirrors the existing `lib/withdrawals/*` / `/admin/withdrawals` files file-for-file, since this is a parallel, independent money flow with the same manual-resolution shape.

**Tech Stack:** Next.js 14 App Router (Server Actions, Server Components), Supabase (Postgres + RLS), Zod, Vitest, Tailwind.

## Global Constraints

- Referral withdrawals are **entirely separate** from `withdrawal_requests` — own table, own admin queue, no shared rows.
- Payout resolution is **manual** (admin marks `paid` directly, no Paystack call) — matching prize withdrawals' current state. Do not re-enable Paystack Transfer for either flow as part of this plan.
- ₦100 credit fires only when the referred player **confirms their email** (`type=signup` in `app/auth/confirm/route.ts`), never at raw signup.
- Referral code is the referrer's own **username** — no new code-generation.
- Balance formula: `(referral count × ₦100) − (sum of amount where status IN ('pending','paid'))`. `rejected` requests do not reduce balance.
- Referral withdrawal requires `player_kyc.kyc_status = 'verified'`, same gate as prize withdrawals.
- Admin review is **admin-only** (`requireAdmin()`), not moderator-accessible — matches `withdrawal_requests`' `is_admin()`-only update policy (financial action).
- Migration file: `supabase/migrations/019_referral_program.sql` (next after `018_profile_edit.sql`).

---

### Task 1: Migration — schema, RLS, and signup trigger update

**Files:**
- Create: `supabase/migrations/019_referral_program.sql`

**Interfaces:**
- Produces: `public.profiles.referred_by` (uuid, nullable), `public.referrals` (`id, referrer_id, referred_id UNIQUE, created_at`), `public.referral_withdrawal_requests` (`id, player_id, amount, bank_name, account_number, account_name, status, admin_note, requested_at, resolved_at`), updated `public.handle_new_user()` trigger function.

- [ ] **Step 1: Write the migration file**

```sql
-- =============================================================
-- Referral program (#22): referred_by, referrals log, referral
-- withdrawal requests — entirely separate from withdrawal_requests.
-- =============================================================

-- Set once at signup via handle_new_user(); never edited afterward.
ALTER TABLE public.profiles ADD COLUMN referred_by uuid REFERENCES public.profiles(id);

-- One row per CONFIRMED referral (credited at email verification — see
-- app/auth/confirm/route.ts — not raw signup). Source of truth; referral
-- balance is derived from this, never stored directly.
CREATE TABLE public.referrals (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid        NOT NULL REFERENCES public.profiles(id),
  referred_id uuid        NOT NULL REFERENCES public.profiles(id) UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.referrals (referrer_id);

-- Entirely separate from withdrawal_requests (prize money). Same shape,
-- same manual-resolution flow as withdrawal_requests, different table.
CREATE TABLE public.referral_withdrawal_requests (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id      uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount         integer     NOT NULL CHECK (amount > 0),
  bank_name      text        NOT NULL,
  account_number text        NOT NULL,
  account_name   text        NOT NULL,
  status         text        NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'rejected', 'paid')),
  admin_note     text,
  requested_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at    timestamptz
);
CREATE INDEX ON public.referral_withdrawal_requests (player_id);
CREATE INDEX ON public.referral_withdrawal_requests (status);

-- At most one pending referral withdrawal per player at a time.
CREATE UNIQUE INDEX referral_withdrawal_requests_one_pending_per_player
  ON public.referral_withdrawal_requests (player_id) WHERE status = 'pending';

ALTER TABLE public.referrals                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_withdrawal_requests  ENABLE ROW LEVEL SECURITY;

-- referrals: referrer reads their own referral log; admin reads all
-- (money-adjacent, matches the withdrawal_requests admin-only read).
-- No client INSERT policy at all — the only writer is
-- app/auth/confirm/route.ts via the service-role admin client.
CREATE POLICY "referrals_own_or_admin_read" ON public.referrals
  FOR SELECT USING (referrer_id = auth.uid() OR public.is_admin());

-- referral_withdrawal_requests: mirrors withdrawal_requests exactly.
CREATE POLICY "rwr_own_insert" ON public.referral_withdrawal_requests
  FOR INSERT WITH CHECK (player_id = auth.uid() AND status = 'pending');
CREATE POLICY "rwr_own_or_admin_read" ON public.referral_withdrawal_requests
  FOR SELECT USING (player_id = auth.uid() OR public.is_admin());
CREATE POLICY "rwr_admin_update" ON public.referral_withdrawal_requests
  FOR UPDATE USING (public.is_admin());

-- Extend the existing signup trigger to also resolve a referral code (the
-- referrer's username, passed through as raw_user_meta_data->>'ref') into
-- referred_by. Unknown or missing ref codes resolve to NULL silently — no
-- signup error over a bad/stale referral link.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, username, display_name, referred_by)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'username',
    NEW.raw_user_meta_data->>'username',
    (SELECT id FROM public.profiles WHERE username = NEW.raw_user_meta_data->>'ref')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
```

- [ ] **Step 2: Apply the migration**

Try `supabase db push --dry-run` first, then `supabase db push --yes` if the dry-run output looks correct. If the CLI can't reach the DB directly (a prior session hit `LegacyDbConfigConnectTempRoleError` connection timeouts from this environment), use the `mcp__claude_ai_Supabase__apply_migration` tool instead — **ask the user to confirm before applying**, since Claude Code's auto-mode classifier blocks blind schema applies via that tool without explicit sign-off. Show the exact SQL when asking, as was done for migration 018.

- [ ] **Step 3: Regenerate Supabase types**

Via `mcp__claude_ai_Supabase__generate_typescript_types` (project_id `itxubrkbropttfdackmi`) if the CLI's `supabase gen types typescript` isn't reachable either — same connectivity caveat as Step 2. Overwrite `lib/supabase/types.ts` with the full regenerated output, preserving its existing header format exactly (starts with `export type Json =`).

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: no new errors (confirms the new tables/column are visible to TypeScript).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/019_referral_program.sql lib/supabase/types.ts
git commit -m "feat: #22 referral schema — referred_by, referrals log, referral_withdrawal_requests"
```

---

### Task 2: `lib/referrals/balance.ts` — derived balance calculation (pure, TDD)

**Files:**
- Create: `lib/referrals/balance.ts`
- Test: `lib/referrals/balance.test.ts`

**Interfaces:**
- Produces: `REFERRAL_CREDIT_NGN` (100), `REFERRAL_MIN_COUNT` (5), `computeReferralBalance(referralCount: number, withdrawals: { status: string; amount: number }[]): number`, `isEligibleForReferralWithdrawal(referralCount: number): boolean`.
- Consumed by: `lib/referrals/actions.ts` (Task 4), `components/dashboard/ReferralPanel.tsx` (Task 6).

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from 'vitest'
import { computeReferralBalance, isEligibleForReferralWithdrawal, REFERRAL_MIN_COUNT } from './balance'

describe('computeReferralBalance', () => {
  it('is zero with no referrals', () => {
    expect(computeReferralBalance(0, [])).toBe(0)
  })

  it('is referralCount * 100 with no withdrawals', () => {
    expect(computeReferralBalance(5, [])).toBe(500)
  })

  it('subtracts pending withdrawals', () => {
    expect(computeReferralBalance(5, [{ status: 'pending', amount: 200 }])).toBe(300)
  })

  it('subtracts paid withdrawals', () => {
    expect(computeReferralBalance(5, [{ status: 'paid', amount: 500 }])).toBe(0)
  })

  it('does not subtract rejected withdrawals', () => {
    expect(computeReferralBalance(5, [{ status: 'rejected', amount: 500 }])).toBe(500)
  })

  it('handles a mix of statuses', () => {
    const withdrawals = [
      { status: 'paid', amount: 200 },
      { status: 'rejected', amount: 300 },
      { status: 'pending', amount: 100 },
    ]
    // 10 referrals = 1000; paid 200 + pending 100 = 300 reserved; rejected ignored
    expect(computeReferralBalance(10, withdrawals)).toBe(700)
  })
})

describe('isEligibleForReferralWithdrawal', () => {
  it('is false below the threshold', () => {
    expect(isEligibleForReferralWithdrawal(REFERRAL_MIN_COUNT - 1)).toBe(false)
  })

  it('is true at the threshold', () => {
    expect(isEligibleForReferralWithdrawal(REFERRAL_MIN_COUNT)).toBe(true)
  })

  it('is true above the threshold', () => {
    expect(isEligibleForReferralWithdrawal(REFERRAL_MIN_COUNT + 3)).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/referrals/balance.test.ts`
Expected: FAIL — `Cannot find module './balance'`

- [ ] **Step 3: Write the implementation**

```typescript
export const REFERRAL_CREDIT_NGN = 100
export const REFERRAL_MIN_COUNT = 5

// Derived, never stored: total earned minus whatever is already spoken for
// by a pending or paid request. Rejected requests free the amount back up.
export function computeReferralBalance(
  referralCount: number,
  withdrawals: { status: string; amount: number }[],
): number {
  const earned = referralCount * REFERRAL_CREDIT_NGN
  const reserved = withdrawals
    .filter((w) => w.status === 'pending' || w.status === 'paid')
    .reduce((sum, w) => sum + w.amount, 0)
  return earned - reserved
}

export function isEligibleForReferralWithdrawal(referralCount: number): boolean {
  return referralCount >= REFERRAL_MIN_COUNT
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/referrals/balance.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/referrals/balance.ts lib/referrals/balance.test.ts
git commit -m "feat: #22 derived referral balance calculation"
```

---

### Task 3: `lib/referrals/schema.ts` — withdrawal amount validation

**Files:**
- Create: `lib/referrals/schema.ts`
- Test: `lib/referrals/schema.test.ts`

**Interfaces:**
- Produces: `referralWithdrawalSchema` (Zod object with `amount: number`), `ReferralWithdrawalInput` type.
- Consumed by: `lib/referrals/actions.ts` (Task 4).

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from 'vitest'
import { referralWithdrawalSchema } from './schema'

describe('referralWithdrawalSchema', () => {
  it('accepts a valid amount', () => {
    expect(referralWithdrawalSchema.safeParse({ amount: '500' }).success).toBe(true)
  })

  it('rejects an amount below the 500 minimum', () => {
    expect(referralWithdrawalSchema.safeParse({ amount: '100' }).success).toBe(false)
  })

  it('rejects a non-integer amount', () => {
    expect(referralWithdrawalSchema.safeParse({ amount: '500.5' }).success).toBe(false)
  })

  it('coerces a numeric string', () => {
    const r = referralWithdrawalSchema.safeParse({ amount: '600' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.amount).toBe(600)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/referrals/schema.test.ts`
Expected: FAIL — `Cannot find module './schema'`

- [ ] **Step 3: Write the implementation**

```typescript
import { z } from 'zod'

export const referralWithdrawalSchema = z.object({
  amount: z.coerce
    .number()
    .int('Amount must be a whole number of naira')
    .min(500, 'Minimum withdrawal is ₦500'),
})

export type ReferralWithdrawalInput = z.infer<typeof referralWithdrawalSchema>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/referrals/schema.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/referrals/schema.ts lib/referrals/schema.test.ts
git commit -m "feat: #22 referral withdrawal amount schema"
```

---

### Task 4: `lib/referrals/actions.ts` — player-facing withdrawal request

**Files:**
- Create: `lib/referrals/actions.ts`

**Interfaces:**
- Consumes: `referralWithdrawalSchema` (Task 3), `computeReferralBalance`, `REFERRAL_MIN_COUNT` (Task 2).
- Produces: `requestReferralWithdrawal(_prev, formData): Promise<ReferralWithdrawalState>`, `ReferralWithdrawalState` type — consumed by `components/dashboard/ReferralPanel.tsx` (Task 6).

- [ ] **Step 1: Write the implementation**

No unit test for this file — it's a Server Action that hits Supabase directly, matching `lib/withdrawals/actions.ts`'s convention (no test file for that one either).

```typescript
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { referralWithdrawalSchema } from './schema'
import { computeReferralBalance, REFERRAL_MIN_COUNT } from './balance'

export type ReferralWithdrawalState = { error?: string; success?: boolean } | undefined

export async function requestReferralWithdrawal(
  _prev: ReferralWithdrawalState,
  formData: FormData,
): Promise<ReferralWithdrawalState> {
  const parsed = referralWithdrawalSchema.safeParse({ amount: formData.get('amount') })
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

  const [{ count: referralCount }, { data: existingRequests }] = await Promise.all([
    supabase.from('referrals').select('id', { count: 'exact', head: true }).eq('referrer_id', user.id),
    supabase.from('referral_withdrawal_requests').select('status, amount').eq('player_id', user.id),
  ])

  const count = referralCount ?? 0
  if (count < REFERRAL_MIN_COUNT) {
    return { error: `Refer at least ${REFERRAL_MIN_COUNT} players before requesting a withdrawal.` }
  }

  const balance = computeReferralBalance(count, existingRequests ?? [])
  if (parsed.data.amount > balance) {
    return { error: 'That amount is more than your available referral balance.' }
  }

  const { error } = await supabase.from('referral_withdrawal_requests').insert({
    player_id: user.id,
    amount: parsed.data.amount,
    bank_name: kyc.payout_bank_name,
    account_number: kyc.payout_account_number,
    account_name: kyc.payout_account_name,
    status: 'pending',
  })

  if (error) {
    // Partial unique index (one pending request per player) surfaces as 23505.
    if ((error as { code?: string }).code === '23505') {
      return { error: 'You already have a pending referral withdrawal request.' }
    }
    console.error('requestReferralWithdrawal: insert failed', error)
    return { error: 'Could not submit your request. Please try again.' }
  }

  revalidatePath('/dashboard')
  return { success: true }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors referencing `lib/referrals/actions.ts`

- [ ] **Step 3: Commit**

```bash
git add lib/referrals/actions.ts
git commit -m "feat: #22 requestReferralWithdrawal server action"
```

---

### Task 5: `lib/referrals/admin-actions.ts` — admin resolution

**Files:**
- Create: `lib/referrals/admin-actions.ts`

**Interfaces:**
- Consumes: `requireAdmin()` from `lib/admin/auth.ts`.
- Produces: `resolveReferralWithdrawal(_prev, formData): Promise<ReferralResolveState>`, `ReferralResolveState` type — consumed by `components/admin/ReferralQueueRow.tsx` (Task 8).

- [ ] **Step 1: Write the implementation**

```typescript
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin/auth'

export type ReferralResolveState = { error?: string; success?: boolean } | undefined

// Manual flow, matching prize withdrawals' current state — no Paystack
// call. See lib/withdrawals/admin-actions.ts for the commented-out
// automated Transfer version; when Paystack Transfer is re-enabled there,
// this flow should be upgraded the same way at the same time so the two
// payout types don't drift apart.
export async function resolveReferralWithdrawal(
  _prev: ReferralResolveState,
  formData: FormData,
): Promise<ReferralResolveState> {
  await requireAdmin()
  const id = String(formData.get('id') ?? '')
  const action = String(formData.get('action') ?? '')
  const note = String(formData.get('note') ?? '').trim()
  if (!id) return { error: 'Missing request.' }
  if (action !== 'paid' && action !== 'rejected') return { error: 'Choose paid or rejected.' }
  if (action === 'rejected' && !note) return { error: 'Enter a reason for the rejection.' }

  const supabase = createClient()
  const { data: wr } = await supabase
    .from('referral_withdrawal_requests')
    .select('status')
    .eq('id', id)
    .maybeSingle()
  if (!wr) return { error: 'Request not found.' }
  if (wr.status !== 'pending') return { error: 'This request has already been resolved.' }

  const { error } = await supabase
    .from('referral_withdrawal_requests')
    .update({
      status: action === 'paid' ? 'paid' : 'rejected',
      admin_note: note || null,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) return { error: 'Could not resolve the request. Please try again.' }

  revalidatePath('/admin/referrals')
  revalidatePath('/dashboard')
  return { success: true }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors referencing `lib/referrals/admin-actions.ts`

- [ ] **Step 3: Commit**

```bash
git add lib/referrals/admin-actions.ts
git commit -m "feat: #22 resolveReferralWithdrawal admin action"
```

---

### Task 6: `components/dashboard/ReferralPanel.tsx` + wire into dashboard

**Files:**
- Create: `components/dashboard/ReferralPanel.tsx`
- Modify: `app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `requestReferralWithdrawal`, `ReferralWithdrawalState` (Task 4); `computeReferralBalance`, `isEligibleForReferralWithdrawal`, `REFERRAL_MIN_COUNT` (Task 2); `Field` from `components/dashboard/FormField.tsx`; `formatDate`, `formatNaira` from `lib/format.ts`.
- Produces: `ReferralPanel` component, `ReferralWithdrawalRow` type.

- [ ] **Step 1: Write the component**

```tsx
'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { requestReferralWithdrawal, type ReferralWithdrawalState } from '@/lib/referrals/actions'
import { computeReferralBalance, isEligibleForReferralWithdrawal, REFERRAL_MIN_COUNT } from '@/lib/referrals/balance'
import { formatDate, formatNaira } from '@/lib/format'
import { Field } from './FormField'

export interface ReferralWithdrawalRow {
  id: string
  amount: number
  status: string
  admin_note: string | null
  requested_at: string
  resolved_at: string | null
}

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Pending review', cls: 'text-amber-400' },
  paid: { label: 'Paid', cls: 'text-emerald-400' },
  rejected: { label: 'Rejected', cls: 'text-red-400' },
}

export function ReferralPanel({
  username,
  referredPlayers,
  requests,
  kycVerified,
}: {
  username: string
  referredPlayers: string[]
  requests: ReferralWithdrawalRow[]
  kycVerified: boolean
}) {
  const [copied, setCopied] = useState(false)
  const link = `https://sentinelxesports.vercel.app/signup?ref=${username}`
  const referralCount = referredPlayers.length
  const balance = computeReferralBalance(referralCount, requests)
  const hasActive = requests.some((r) => r.status === 'pending')
  const eligible = isEligibleForReferralWithdrawal(referralCount)

  function copyLink() {
    navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <section className="mb-10">
      <h2 className="mb-4 text-base font-bold text-white">Referrals</h2>
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <p className="text-xs text-slate-400">Your referral link</p>
        <div className="mt-1 flex items-center gap-2">
          <code className="flex-1 truncate rounded-lg bg-slate-950 px-3 py-2 text-xs text-slate-300">{link}</code>
          <button
            type="button"
            onClick={copyLink}
            className="shrink-0 rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold text-white hover:bg-violet-500"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>

        <p className="mt-4 text-sm text-slate-300">
          {referralCount} referral{referralCount === 1 ? '' : 's'} · balance {formatNaira(balance)}
        </p>

        {referredPlayers.length > 0 && (
          <p className="mt-2 text-xs text-slate-500">Referred: {referredPlayers.join(', ')}</p>
        )}

        {!eligible && (
          <p className="mt-4 text-xs text-slate-500">
            Refer {REFERRAL_MIN_COUNT - referralCount} more player
            {REFERRAL_MIN_COUNT - referralCount === 1 ? '' : 's'} to unlock withdrawals.
          </p>
        )}

        {eligible && !kycVerified && (
          <p className="mt-4 text-xs text-amber-400">Complete identity verification above to withdraw.</p>
        )}

        {eligible && kycVerified && hasActive && (
          <p className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-center text-xs font-semibold text-amber-300">
            Request pending — we&apos;ll be in touch once it&apos;s reviewed.
          </p>
        )}

        {eligible && kycVerified && !hasActive && <ReferralWithdrawalForm maxAmount={balance} />}
      </div>

      {requests.length > 0 && (
        <div className="mt-2 space-y-2">
          {requests.map((r) => (
            <RequestRow key={r.id} req={r} />
          ))}
        </div>
      )}
    </section>
  )
}

function ReferralWithdrawalForm({ maxAmount }: { maxAmount: number }) {
  const [state, formAction] = useFormState<ReferralWithdrawalState, FormData>(
    requestReferralWithdrawal,
    undefined,
  )
  return (
    <form action={formAction} className="mt-4 space-y-3">
      <Field
        name="amount"
        label={`Amount (₦, up to ${formatNaira(maxAmount)})`}
        type="number"
        min={500}
        max={maxAmount}
        placeholder="500"
      />
      {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
      <button
        type="submit"
        className="w-full rounded-xl bg-violet-600 px-7 py-3 text-sm font-bold text-white transition-colors hover:bg-violet-500"
      >
        Request referral withdrawal
      </button>
    </form>
  )
}

function RequestRow({ req }: { req: ReferralWithdrawalRow }) {
  const s = STATUS[req.status] ?? { label: req.status, cls: 'text-slate-400' }
  const when = formatDate(req.resolved_at ?? req.requested_at) ?? ''
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-bold text-white">{formatNaira(req.amount)}</p>
        <span className={`text-xs font-semibold ${s.cls}`}>{s.label}</span>
      </div>
      <p className="mt-1 text-xs text-slate-500">{when}</p>
      {req.admin_note && <p className="mt-1 text-xs text-slate-400">Note: {req.admin_note}</p>}
    </div>
  )
}
```

- [ ] **Step 2: Wire into the dashboard page**

In `app/dashboard/page.tsx`, add the import:

```typescript
import { ReferralPanel, type ReferralWithdrawalRow } from '@/components/dashboard/ReferralPanel'
```

Add two more parallel queries to the existing `Promise.all([...])` array (after `kycRes` and before `banks`, or appended — order doesn't matter since results are destructured by position, so add corresponding destructured names too):

```typescript
supabase
  .from('referrals')
  .select('referred:profiles!referrals_referred_id_fkey(username, display_name)')
  .eq('referrer_id', user.id),
supabase
  .from('referral_withdrawal_requests')
  .select('id, amount, status, admin_note, requested_at, resolved_at')
  .eq('player_id', user.id)
  .order('requested_at', { ascending: false }),
```

Add matching destructured names to the `const [ ... ] = await Promise.all([...])` line (e.g. `referralsRes, referralWithdrawalsRes` appended to the existing list, in the same position as the two new queries above).

After the existing `const displayName = ...` line, add:

```typescript
type ReferredRef = { username: string | null; display_name: string | null } | { username: string | null; display_name: string | null }[] | null
function referredName(r: ReferredRef): string {
  const p = Array.isArray(r) ? r[0] ?? null : r
  return p?.display_name ?? p?.username ?? 'Player'
}
const referredPlayers = ((referralsRes.data as unknown[] | null) ?? []).map((raw) =>
  referredName((raw as { referred: ReferredRef }).referred),
)
const referralWithdrawals = (referralWithdrawalsRes.data ?? []) as ReferralWithdrawalRow[]
```

(`type ReferredRef` and `referredName` should be module-level helpers near the other `firstTournament`/`nameOf` helpers at the top of the file, not inline in the component body — follow the existing file's convention of defining these helpers once above `DashboardPage`.)

In the JSX, add the panel — place it right after `<ProfileEditForm ... />` and before `<FixtureSection ... />`:

```tsx
<ReferralPanel
  username={profile?.username ?? ''}
  referredPlayers={referredPlayers}
  requests={referralWithdrawals}
  kycVerified={kyc?.kyc_status === 'verified'}
/>
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add components/dashboard/ReferralPanel.tsx app/dashboard/page.tsx
git commit -m "feat: #22 referral panel on player dashboard"
```

---

### Task 7: Signup flow — capture `?ref=` through to the trigger

**Files:**
- Modify: `lib/auth/schema.ts`
- Modify: `lib/auth/schema.test.ts`
- Modify: `lib/auth/actions.ts`
- Modify: `app/(auth)/signup/page.tsx`
- Modify: `components/auth/SignupWizard.tsx`

**Interfaces:**
- Produces: `signupSchema` gains an optional `ref` field.

- [ ] **Step 1: Write the failing test**

Add to `lib/auth/schema.test.ts`, inside the existing `describe('signupSchema', ...)` block:

```typescript
  it('accepts an optional ref code', () => {
    const r = signupSchema.safeParse({ username: 'rex99', email: 'a@b.com', password: 'password1', ref: 'someone' })
    expect(r.success).toBe(true)
  })
  it('accepts signup with no ref code', () => {
    const r = signupSchema.safeParse({ username: 'rex99', email: 'a@b.com', password: 'password1' })
    expect(r.success).toBe(true)
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/auth/schema.test.ts`
Expected: PASS actually — `ref` being absent from the schema is harmless to Zod's `.object()` (unknown extra behavior isn't triggered by a missing optional key). This step instead confirms the *existing* two new tests pass once `ref` is added; skip straight to Step 3 if `ref` isn't in the schema yet, both new tests will already pass trivially. The real verification is Step 4 after the schema change, confirming behavior didn't regress.

- [ ] **Step 3: Add `ref` to the schema**

In `lib/auth/schema.ts`, change:

```typescript
export const signupSchema = z.object({
  username: usernameSchema,
  email: z.string().trim().email('Enter a valid email'),
  password: passwordSchema,
})
```

to:

```typescript
export const signupSchema = z.object({
  username: usernameSchema,
  email: z.string().trim().email('Enter a valid email'),
  password: passwordSchema,
  ref: z.string().trim().optional(),
})
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/auth/schema.test.ts`
Expected: PASS (all tests, including the 2 new ones)

- [ ] **Step 5: Pass `ref` through the signup action**

In `lib/auth/actions.ts`, change the `signup()` function's parse call and `signUp()` call:

```typescript
export async function signup(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = signupSchema.safeParse({
    username: formData.get('username'),
    email: formData.get('email'),
    password: formData.get('password'),
    ref: formData.get('ref') || undefined,
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const { username, email, password, ref } = parsed.data
  const supabase = createClient()
```

(the username-availability check block is unchanged)

then change the `signUp` call's `options.data`:

```typescript
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: ref ? { username, ref } : { username },
    },
  })
```

- [ ] **Step 6: Capture `?ref=` on the signup page**

In `app/(auth)/signup/page.tsx`:

```tsx
import type { Metadata } from 'next'
import { SignupWizard } from '@/components/auth/SignupWizard'

export const metadata: Metadata = { title: 'Sign up · SentinelX Esports' }

export default function SignupPage({ searchParams }: { searchParams: { ref?: string } }) {
  return <SignupWizard refCode={searchParams.ref ?? null} />
}
```

- [ ] **Step 7: Thread `refCode` through the wizard as a hidden field**

In `components/auth/SignupWizard.tsx`, change the function signature:

```typescript
export function SignupWizard({ refCode }: { refCode: string | null }) {
```

and add a hidden input alongside the existing username one:

```tsx
      {/* Single source of truth for the submitted username */}
      <input type="hidden" name="username" value={username} />
      {refCode && <input type="hidden" name="ref" value={refCode} />}
```

- [ ] **Step 8: Verify**

Run: `npx tsc --noEmit && npm run lint && npx vitest run`
Expected: no errors, all existing tests still pass

- [ ] **Step 9: Commit**

```bash
git add lib/auth/schema.ts lib/auth/schema.test.ts lib/auth/actions.ts "app/(auth)/signup/page.tsx" components/auth/SignupWizard.tsx
git commit -m "feat: #22 capture ?ref= through signup to the referred_by trigger"
```

---

### Task 8: Credit the referral at email confirmation

**Files:**
- Modify: `app/auth/confirm/route.ts`

**Interfaces:**
- Consumes: `createAdminClient` from `lib/supabase/admin.ts`.

- [ ] **Step 1: Write the implementation**

```typescript
import { NextResponse, type NextRequest } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCallbackRedirect } from '@/lib/auth/redirect'

// Server-side verification for email links (signup confirmation + password
// recovery). Supabase email templates point here with a token_hash + type;
// verifyOtp establishes the session via cookies — no URL fragment, no PKCE
// code_verifier, no same-browser requirement.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  const next = searchParams.get('next')

  if (token_hash && type) {
    const supabase = createClient()
    const { data, error } = await supabase.auth.verifyOtp({ type, token_hash })
    if (!error) {
      if (type === 'signup' && data.user) {
        await creditReferralIfAny(data.user.id)
      }
      return NextResponse.redirect(`${origin}${resolveCallbackRedirect({ type, next })}`)
    }
  }
  return NextResponse.redirect(`${origin}/login?error=auth`)
}

// The ₦100 referral credit fires here — at confirmed email, not raw signup
// — so an abandoned/unverified signup never credits anyone. Uses the
// service-role client since referrals has no client INSERT policy at all.
// Idempotent via referrals.referred_id's UNIQUE constraint: a 23505 here
// means this user was already credited (e.g. confirm route hit twice) and
// is safe to ignore.
async function creditReferralIfAny(userId: string): Promise<void> {
  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('referred_by')
    .eq('id', userId)
    .maybeSingle()
  if (!profile?.referred_by) return

  const { error } = await admin
    .from('referrals')
    .insert({ referrer_id: profile.referred_by, referred_id: userId })
  if (error && (error as { code?: string }).code !== '23505') {
    console.error('[auth/confirm] referral credit failed', {
      userId,
      code: (error as { code?: string }).code,
      message: error.message,
    })
  }
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add app/auth/confirm/route.ts
git commit -m "feat: #22 credit referral on signup email confirmation"
```

---

### Task 9: `components/admin/ReferralQueueRow.tsx`

**Files:**
- Create: `components/admin/ReferralQueueRow.tsx`

**Interfaces:**
- Consumes: `resolveReferralWithdrawal`, `ReferralResolveState` (Task 5).
- Produces: `ReferralQueueRow` component, `PendingReferralWithdrawal` type — consumed by `app/admin/referrals/page.tsx` (Task 10).

- [ ] **Step 1: Write the component**

```tsx
'use client'
import { useFormState } from 'react-dom'
import { resolveReferralWithdrawal, type ReferralResolveState } from '@/lib/referrals/admin-actions'
import { formatNaira } from '@/lib/format'

export interface PendingReferralWithdrawal {
  id: string
  playerName: string
  amount: number
  bankName: string
  accountNumber: string
  accountName: string
  referredPlayers: string[]
}

export function ReferralQueueRow({ req }: { req: PendingReferralWithdrawal }) {
  const [state, action] = useFormState<ReferralResolveState, FormData>(resolveReferralWithdrawal, undefined)

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
      <p className="mt-2 text-xs text-slate-400">
        Referred: {req.referredPlayers.length > 0 ? req.referredPlayers.join(', ') : 'none on record'}
      </p>
      <textarea
        name="note"
        rows={2}
        placeholder="Note (required to reject)"
        className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
      />
      {state?.error && <p className="mt-2 text-sm text-red-400">{state.error}</p>}
      <div className="mt-2 flex gap-2">
        <button
          type="submit"
          name="action"
          value="paid"
          className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500"
        >
          Pay
        </button>
        <button
          type="submit"
          name="action"
          value="rejected"
          className="rounded-lg border border-red-500/40 px-4 py-2 text-xs font-bold text-red-400 hover:bg-red-500/10"
        >
          Reject
        </button>
      </div>
    </form>
  )
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors referencing this file (it's used by Task 10, so a dangling-import error is expected until that task lands — that's fine, proceed)

- [ ] **Step 3: Commit**

```bash
git add components/admin/ReferralQueueRow.tsx
git commit -m "feat: #22 admin referral withdrawal row"
```

---

### Task 10: `/admin/referrals` page + nav entry

**Files:**
- Create: `app/admin/referrals/page.tsx`
- Modify: `lib/admin/nav.ts`

**Interfaces:**
- Consumes: `ReferralQueueRow`, `PendingReferralWithdrawal` (Task 9); `requireAdmin` from `lib/admin/auth.ts`.

- [ ] **Step 1: Write the page**

```tsx
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin/auth'
import { formatDate, formatNaira } from '@/lib/format'
import { ReferralQueueRow, type PendingReferralWithdrawal } from '@/components/admin/ReferralQueueRow'

export const metadata: Metadata = { title: 'Referrals · Admin · SentinelX' }

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

export default async function AdminReferralsPage() {
  await requireAdmin()
  const supabase = createClient()
  const [{ data: queueData }, { data: resolvedData }] = await Promise.all([
    supabase
      .from('referral_withdrawal_requests')
      .select(
        'id, player_id, amount, bank_name, account_number, account_name, profiles(username, display_name)',
      )
      .eq('status', 'pending')
      .order('requested_at', { ascending: true }),
    supabase
      .from('referral_withdrawal_requests')
      .select('id, amount, status, admin_note, resolved_at, profiles(username, display_name)')
      .in('status', ['paid', 'rejected'])
      .order('resolved_at', { ascending: false })
      .limit(20),
  ])

  const rawQueue = ((queueData as unknown[] | null) ?? []) as {
    id: string
    player_id: string
    amount: number
    bank_name: string
    account_number: string
    account_name: string
    profiles: ProfileRef | ProfileRef[]
  }[]

  // Live-queried, not snapshotted — Samuel always sees current referral truth.
  const referrerIds = rawQueue.map((r) => r.player_id)
  const { data: referredData } =
    referrerIds.length > 0
      ? await supabase
          .from('referrals')
          .select('referrer_id, referred:profiles!referrals_referred_id_fkey(username, display_name)')
          .in('referrer_id', referrerIds)
      : { data: [] as { referrer_id: string; referred: ProfileRef | ProfileRef[] }[] }

  const referredByReferrer = new Map<string, string[]>()
  for (const row of (referredData ?? []) as { referrer_id: string; referred: ProfileRef | ProfileRef[] }[]) {
    const name = nameOf(firstP(row.referred))
    const list = referredByReferrer.get(row.referrer_id) ?? []
    list.push(name)
    referredByReferrer.set(row.referrer_id, list)
  }

  const queue: PendingReferralWithdrawal[] = rawQueue.map((r) => ({
    id: r.id,
    playerName: nameOf(firstP(r.profiles)),
    amount: r.amount,
    bankName: r.bank_name,
    accountNumber: r.account_number,
    accountName: r.account_name,
    referredPlayers: referredByReferrer.get(r.player_id) ?? [],
  }))

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
            No referral withdrawals need action.
          </p>
        ) : (
          <div className="space-y-2">
            {queue.map((req) => (
              <ReferralQueueRow key={req.id} req={req} />
            ))}
          </div>
        )}
      </div>

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

- [ ] **Step 2: Add the nav entry**

In `lib/admin/nav.ts`, add a new entry after `Withdrawals`:

```typescript
export const ADMIN_NAV: AdminNavItem[] = [
  { label: 'Overview', href: '/admin', adminOnly: false },
  { label: 'Tournaments', href: '/admin/tournaments', adminOnly: false },
  { label: 'Results', href: '/admin/results', adminOnly: false },
  { label: 'Community', href: '/admin/community', adminOnly: false },
  { label: 'TV', href: '/admin/tv', adminOnly: false },
  { label: 'Exchange', href: '/admin/exchange', adminOnly: false },
  { label: 'Withdrawals', href: '/admin/withdrawals', adminOnly: true },
  { label: 'Referrals', href: '/admin/referrals', adminOnly: true },
]
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add "app/admin/referrals/page.tsx" lib/admin/nav.ts
git commit -m "feat: #22 admin referrals queue page + nav entry"
```

---

### Task 11: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test -- --run`
Expected: all tests pass (existing 308+ plus the new referral tests from Tasks 2, 3, 7)

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: `✔ No ESLint warnings or errors`

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output (clean)

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: build succeeds, `/admin/referrals` and updated `/dashboard`/`/signup` routes appear in the route list

- [ ] **Step 5: Manual smoke notes for the user**

Since this flow involves real signup/email-confirmation and can't be exercised by an automated test in this repo, leave these as manual checks for the user post-deploy:
1. Copy your referral link from `/dashboard`, sign up a second test account through it, confirm the email — check that a `referrals` row appears and the referrer's dashboard balance increases by ₦100.
2. Confirm an *unconfirmed* signup (abandoned before clicking the email link) does **not** create a `referrals` row.
3. At 5 referrals, confirm the withdrawal form appears and a request lands in `/admin/referrals` with the correct referred-players list.
4. Reject a request, confirm the balance is restored on the dashboard.

- [ ] **Step 6: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: #22 referral program verification fixes"
```

(Skip this step if Steps 1–4 passed clean with no changes needed.)
