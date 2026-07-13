# Player Wallet System (#28) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `withdrawal_requests` (prize), `referral_withdrawal_requests`, and `friendly_withdrawal_requests` with a single `wallets` balance + `wallet_transactions` ledger + one unified `withdrawal_requests` queue, credited automatically on prize win / referral confirmation / staked-friendly win, or manually by admin.

**Architecture:** Two new tables (`wallets`, `wallet_transactions`) plus a redesigned `withdrawal_requests`. All writes go through two service-role helpers, `creditWallet`/`debitWallet` (`lib/wallet/service.ts`), which are the only code allowed to touch `wallets.balance`. Three existing confirmation flows (tournament final, referral email confirmation, staked-friendly admin confirm) each gain one `creditWallet` call. One dashboard panel and one admin page replace the three retired ones.

**Tech Stack:** Next.js 14 Server Actions, Supabase (Postgres + RLS), Zod, Vitest.

## Global Constraints

- Winner-take-all prize crediting — the tournament's full `prize_pool` credits the final's winner only; no placement tiers (spec §5).
- Withdrawals debit-on-request, refund-on-reject — never debit-on-paid (spec §4).
- `debitWallet` never lets a debit take `wallets.balance` negative, and never surfaces a raw Postgres constraint error to the caller — it uses a conditional `UPDATE ... WHERE balance >= $amount` and returns a typed `{ ok: false, error }` result (spec §3).
- The calling Server Action for a withdrawal request pre-checks `balance >= amount` before calling `debitWallet` — this is a fast-path UX check, not a substitute for `debitWallet`'s own atomic guard (spec §3).
- No backfill migration — `withdrawal_requests`, `referral_withdrawal_requests`, `friendly_withdrawal_requests`, `referrals`, and completed staked `friendly_matches` are all empty in the live DB (verified 2026-07-13); the three old tables are dropped outright.
- `player_notifications.type`'s CHECK constraint must not retain any retired notification type value once its last call site is removed (user's explicit instruction — no dead type values left in the constraint).
- Money is always a whole-naira integer (no kobo) everywhere in this codebase — match that convention throughout.
- Mobile-first Tailwind styling matching the existing dashboard/admin visual language (`rounded-2xl border border-slate-800 bg-slate-900 p-4/p-5`, `text-violet-*` primary actions) — copy the exact classes used in `WithdrawalPanel.tsx` / `WithdrawalQueueRow.tsx` rather than inventing new ones.

---

## File Structure

**New:**
- `supabase/migrations/024_wallet_system.sql` — schema
- `lib/wallet/service.ts` — `creditWallet`, `debitWallet`, `WalletTxnType`
- `lib/wallet/schema.ts` — `walletWithdrawalSchema`
- `lib/wallet/actions.ts` — `requestWalletWithdrawal`
- `lib/wallet/admin-actions.ts` — `resolveWalletWithdrawal`, `adminCreditWallet`
- `lib/referrals/constants.ts` — `REFERRAL_CREDIT_NGN`
- `components/dashboard/WalletPanel.tsx`
- `components/admin/WalletCreditForm.tsx`
- `components/admin/WalletWithdrawalQueueRow.tsx`
- `app/admin/wallet/page.tsx`

**Modified:**
- `lib/matches/verify-actions.ts` — prize credit hook in `confirmResult`
- `app/auth/confirm/route.ts` — referral credit hook, uses `REFERRAL_CREDIT_NGN`
- `lib/friendly-matches/admin-actions.ts` — staked-stake credit hook in `confirmFriendlyResult`
- `lib/notifications/inbox.ts` — `NotificationType` union
- `lib/admin/nav.ts` — nav entries
- `app/dashboard/page.tsx` — swap panels
- `components/dashboard/ReferralPanel.tsx` — drop balance/withdrawal, keep link/count/list
- `app/api/paystack/webhook/route.ts` — drop dead `transfer.*` branch
- `lib/supabase/types.ts` — regenerated

**Deleted:**
- `lib/withdrawals/` (actions.ts, admin-actions.ts, schema.ts, webhook.ts, webhook.test.ts)
- `lib/referrals/actions.ts`, `lib/referrals/admin-actions.ts`, `lib/referrals/balance.ts`
- `lib/friendly-withdrawals/` (entire directory)
- `components/dashboard/WithdrawalPanel.tsx`, `components/dashboard/FriendlyWithdrawalPanel.tsx`
- `components/admin/WithdrawalQueueRow.tsx`
- `app/admin/withdrawals/`, `app/admin/referrals/`, `app/admin/friendly-withdrawals/` (entire directories)

---

### Task 1: Migration — wallet schema, drop old withdrawal tables, notification CHECK

**Files:**
- Create: `supabase/migrations/024_wallet_system.sql`

**Interfaces:**
- Produces: tables `wallets(player_id, balance, updated_at)`, `wallet_transactions(id, player_id, amount, type, reference_id, note, created_at)`, redesigned `withdrawal_requests(id, player_id, amount, bank_name, account_number, account_name, status, admin_note, requested_at, resolved_at)`.

- [ ] **Step 1: Write the migration**

```sql
-- 024_wallet_system.sql — #28 unified player wallet system.
-- Live-data check (2026-07-13): withdrawal_requests, referral_withdrawal_requests,
-- friendly_withdrawal_requests, referrals, and completed staked friendly_matches
-- are all empty. No backfill needed; the three old withdrawal tables are dropped.

CREATE TABLE public.wallets (
  player_id  uuid        PRIMARY KEY REFERENCES public.profiles(id),
  balance    integer     NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wallets_self_or_staff_read" ON public.wallets
  FOR SELECT USING (player_id = auth.uid() OR public.is_staff());
-- No INSERT/UPDATE policy: only creditWallet/debitWallet (service-role) write here.

CREATE TABLE public.wallet_transactions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id    uuid        NOT NULL REFERENCES public.profiles(id),
  amount       integer     NOT NULL CHECK (amount <> 0),
  type         text        NOT NULL CHECK (type IN (
                  'prize', 'referral', 'friendly_stake', 'admin_credit',
                  'withdrawal_request', 'withdrawal_reversal'
                )),
  reference_id uuid,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.wallet_transactions (player_id, created_at DESC);
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wallet_transactions_self_or_staff_read" ON public.wallet_transactions
  FOR SELECT USING (player_id = auth.uid() OR public.is_staff());
-- No INSERT policy: append-only, service-role only.

-- Drop the two single-purpose withdrawal tables outright (empty, per the
-- live-data check above).
DROP TABLE public.referral_withdrawal_requests;
DROP TABLE public.friendly_withdrawal_requests;

-- Redesign withdrawal_requests into the one unified queue. Also empty, so a
-- clean drop + recreate under the same name is simplest — no application
-- code needs to learn a new table name for "the withdrawal queue" concept.
DROP TABLE public.withdrawal_requests;
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
ALTER TABLE public.withdrawal_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wr_own_insert" ON public.withdrawal_requests
  FOR INSERT WITH CHECK (player_id = auth.uid());
CREATE POLICY "wr_own_or_admin_read" ON public.withdrawal_requests
  FOR SELECT USING (player_id = auth.uid() OR public.is_admin());
CREATE POLICY "wr_admin_update" ON public.withdrawal_requests
  FOR UPDATE USING (public.is_admin());

-- player_notifications: drop every retired referral-/friendly-/prize-specific
-- withdrawal notification type, add the two unified ones. 'withdrawal_paid'
-- and 'withdrawal_rejected' already exist and are reused as-is (they now
-- describe any wallet withdrawal, not just a prize one). 'referral_credited'
-- stays — it fires with its own copy from app/auth/confirm/route.ts, unrelated
-- to the withdrawal flow.
ALTER TABLE public.player_notifications DROP CONSTRAINT player_notifications_type_check;
ALTER TABLE public.player_notifications ADD CONSTRAINT player_notifications_type_check
  CHECK (type IN (
    'listing_approved', 'listing_removed',
    'withdrawal_paid', 'withdrawal_rejected',
    'result_confirmed', 'referral_credited',
    'friend_request', 'wallet_credited'
  ));
```

- [ ] **Step 2: Apply the migration and confirm the constraint change**

Run: `npx supabase db push` (or the project's existing migration-apply command — check `README.md`/CI for the exact one already in use if `db push` isn't it).

Then confirm live via the Supabase MCP `execute_sql` tool (project `itxubrkbropttfdackmi`):
```sql
select conname, pg_get_constraintdef(oid) from pg_constraint
where conrelid = 'player_notifications'::regclass and contype = 'c';
```
Expected: the `type` CHECK lists exactly the eight values in Step 1, no `referral_withdrawal_*`/`friendly_withdrawal_*` values remaining.

- [ ] **Step 3: Regenerate Supabase types**

Run: `npx supabase gen types typescript --project-id itxubrkbropttfdackmi > lib/supabase/types.ts`

Expected: `lib/supabase/types.ts` gains `wallets` and `wallet_transactions` table types, and `withdrawal_requests`'s `Row`/`Insert`/`Update` types no longer include `processing`/`failed` in `status` or the `paystack_transfer_*` columns; `referral_withdrawal_requests`/`friendly_withdrawal_requests` are gone entirely.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/024_wallet_system.sql lib/supabase/types.ts
git commit -m "feat: #28 wallet system schema — wallets, wallet_transactions, unified withdrawal_requests"
```

---

### Task 2: `lib/wallet/service.ts` — `creditWallet` / `debitWallet`

**Files:**
- Create: `lib/wallet/service.ts`

**Interfaces:**
- Consumes: `createAdminClient()` return type from `lib/supabase/admin.ts` (typed `SupabaseClient<Database>`).
- Produces:
  - `export type WalletTxnType = 'prize' | 'referral' | 'friendly_stake' | 'admin_credit' | 'withdrawal_request' | 'withdrawal_reversal'`
  - `export async function creditWallet(admin: SupabaseClient<Database>, playerId: string, amount: number, type: WalletTxnType, referenceId: string | null, note?: string): Promise<void>`
  - `export async function debitWallet(admin: SupabaseClient<Database>, playerId: string, amount: number, type: WalletTxnType, referenceId: string | null, note?: string): Promise<{ ok: true } | { ok: false; error: string }>`
  - `export async function getWalletBalance(admin: SupabaseClient<Database>, playerId: string): Promise<number>`

This module is I/O-bound (every function is a Supabase round-trip) — consistent with every other `lib/**/actions.ts`/`admin-actions.ts` in this codebase (e.g. `lib/matches/verify-actions.ts`, `lib/withdrawals/admin-actions.ts`), it has no dedicated unit test file. It's exercised by the build (Task 8's typecheck) and by manual testing once wired into the three credit call sites (Tasks 4–6) and the withdrawal flow (Task 3).

- [ ] **Step 1: Write the implementation**

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'

export type WalletTxnType =
  | 'prize'
  | 'referral'
  | 'friendly_stake'
  | 'admin_credit'
  | 'withdrawal_request'
  | 'withdrawal_reversal'

export async function getWalletBalance(
  admin: SupabaseClient<Database>,
  playerId: string,
): Promise<number> {
  const { data } = await admin.from('wallets').select('balance').eq('player_id', playerId).maybeSingle()
  return data?.balance ?? 0
}

// Upserts the wallet row (created lazily on first credit) and appends the
// ledger row. Credits only ever increase the balance — no floor to check.
export async function creditWallet(
  admin: SupabaseClient<Database>,
  playerId: string,
  amount: number,
  type: WalletTxnType,
  referenceId: string | null,
  note?: string,
): Promise<void> {
  const { data: existing } = await admin
    .from('wallets')
    .select('balance')
    .eq('player_id', playerId)
    .maybeSingle()

  if (existing) {
    await admin
      .from('wallets')
      .update({ balance: existing.balance + amount, updated_at: new Date().toISOString() })
      .eq('player_id', playerId)
  } else {
    await admin.from('wallets').insert({ player_id: playerId, balance: amount })
  }

  await admin.from('wallet_transactions').insert({
    player_id: playerId,
    amount,
    type,
    reference_id: referenceId,
    note: note ?? null,
  })
}

// Conditional UPDATE ... WHERE balance >= amount is the atomic safety net:
// even if the caller's own pre-check read a stale balance, only one
// concurrent debit can succeed once the first has already lowered it below
// the second's amount. Zero rows updated -> insufficient balance, returned
// as a typed error — never a thrown Postgres constraint violation.
// Conditional UPDATE ... WHERE balance >= amount (via .gte()) is the atomic
// safety net: PostgREST translates it to WHERE player_id = $1 AND
// balance >= $2 on the actual UPDATE statement, so even if the caller's own
// pre-check (§ lib/wallet/actions.ts) read a stale balance, only one
// concurrent debit can succeed once the first has already lowered it below
// the second's amount. Zero rows updated -> insufficient balance, returned
// as a typed error — never a thrown Postgres constraint violation.
export async function debitWallet(
  admin: SupabaseClient<Database>,
  playerId: string,
  amount: number,
  type: WalletTxnType,
  referenceId: string | null,
  note?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: wallet } = await admin
    .from('wallets')
    .select('balance')
    .eq('player_id', playerId)
    .maybeSingle()
  const currentBalance = wallet?.balance ?? 0
  if (currentBalance < amount) {
    return { ok: false, error: 'Insufficient wallet balance.' }
  }

  const { data: updated } = await admin
    .from('wallets')
    .update({ balance: currentBalance - amount, updated_at: new Date().toISOString() })
    .eq('player_id', playerId)
    .gte('balance', amount)
    .select('balance')
  if (!updated || updated.length === 0) {
    return { ok: false, error: 'Insufficient wallet balance.' }
  }

  await admin.from('wallet_transactions').insert({
    player_id: playerId,
    amount: -amount,
    type,
    reference_id: referenceId,
    note: note ?? null,
  })
  return { ok: true }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors in `lib/wallet/service.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/wallet/service.ts
git commit -m "feat: #28 creditWallet/debitWallet — the only writers to wallets.balance"
```

---

### Task 3: Withdrawal request flow — `lib/wallet/schema.ts`, `lib/wallet/actions.ts`, `lib/wallet/admin-actions.ts`

**Files:**
- Create: `lib/wallet/schema.ts`
- Create: `lib/wallet/actions.ts`
- Create: `lib/wallet/admin-actions.ts`

**Interfaces:**
- Consumes: `creditWallet`, `debitWallet`, `getWalletBalance` from Task 2; `createClient` (`lib/supabase/server.ts`), `createAdminClient` (`lib/supabase/admin.ts`), `requireAdmin` (`lib/admin/auth.ts`), `notifyInApp` (`lib/notifications/inbox.ts`), `formatNaira` (`lib/format.ts`).
- Produces:
  - `export const walletWithdrawalSchema` (zod, `{ amount: number }`)
  - `export type WalletWithdrawalState = { error?: string; success?: boolean } | undefined`
  - `export async function requestWalletWithdrawal(prev: WalletWithdrawalState, formData: FormData): Promise<WalletWithdrawalState>`
  - `export type WalletWithdrawalResolveState = { error?: string; success?: boolean } | undefined`
  - `export async function resolveWalletWithdrawal(prev: WalletWithdrawalResolveState, formData: FormData): Promise<WalletWithdrawalResolveState>`
  - `export type AdminCreditState = { error?: string; success?: boolean } | undefined`
  - `export async function adminCreditWallet(prev: AdminCreditState, formData: FormData): Promise<AdminCreditState>`

Unified minimum withdrawal: **₦100** — the lowest of the three retired schemas' minimums (`withdrawalSchema` ₦1000, `referralWithdrawalSchema` ₦500, `friendlyWithdrawalSchema` ₦100). A pooled wallet can hold a small staked-friendly win with no larger prize/referral money behind it, so gating everyone at the old prize-only ₦1000 floor would block exactly that case.

- [ ] **Step 1: Write `lib/wallet/schema.ts`**

```ts
import { z } from 'zod'

export const walletWithdrawalSchema = z.object({
  amount: z.coerce
    .number()
    .int('Amount must be a whole number of naira')
    .min(100, 'Minimum withdrawal is ₦100')
    .max(100_000_000, 'Amount is too large'),
})

export type WalletWithdrawalInput = z.infer<typeof walletWithdrawalSchema>
```

- [ ] **Step 2: Write `lib/wallet/actions.ts`**

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { walletWithdrawalSchema } from './schema'
import { getWalletBalance, debitWallet } from './service'

export type WalletWithdrawalState = { error?: string; success?: boolean } | undefined

export async function requestWalletWithdrawal(
  _prev: WalletWithdrawalState,
  formData: FormData,
): Promise<WalletWithdrawalState> {
  const parsed = walletWithdrawalSchema.safeParse({ amount: formData.get('amount') })
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

  const admin = createAdminClient()
  const balance = await getWalletBalance(admin, user.id)
  if (parsed.data.amount > balance) {
    return { error: 'That amount is more than your available balance.' }
  }

  const { data: inserted, error } = await admin
    .from('withdrawal_requests')
    .insert({
      player_id: user.id,
      amount: parsed.data.amount,
      bank_name: kyc.payout_bank_name,
      account_number: kyc.payout_account_number,
      account_name: kyc.payout_account_name,
      status: 'pending',
    })
    .select('id')
    .single()

  if (error || !inserted) {
    if ((error as { code?: string })?.code === '23505') {
      return { error: 'You already have a pending withdrawal request.' }
    }
    return { error: 'Could not submit your request. Please try again.' }
  }

  const debit = await debitWallet(admin, user.id, parsed.data.amount, 'withdrawal_request', inserted.id)
  if (!debit.ok) {
    // Race: balance dropped between the pre-check above and now (e.g. two
    // tabs submitting at once). Undo the insert so the player never sees a
    // pending request that was never actually debited.
    await admin.from('withdrawal_requests').delete().eq('id', inserted.id)
    return { error: 'That amount is more than your available balance.' }
  }

  revalidatePath('/dashboard')
  return { success: true }
}
```

- [ ] **Step 3: Write `lib/wallet/admin-actions.ts`**

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/admin/auth'
import { notifyInApp } from '@/lib/notifications/inbox'
import { formatNaira } from '@/lib/format'
import { creditWallet } from './service'

export type WalletWithdrawalResolveState = { error?: string; success?: boolean } | undefined

export async function resolveWalletWithdrawal(
  _prev: WalletWithdrawalResolveState,
  formData: FormData,
): Promise<WalletWithdrawalResolveState> {
  await requireAdmin()
  const id = String(formData.get('id') ?? '')
  const action = String(formData.get('action') ?? '')
  const note = String(formData.get('note') ?? '').trim()
  if (!id) return { error: 'Missing request.' }
  if (action !== 'paid' && action !== 'rejected') return { error: 'Choose paid or rejected.' }
  if (action === 'rejected' && !note) return { error: 'Enter a reason for the rejection.' }

  const admin = createAdminClient()
  const { data: wr } = await admin
    .from('withdrawal_requests')
    .select('status, player_id, amount')
    .eq('id', id)
    .maybeSingle()
  if (!wr) return { error: 'Request not found.' }
  if (wr.status !== 'pending') return { error: 'This request has already been resolved.' }

  const { error } = await admin
    .from('withdrawal_requests')
    .update({
      status: action === 'paid' ? 'paid' : 'rejected',
      admin_note: note || null,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) return { error: 'Could not resolve the request. Please try again.' }

  if (action === 'rejected') {
    // The debited amount was reserved at request time — give it back.
    await creditWallet(admin, wr.player_id, wr.amount, 'withdrawal_reversal', id, note)
  }

  await notifyInApp({
    playerId: wr.player_id,
    type: action === 'paid' ? 'withdrawal_paid' : 'withdrawal_rejected',
    title: action === 'paid' ? 'Withdrawal paid' : 'Withdrawal rejected',
    body:
      action === 'paid'
        ? `Your withdrawal of ${formatNaira(wr.amount)} has been paid.`
        : note
          ? `Your withdrawal request was rejected: ${note}`
          : 'Your withdrawal request was rejected.',
    link: '/dashboard',
  })

  revalidatePath('/admin/wallet')
  revalidatePath('/dashboard')
  return { success: true }
}

export type AdminCreditState = { error?: string; success?: boolean } | undefined

export async function adminCreditWallet(
  _prev: AdminCreditState,
  formData: FormData,
): Promise<AdminCreditState> {
  await requireAdmin()
  const username = String(formData.get('username') ?? '').trim()
  const amount = Number(formData.get('amount'))
  const note = String(formData.get('note') ?? '').trim()
  if (!username) return { error: 'Enter a username.' }
  if (!Number.isInteger(amount) || amount <= 0) return { error: 'Enter a whole naira amount greater than 0.' }
  if (!note) return { error: 'Enter a note explaining this credit.' }

  const supabase = createClient()
  const { data: player } = await supabase
    .from('profiles')
    .select('id')
    .eq('username', username)
    .maybeSingle()
  if (!player) return { error: `No player found with username "${username}".` }

  const admin = createAdminClient()
  await creditWallet(admin, player.id, amount, 'admin_credit', null, note)
  await notifyInApp({
    playerId: player.id,
    type: 'wallet_credited',
    title: 'Wallet credited',
    body: `${formatNaira(amount)} was added to your wallet: ${note}`,
    link: '/dashboard',
  })

  revalidatePath('/admin/wallet')
  revalidatePath('/dashboard')
  return { success: true }
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (`notifyInApp`'s `NotificationType` union doesn't yet include `'wallet_credited'` — Task 7 adds it. If Task 7 hasn't run yet, expect one error here on that literal; that's fine, it resolves once Task 7 lands. Do this task and Task 7 back to back if running out of order.)

- [ ] **Step 5: Commit**

```bash
git add lib/wallet/schema.ts lib/wallet/actions.ts lib/wallet/admin-actions.ts
git commit -m "feat: #28 unified withdrawal request flow — debit-on-request, refund-on-reject, admin manual credit"
```

---

### Task 4: Prize credit hook — `lib/matches/verify-actions.ts`

**Files:**
- Modify: `lib/matches/verify-actions.ts`

**Interfaces:**
- Consumes: `creditWallet` from Task 2; `matchWinnerId` from `lib/tournaments/advancement.ts` (already imported in this file).

- [ ] **Step 1: Widen the match select to include player ids and the tournament's prize pool**

Change:
```ts
  const { data: m } = await admin
    .from('matches')
    .select('id, round, group_id, tournament_id, tournament:tournaments(status, slug)')
    .eq('id', id)
    .maybeSingle()
```
to:
```ts
  const { data: m } = await admin
    .from('matches')
    .select(
      'id, round, group_id, tournament_id, player_a_id, player_b_id, ' +
        'tournament:tournaments(status, slug, prize_pool)',
    )
    .eq('id', id)
    .maybeSingle()
```

- [ ] **Step 2: Credit the wallet when the final is confirmed**

Add the `creditWallet` import:
```ts
import { creditWallet } from '@/lib/wallet/service'
```

Change:
```ts
  } else if (isKnockout) {
    await advanceKnockout(admin, m.tournament_id, m.round)
    if (nextRoundName(m.round) === null) {
      await admin.from('tournaments').update({ status: 'completed' }).eq('id', m.tournament_id)
    }
  }
```
to:
```ts
  } else if (isKnockout) {
    await advanceKnockout(admin, m.tournament_id, m.round)
    if (nextRoundName(m.round) === null) {
      await admin.from('tournaments').update({ status: 'completed' }).eq('id', m.tournament_id)

      // Winner-take-all: the final's winner gets the full prize_pool. No
      // placement tiers — a runner-up/3rd-place prize, if ever wanted, goes
      // through the admin manual-credit path (adminCreditWallet), not an
      // automated split.
      const winnerId = matchWinnerId({
        status: 'completed',
        score_a: scoreA,
        score_b: scoreB,
        player_a_id: m.player_a_id,
        player_b_id: m.player_b_id,
      })
      const prizePool = t?.prize_pool ?? 0
      if (winnerId && prizePool > 0) {
        await creditWallet(admin, winnerId, prizePool, 'prize', m.tournament_id)
      }
    }
  }
```

`t` (the unwrapped tournament reference) is already computed a few lines above this branch via `firstStr(m.tournament as ...)` in the existing code — check its exact shape: it currently only destructures `status`/`slug`. Update that local unwrap to also carry `prize_pool`:

Find:
```ts
  const t = firstStr(m.tournament as { status: string; slug: string } | { status: string; slug: string }[] | null)
  const slug = t?.slug ?? ''
```
Replace with:
```ts
  const t = firstStr(
    m.tournament as
      | { status: string; slug: string; prize_pool: number }
      | { status: string; slug: string; prize_pool: number }[]
      | null,
  )
  const slug = t?.slug ?? ''
```

(`firstStr` is this file's existing helper that unwraps Supabase's single-vs-array join shape — confirm its generic signature accepts the widened object type; if it's typed narrowly to `{ status, slug }`, widen its parameter type to a generic `T` so both call shapes typecheck.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors in `lib/matches/verify-actions.ts`.

- [ ] **Step 4: Manual verification**

This function is I/O-bound and has no existing unit test (consistent with the rest of this file — see `docs/superpowers/specs/2026-07-08-admin-result-verification-design.md`'s Testing section: "Actions/pages are I/O-bound — exercised via the build and manual admin testing"). Verify manually once Task 8 wires up `/admin/wallet`: confirm a tournament's final match as staff, then check the winner's `wallets.balance` increased by the tournament's `prize_pool` and a `wallet_transactions` row of `type = 'prize'` was inserted.

- [ ] **Step 5: Commit**

```bash
git add lib/matches/verify-actions.ts
git commit -m "feat: #28 credit the wallet automatically when a tournament final is confirmed"
```

---

### Task 5: Referral credit hook — `app/auth/confirm/route.ts`

**Files:**
- Modify: `app/auth/confirm/route.ts`
- Create: `lib/referrals/constants.ts`

**Interfaces:**
- Produces: `export const REFERRAL_CREDIT_NGN = 100`
- Consumes: `creditWallet` from Task 2.

- [ ] **Step 1: Write `lib/referrals/constants.ts`**

```ts
export const REFERRAL_CREDIT_NGN = 100
```

- [ ] **Step 2: Credit the wallet right after the referral row is inserted**

Add imports to `app/auth/confirm/route.ts`:
```ts
import { creditWallet } from '@/lib/wallet/service'
import { REFERRAL_CREDIT_NGN } from '@/lib/referrals/constants'
```

Change:
```ts
  const { error } = await admin
    .from('referrals')
    .insert({ referrer_id: profile.referred_by, referred_id: userId })
  if (error) {
    if ((error as { code?: string }).code !== '23505') {
      console.error('[auth/confirm] referral credit failed', {
        userId,
        code: (error as { code?: string }).code,
        message: error.message,
      })
    }
    return
  }

  await notifyInApp({
    playerId: profile.referred_by,
    type: 'referral_credited',
    title: 'Referral credited',
    body: 'Someone you referred just joined Sentinel X — ₦100 added to your referral balance.',
    link: '/dashboard',
  })
```
to:
```ts
  const { data: referral, error } = await admin
    .from('referrals')
    .insert({ referrer_id: profile.referred_by, referred_id: userId })
    .select('id')
    .single()
  if (error || !referral) {
    if ((error as { code?: string })?.code !== '23505') {
      console.error('[auth/confirm] referral credit failed', {
        userId,
        code: (error as { code?: string })?.code,
        message: error?.message,
      })
    }
    return
  }

  await creditWallet(admin, profile.referred_by, REFERRAL_CREDIT_NGN, 'referral', referral.id)

  await notifyInApp({
    playerId: profile.referred_by,
    type: 'referral_credited',
    title: 'Referral credited',
    body: 'Someone you referred just joined Sentinel X — ₦100 added to your wallet.',
    link: '/dashboard',
  })
```

The `UNIQUE(referred_id)` constraint on `referrals` still makes this idempotent end-to-end: a retried confirm hits the `23505` branch and returns before `creditWallet` is ever called a second time.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/auth/confirm/route.ts lib/referrals/constants.ts
git commit -m "feat: #28 credit the wallet ₦100 automatically on referral confirmation"
```

---

### Task 6: Staked-friendly credit hook — `lib/friendly-matches/admin-actions.ts`

**Files:**
- Modify: `lib/friendly-matches/admin-actions.ts`

**Interfaces:**
- Consumes: `creditWallet` from Task 2.

- [ ] **Step 1: Credit the winner inside the existing staked-only block**

Add the import:
```ts
import { creditWallet } from '@/lib/wallet/service'
```

Change:
```ts
  // Staked friendlies only — Sentinel Score events + balance eligibility.
  // Free friendlies never reach here with a stake_amount, so this whole
  // block is a no-op for them by construction.
  if (fm.stake_amount && fm.winner_id) {
    const events = friendlyMatchEventsFor({
      id: fm.id,
      challengerId: fm.challenger_id,
      opponentId: fm.opponent_id,
      scoreChallenger: fm.score_challenger,
      scoreOpponent: fm.score_opponent,
      winnerId: fm.winner_id,
    })
    await admin.from('sentinel_score_events').insert(events)

    for (const playerId of [fm.challenger_id, fm.opponent_id]) {
      const { data: scoreEvents } = await admin
        .from('sentinel_score_events')
        .select('points_delta')
        .eq('player_id', playerId)
      await admin
        .from('profiles')
        .update({ sentinel_score: computeScore(scoreEvents ?? []) })
        .eq('id', playerId)
    }
  }
```
to:
```ts
  // Staked friendlies only — Sentinel Score events + wallet credit. Free
  // friendlies never reach here with a stake_amount, so this whole block is
  // a no-op for them by construction.
  if (fm.stake_amount && fm.winner_id) {
    const events = friendlyMatchEventsFor({
      id: fm.id,
      challengerId: fm.challenger_id,
      opponentId: fm.opponent_id,
      scoreChallenger: fm.score_challenger,
      scoreOpponent: fm.score_opponent,
      winnerId: fm.winner_id,
    })
    await admin.from('sentinel_score_events').insert(events)

    for (const playerId of [fm.challenger_id, fm.opponent_id]) {
      const { data: scoreEvents } = await admin
        .from('sentinel_score_events')
        .select('points_delta')
        .eq('player_id', playerId)
      await admin
        .from('profiles')
        .update({ sentinel_score: computeScore(scoreEvents ?? []) })
        .eq('id', playerId)
    }

    await creditWallet(admin, fm.winner_id, fm.stake_amount * 2, 'friendly_stake', fm.id)
  }
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/friendly-matches/admin-actions.ts
git commit -m "feat: #28 credit the wallet automatically when a staked friendly is confirmed"
```

---

### Task 7: `NotificationType` union — `lib/notifications/inbox.ts`

**Files:**
- Modify: `lib/notifications/inbox.ts`

- [ ] **Step 1: Match the union to the migrated CHECK constraint**

Change:
```ts
export type NotificationType =
  | 'listing_approved'
  | 'listing_removed'
  | 'withdrawal_paid'
  | 'withdrawal_rejected'
  | 'referral_withdrawal_paid'
  | 'referral_withdrawal_rejected'
  | 'result_confirmed'
  | 'referral_credited'
  | 'friend_request'
  | 'friendly_withdrawal_paid'
  | 'friendly_withdrawal_rejected'
```
to:
```ts
export type NotificationType =
  | 'listing_approved'
  | 'listing_removed'
  | 'withdrawal_paid'
  | 'withdrawal_rejected'
  | 'result_confirmed'
  | 'referral_credited'
  | 'friend_request'
  | 'wallet_credited'
```

- [ ] **Step 2: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: no errors anywhere — this surfaces any remaining call site still passing a retired notification type (there shouldn't be any once Tasks 3, 5, 6, 9, 10 are done, since those are exactly the files that referenced the retired types).

- [ ] **Step 3: Commit**

```bash
git add lib/notifications/inbox.ts
git commit -m "feat: #28 drop retired withdrawal notification types, add wallet_credited"
```

---

### Task 8: Retire the dormant Paystack Transfer webhook wiring

**Files:**
- Delete: `lib/withdrawals/webhook.ts`, `lib/withdrawals/webhook.test.ts`
- Modify: `app/api/paystack/webhook/route.ts`

The new `withdrawal_requests` table (Task 1) has no `processing`/`failed` status and no `paystack_transfer_reference` column — `applyTransferWebhook` (`lib/withdrawals/webhook.ts`) queries exactly those, so it would break at runtime if left wired. This automated-transfer path is already fully disabled at the admin-action layer (the commented-out block in the retired `lib/withdrawals/admin-actions.ts`) and was never reachable in practice; removing its webhook branch here just finishes retiring the same dead feature, not a new decision. Re-enabling automated Transfer payouts later is separately-scoped future work per the wallet spec §out-of-scope, and would re-add this wiring as part of that work.

- [ ] **Step 1: Remove the `transfer.*` branch from the main webhook route**

Change:
```ts
import { NextRequest, NextResponse } from 'next/server'
import { verifyWebhookSignature } from '@/lib/paystack/server'
import { confirmRegistration } from '@/lib/tournaments/confirm'
import { confirmFriendlyStake } from '@/lib/friendly-matches/confirm'
import { applyIdentificationWebhook } from '@/lib/kyc/webhook'
import { applyTransferWebhook } from '@/lib/withdrawals/webhook'
```
to:
```ts
import { NextRequest, NextResponse } from 'next/server'
import { verifyWebhookSignature } from '@/lib/paystack/server'
import { confirmRegistration } from '@/lib/tournaments/confirm'
import { confirmFriendlyStake } from '@/lib/friendly-matches/confirm'
import { applyIdentificationWebhook } from '@/lib/kyc/webhook'
```

Change:
```ts
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
```
to:
```ts
  } else if (type === 'customeridentification.success' || type === 'customeridentification.failed') {
    const customerCode = event.data?.customer?.customer_code
    if (customerCode) {
      await applyIdentificationWebhook(customerCode, type, event.data?.message ?? null)
    }
  }
  // transfer.success/failed/reversed: no longer handled — withdrawal payouts
  // are manual-only (see docs/superpowers/specs/2026-07-13-player-wallet-system-design.md
  // §out-of-scope). Re-add this branch alongside re-enabling automated
  // Paystack Transfer, not before.
```

- [ ] **Step 2: Delete the retired files**

```bash
git rm lib/withdrawals/webhook.ts lib/withdrawals/webhook.test.ts
```

- [ ] **Step 3: Run the test suite**

Run: `npm test`
Expected: all remaining tests pass; no test references the deleted `webhook.ts`.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/api/paystack/webhook/route.ts
git commit -m "chore: #28 retire dormant Paystack Transfer webhook wiring (withdrawal_requests no longer has transfer columns)"
```

---

### Task 9: Delete the three retired `lib/` withdrawal/balance modules

**Files:**
- Delete: `lib/withdrawals/actions.ts`, `lib/withdrawals/admin-actions.ts`, `lib/withdrawals/schema.ts`
- Delete: `lib/referrals/actions.ts`, `lib/referrals/admin-actions.ts`, `lib/referrals/balance.ts`
- Delete: `lib/friendly-withdrawals/` (entire directory: `actions.ts`, `admin-actions.ts`, `balance.ts`, `schema.ts`)

These are all now dead — Task 3 replaced their functionality, and nothing outside this directory imports from them except the dashboard/admin UI files that Tasks 10–11 rewire.

- [ ] **Step 1: Delete the files**

```bash
git rm lib/withdrawals/actions.ts lib/withdrawals/admin-actions.ts lib/withdrawals/schema.ts
git rm lib/referrals/actions.ts lib/referrals/admin-actions.ts lib/referrals/balance.ts
git rm -r lib/friendly-withdrawals
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors in every file that still imports from these deleted modules — this is the checklist for Tasks 10–11. Do not proceed to commit until Tasks 10–11 clear all of them; keep this deletion staged alongside those tasks, or run Tasks 9–11 as one working session before committing.

- [ ] **Step 3: Commit** (only after Tasks 10–11 are also complete and the typecheck above is clean)

```bash
git add -A
git commit -m "chore: #28 delete retired prize/referral/friendly withdrawal modules, superseded by lib/wallet"
```

---

### Task 10: Dashboard — `WalletPanel`, trimmed `ReferralPanel`, wiring

**Files:**
- Create: `components/dashboard/WalletPanel.tsx`
- Modify: `components/dashboard/ReferralPanel.tsx`
- Delete: `components/dashboard/WithdrawalPanel.tsx`, `components/dashboard/FriendlyWithdrawalPanel.tsx`
- Modify: `app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `requestWalletWithdrawal`/`WalletWithdrawalState` from Task 3; `maskAccountNumber`/`kycPanelMode` (`lib/kyc/logic.ts`); `Field` (`components/dashboard/FormField.tsx`); `formatDate`/`formatNaira` (`lib/format.ts`).
- Produces:
  - `export interface WalletRequestRow { id: string; amount: number; bank_name: string; account_number: string; account_name: string; status: string; admin_note: string | null; requested_at: string; resolved_at: string | null }`
  - `export function WalletPanel(props: { balance: number; requests: WalletRequestRow[]; hasActive: boolean; kycStatus: string; kycFailureReason: string | null; banks: { name: string; code: string }[]; payoutAccount: { bankName: string; accountNumber: string; accountName: string } | null }): JSX.Element`

- [ ] **Step 1: Write `components/dashboard/WalletPanel.tsx`**

This is `WithdrawalPanel.tsx` (read in full during planning) with `hasActive`/`requests` sourced from the unified queue and a balance line added above the KYC/withdrawal-form section:

```tsx
'use client'
import { useFormState } from 'react-dom'
import { requestWalletWithdrawal, type WalletWithdrawalState } from '@/lib/wallet/actions'
import { formatDate, formatNaira } from '@/lib/format'
import { maskAccountNumber, kycPanelMode } from '@/lib/kyc/logic'
import { KycForm } from './KycForm'
import { Field } from './FormField'

export interface WalletRequestRow {
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
  paid: { label: 'Paid', cls: 'text-emerald-400' },
  rejected: { label: 'Rejected', cls: 'text-red-400' },
}

export function WalletPanel({
  balance,
  requests,
  hasActive,
  kycStatus,
  kycFailureReason,
  banks,
  payoutAccount,
}: {
  balance: number
  requests: WalletRequestRow[]
  hasActive: boolean
  kycStatus: string
  kycFailureReason: string | null
  banks: { name: string; code: string }[]
  payoutAccount: PayoutAccount | null
}) {
  const mode = kycPanelMode(kycStatus)

  return (
    <section className="mb-10">
      <h2 className="mb-4 text-base font-bold text-white">Wallet</h2>
      <p className="mb-4 rounded-2xl border border-slate-800 bg-slate-900 p-4 text-2xl font-black text-white">
        {formatNaira(balance)}
      </p>

      {mode === 'form' && <KycForm banks={banks} failureReason={kycFailureReason} />}
      {mode === 'pending' && (
        <div className="rounded-2xl border border-sky-500/30 bg-sky-500/10 p-5 text-center text-sm font-semibold text-sky-300">
          Verifying your identity — usually completes within a few minutes.
        </div>
      )}
      {mode === 'verified' && payoutAccount && (
        <VerifiedWithdrawalForm hasActive={hasActive} payoutAccount={payoutAccount} maxAmount={balance} />
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
  maxAmount,
}: {
  hasActive: boolean
  payoutAccount: PayoutAccount
  maxAmount: number
}) {
  const [state, formAction] = useFormState<WalletWithdrawalState, FormData>(requestWalletWithdrawal, undefined)

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
          <Field name="amount" label={`Amount (₦, up to ${formatNaira(maxAmount)})`} type="number" min={100} max={maxAmount} placeholder="100" />
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

function RequestRow({ req }: { req: WalletRequestRow }) {
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

- [ ] **Step 2: Trim `components/dashboard/ReferralPanel.tsx`** — drop balance/withdrawal, keep link/count/list

Change:
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
to:
```tsx
'use client'
import { useState } from 'react'

export function ReferralPanel({
  username,
  referredPlayers,
}: {
  username: string
  referredPlayers: string[]
}) {
  const [copied, setCopied] = useState(false)
  const link = `https://sentinelxesports.vercel.app/signup?ref=${username}`
  const referralCount = referredPlayers.length

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
          {referralCount} referral{referralCount === 1 ? '' : 's'} — each one adds ₦100 to your wallet.
        </p>

        {referredPlayers.length > 0 && (
          <p className="mt-2 text-xs text-slate-500">Referred: {referredPlayers.join(', ')}</p>
        )}
      </div>
    </section>
  )
}
```

- [ ] **Step 3: Delete the retired panels**

```bash
git rm components/dashboard/WithdrawalPanel.tsx components/dashboard/FriendlyWithdrawalPanel.tsx
```

- [ ] **Step 4: Rewire `app/dashboard/page.tsx`**

Replace the three retired data queries (`wrRes`/`withdrawal_requests`, `referralWithdrawalsRes`/`referral_withdrawal_requests`, `friendlyWinsRes`/`friendly_matches` stake lookup, `friendlyWithdrawalsRes`/`friendly_withdrawal_requests`) with one `walletRes` query for balance and one `walletRequestsRes` query for the withdrawal queue, and drop the panels/imports that no longer exist.

Change the imports:
```ts
import { WithdrawalPanel, type WithdrawalRow } from '@/components/dashboard/WithdrawalPanel'
```
```ts
import { ReferralPanel, type ReferralWithdrawalRow } from '@/components/dashboard/ReferralPanel'
```
```ts
import { FriendlyWithdrawalPanel, type FriendlyWithdrawalRow } from '@/components/dashboard/FriendlyWithdrawalPanel'
```
to:
```ts
import { WalletPanel, type WalletRequestRow } from '@/components/dashboard/WalletPanel'
```
```ts
import { ReferralPanel } from '@/components/dashboard/ReferralPanel'
```
(the `FriendlyWithdrawalPanel` import line is removed entirely, no replacement)

Change the `Promise.all` array and its destructuring — remove `wrRes`, `referralWithdrawalsRes`, `friendlyWinsRes`, `friendlyWithdrawalsRes`, add `walletRes`, `walletRequestsRes`:
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
    referralsRes,
    referralWithdrawalsRes,
    friendsRes,
    friendlyWinsRes,
    friendlyWithdrawalsRes,
  ] = await Promise.all([
```
to:
```ts
  const [
    profileRes,
    matchesRes,
    resultsRes,
    regsRes,
    walletRes,
    walletRequestsRes,
    listingsRes,
    ordersRes,
    salesRes,
    kycRes,
    banks,
    referralsRes,
    friendsRes,
  ] = await Promise.all([
```

Change the corresponding query list — remove:
```ts
    supabase
      .from('withdrawal_requests')
      .select(
        'id, amount, bank_name, account_number, account_name, status, admin_note, requested_at, resolved_at',
      )
      .eq('player_id', user.id)
      .order('requested_at', { ascending: false }),
```
and further down:
```ts
    supabase
      .from('referral_withdrawal_requests')
      .select('id, amount, status, admin_note, requested_at, resolved_at')
      .eq('player_id', user.id)
      .order('requested_at', { ascending: false }),
```
and:
```ts
    supabase
      .from('friendly_matches')
      .select('stake_amount')
      .eq('winner_id', user.id)
      .eq('status', 'completed')
      .not('stake_amount', 'is', null),
    supabase
      .from('friendly_withdrawal_requests')
      .select('id, amount, status, admin_note, requested_at, resolved_at')
      .eq('player_id', user.id)
      .order('requested_at', { ascending: false }),
```
replace the first removed block's position with:
```ts
    supabase.from('wallets').select('balance').eq('player_id', user.id).maybeSingle(),
    supabase
      .from('withdrawal_requests')
      .select(
        'id, amount, bank_name, account_number, account_name, status, admin_note, requested_at, resolved_at',
      )
      .eq('player_id', user.id)
      .order('requested_at', { ascending: false }),
```
and remove the other two blocks entirely (no replacement) — `referralsRes`'s query (the `referrals` select, unrelated to withdrawals) stays exactly as-is.

Change the derived-data section:
```ts
  const kyc = kycRes.data
  const withdrawals = (wrRes.data ?? []) as WithdrawalRow[]
  const hasActive = withdrawals.some((w) => w.status === 'pending' || w.status === 'processing')
```
to:
```ts
  const kyc = kycRes.data
  const walletBalance = walletRes.data?.balance ?? 0
  const walletRequests = (walletRequestsRes.data ?? []) as WalletRequestRow[]
  const hasActive = walletRequests.some((w) => w.status === 'pending')
```

Remove:
```ts
  const referredPlayers = ((referralsRes.data as unknown[] | null) ?? []).map((raw) =>
    referredName((raw as { referred: ReferredRef }).referred),
  )
  const referralWithdrawals = (referralWithdrawalsRes.data ?? []) as ReferralWithdrawalRow[]
```
replace with:
```ts
  const referredPlayers = ((referralsRes.data as unknown[] | null) ?? []).map((raw) =>
    referredName((raw as { referred: ReferredRef }).referred),
  )
```

Remove entirely:
```ts
  const friendlyWins = ((friendlyWinsRes.data ?? []) as { stake_amount: number | null }[]).map((w) => ({
    stakeAmount: w.stake_amount as number,
  }))
  const friendlyWithdrawals = (friendlyWithdrawalsRes.data ?? []) as FriendlyWithdrawalRow[]
```

Change the JSX:
```tsx
      <ReferralPanel
        username={profile?.username ?? ''}
        referredPlayers={referredPlayers}
        requests={referralWithdrawals}
        kycVerified={kyc?.kyc_status === 'verified'}
      />
      <FriendsPanel incoming={incomingRequests} friends={friendsList} />
      <FriendlyWithdrawalPanel
        wins={friendlyWins}
        requests={friendlyWithdrawals}
        kycVerified={kyc?.kyc_status === 'verified'}
      />
      <FixtureSection fixtures={fixtures} />
      <MyTournaments registrations={registrations} />
      <MyListings listings={myListings} />
      <MyOrders orders={myOrders} />
      <MySales sales={mySales} />
      <WithdrawalPanel
        requests={withdrawals}
        hasActive={hasActive}
        kycStatus={kyc?.kyc_status ?? 'unverified'}
        kycFailureReason={kyc?.kyc_failure_reason ?? null}
        banks={banks}
        payoutAccount={payoutAccount}
      />
```
to:
```tsx
      <ReferralPanel username={profile?.username ?? ''} referredPlayers={referredPlayers} />
      <FriendsPanel incoming={incomingRequests} friends={friendsList} />
      <FixtureSection fixtures={fixtures} />
      <MyTournaments registrations={registrations} />
      <MyListings listings={myListings} />
      <MyOrders orders={myOrders} />
      <MySales sales={mySales} />
      <WalletPanel
        balance={walletBalance}
        requests={walletRequests}
        hasActive={hasActive}
        kycStatus={kyc?.kyc_status ?? 'unverified'}
        kycFailureReason={kyc?.kyc_failure_reason ?? null}
        banks={banks}
        payoutAccount={payoutAccount}
      />
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors in `app/dashboard/page.tsx` or `components/dashboard/*`.

- [ ] **Step 6: Commit**

```bash
git add components/dashboard/WalletPanel.tsx components/dashboard/ReferralPanel.tsx app/dashboard/page.tsx
git commit -m "feat: #28 dashboard WalletPanel replaces WithdrawalPanel/FriendlyWithdrawalPanel; ReferralPanel drops balance/withdrawal"
```

---

### Task 11: Admin — `/admin/wallet`, nav, retire the three old admin pages

**Files:**
- Create: `components/admin/WalletCreditForm.tsx`
- Create: `components/admin/WalletWithdrawalQueueRow.tsx`
- Create: `app/admin/wallet/page.tsx`
- Delete: `components/admin/WithdrawalQueueRow.tsx`
- Delete: `app/admin/withdrawals/`, `app/admin/referrals/`, `app/admin/friendly-withdrawals/` (entire directories)
- Modify: `lib/admin/nav.ts`

**Interfaces:**
- Consumes: `resolveWalletWithdrawal`/`WalletWithdrawalResolveState`, `adminCreditWallet`/`AdminCreditState` from Task 3.

- [ ] **Step 1: Write `components/admin/WalletCreditForm.tsx`**

```tsx
'use client'
import { useFormState, useFormStatus } from 'react-dom'
import { adminCreditWallet, type AdminCreditState } from '@/lib/wallet/admin-actions'

export function WalletCreditForm() {
  const [state, formAction] = useFormState<AdminCreditState, FormData>(adminCreditWallet, undefined)
  return (
    <form action={formAction} className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <h3 className="text-sm font-bold text-white">Credit a player&apos;s wallet</h3>
      <div className="grid grid-cols-2 gap-3">
        <input
          name="username"
          placeholder="Username"
          required
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
        />
        <input
          name="amount"
          type="number"
          min={1}
          placeholder="Amount (₦)"
          required
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
        />
      </div>
      <textarea
        name="note"
        rows={2}
        placeholder="Reason (required — e.g. compensation, sponsored prize)"
        required
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
      />
      {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
      {state?.success && <p className="text-sm text-emerald-400">Credited.</p>}
      <SubmitButton />
    </form>
  )
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-500 disabled:opacity-60"
    >
      {pending ? 'Crediting…' : 'Credit wallet'}
    </button>
  )
}
```

- [ ] **Step 2: Write `components/admin/WalletWithdrawalQueueRow.tsx`**

```tsx
'use client'
import { useFormState } from 'react-dom'
import { resolveWalletWithdrawal, type WalletWithdrawalResolveState } from '@/lib/wallet/admin-actions'
import { formatNaira } from '@/lib/format'

export interface PendingWalletWithdrawal {
  id: string
  playerName: string
  amount: number
  bankName: string
  accountNumber: string
  accountName: string
}

export function WalletWithdrawalQueueRow({ req }: { req: PendingWalletWithdrawal }) {
  const [state, action] = useFormState<WalletWithdrawalResolveState, FormData>(resolveWalletWithdrawal, undefined)

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

- [ ] **Step 3: Write `app/admin/wallet/page.tsx`**

```tsx
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin/auth'
import { formatDate, formatNaira } from '@/lib/format'
import { WalletCreditForm } from '@/components/admin/WalletCreditForm'
import { WalletWithdrawalQueueRow, type PendingWalletWithdrawal } from '@/components/admin/WalletWithdrawalQueueRow'

export const metadata: Metadata = { title: 'Wallet · Admin · SentinelX' }

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

export default async function AdminWalletPage() {
  await requireAdmin()
  const supabase = createClient()
  const [{ data: queueData }, { data: resolvedData }] = await Promise.all([
    supabase
      .from('withdrawal_requests')
      .select(
        'id, amount, bank_name, account_number, account_name, profiles(username, display_name)',
      )
      .eq('status', 'pending')
      .order('requested_at', { ascending: true }),
    supabase
      .from('withdrawal_requests')
      .select('id, amount, status, admin_note, resolved_at, profiles(username, display_name)')
      .in('status', ['paid', 'rejected'])
      .order('resolved_at', { ascending: false })
      .limit(20),
  ])

  const queue: PendingWalletWithdrawal[] = ((queueData as unknown[] | null) ?? []).map((raw) => {
    const w = raw as {
      id: string
      amount: number
      bank_name: string
      account_number: string
      account_name: string
      profiles: ProfileRef | ProfileRef[]
    }
    return {
      id: w.id,
      playerName: nameOf(firstP(w.profiles)),
      amount: w.amount,
      bankName: w.bank_name,
      accountNumber: w.account_number,
      accountName: w.account_name,
    }
  })

  const resolved = ((resolvedData as unknown[] | null) ?? []).map((raw) => {
    const r = raw as {
      id: string
      amount: number
      status: string
      admin_note: string | null
      resolved_at: string | null
      profiles: ProfileRef | ProfileRef[]
    }
    return {
      id: r.id,
      playerName: nameOf(firstP(r.profiles)),
      amount: r.amount,
      status: r.status,
      adminNote: r.admin_note,
      resolvedAt: r.resolved_at,
    }
  })

  return (
    <section className="space-y-8">
      <WalletCreditForm />

      <div>
        <h2 className="mb-4 text-base font-bold text-white">Needs action</h2>
        {queue.length === 0 ? (
          <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center text-sm text-slate-500">
            No withdrawals need action.
          </p>
        ) : (
          <div className="space-y-2">
            {queue.map((req) => (
              <WalletWithdrawalQueueRow key={req.id} req={req} />
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

- [ ] **Step 4: Update `lib/admin/nav.ts`**

Change:
```ts
export const ADMIN_NAV: AdminNavItem[] = [
  { label: 'Overview', href: '/admin', adminOnly: false },
  { label: 'Tournaments', href: '/admin/tournaments', adminOnly: false },
  { label: 'Results', href: '/admin/results', adminOnly: false },
  { label: 'Community', href: '/admin/community', adminOnly: false },
  { label: 'TV', href: '/admin/tv', adminOnly: false },
  { label: 'Exchange', href: '/admin/exchange', adminOnly: false },
  { label: 'Withdrawals', href: '/admin/withdrawals', adminOnly: true },
  { label: 'Referrals', href: '/admin/referrals', adminOnly: true },
  { label: 'Friendlies', href: '/admin/friendlies', adminOnly: true },
  { label: 'Friendly withdrawals', href: '/admin/friendly-withdrawals', adminOnly: true },
]
```
to:
```ts
export const ADMIN_NAV: AdminNavItem[] = [
  { label: 'Overview', href: '/admin', adminOnly: false },
  { label: 'Tournaments', href: '/admin/tournaments', adminOnly: false },
  { label: 'Results', href: '/admin/results', adminOnly: false },
  { label: 'Community', href: '/admin/community', adminOnly: false },
  { label: 'TV', href: '/admin/tv', adminOnly: false },
  { label: 'Exchange', href: '/admin/exchange', adminOnly: false },
  { label: 'Wallet', href: '/admin/wallet', adminOnly: true },
  { label: 'Friendlies', href: '/admin/friendlies', adminOnly: true },
]
```

(`/admin/friendlies` — the friendly-match confirm/dispute queue — is unrelated to withdrawals and stays untouched.)

- [ ] **Step 5: Delete the retired admin pages and queue row component**

```bash
git rm components/admin/WithdrawalQueueRow.tsx
git rm -r app/admin/withdrawals app/admin/referrals app/admin/friendly-withdrawals
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors anywhere in the project. If Task 9's deletions haven't been committed yet, this is the point where that combined typecheck should finally be clean — commit Task 9 now too.

- [ ] **Step 7: Build**

Run: `npm run build`
Expected: succeeds with no type or lint errors.

- [ ] **Step 8: Commit**

```bash
git add components/admin/WalletCreditForm.tsx components/admin/WalletWithdrawalQueueRow.tsx app/admin/wallet/page.tsx lib/admin/nav.ts
git commit -m "feat: #28 admin /admin/wallet — manual credit form + unified withdrawal queue, replaces withdrawals/referrals/friendly-withdrawals admin pages"
```

---

### Task 12: Manual end-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 2: Manual walkthrough** (against a local dev server, `npm run dev`, using QA test accounts)

1. As a player with no wallet row yet, load `/dashboard` — `WalletPanel` shows `₦0`, no crash on a missing `wallets` row.
2. Sign up a new test account through an existing player's referral link (`?ref=<username>`), confirm the email — the referrer's `/dashboard` wallet balance increases by ₦100, and a `referral_credited` notification appears.
3. As staff, confirm a tournament's final match result at `/admin/results` — the winner's wallet balance increases by that tournament's `prize_pool`, and a `wallet_credited` notification appears for the winner (confirm via the Supabase `execute_sql` MCP tool: `select * from wallet_transactions where type = 'prize' order by created_at desc limit 1;`).
4. Create and confirm a staked friendly match end to end (`/dashboard` → challenge → both pay → submit result → admin confirms at `/admin/friendlies`) — the winner's wallet balance increases by `stake_amount * 2`.
5. As a KYC-verified player with a positive balance, request a withdrawal for more than the balance — expect the "more than your available balance" error, balance unchanged.
6. Request a withdrawal for exactly the balance — wallet balance drops to 0 immediately (debit-on-request), request appears as pending on `/admin/wallet`.
7. As admin, reject that request with a note — the wallet balance is restored, a `withdrawal_rejected` notification appears, and a `wallet_transactions` row of `type = 'withdrawal_reversal'` exists.
8. As admin, use the "Credit a player's wallet" form on `/admin/wallet` to credit an arbitrary username — that player's dashboard balance reflects it, `wallet_credited` notification appears.
9. Confirm `/admin/withdrawals`, `/admin/referrals`, `/admin/friendly-withdrawals` all 404, and the admin sidebar/nav shows a single "Wallet" entry instead of the three retired ones.

- [ ] **Step 2: Report results**

If any step fails, treat it as a bug against the specific task above that owns the broken code path — do not proceed to closing out the plan until all nine checks pass.
