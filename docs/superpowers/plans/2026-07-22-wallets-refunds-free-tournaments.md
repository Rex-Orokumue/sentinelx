# Wallet Refunds & Free Tournaments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins cancel a tournament, manually credit any player's wallet (with reason logging), one-click refund paid registrations on a cancelled tournament, and let players register for ₦0 tournaments without a Paystack step.

**Architecture:** One migration adds `'cancelled'` to `tournaments.status` (everything else needed — `wallet_transactions.note`, the `admin_credit`/`prize` transaction types, `tournament_registrations.payment_status = 'refunded'` — already exists). A new `manualCreditWallet()` wraps the existing `creditWallet()` service function with admin-gating and validation; `cancelTournament` and `refundRegistration` are added to the existing tournament admin-actions files, following the same inline-validation, `requireAdmin()`/`requireStaff()`, conditional-atomic-update conventions already used by `deleteTournament`, `openRegistration`, and the waiver-redemption code in `registerForTournament`. UI additions follow the existing RecomputeButton two-step-confirm pattern and the WaiverRow pattern of deriving row state from server data rather than client state.

**Tech Stack:** Next.js 14 App Router (Server Actions + `useFormState`), Supabase (Postgres + supabase-js), TypeScript, Tailwind. Vitest for pure-logic unit tests only — this codebase has no test coverage for Server Actions, pages, or components (verified: zero `*.test.tsx` files, zero mocked-Supabase tests exist anywhere in `lib/`); the existing convention for actions/pages/components is `next build`/`tsc` type-checking plus manual QA in the dev server, not unit tests. This plan follows that convention rather than inventing a new one.

## Global Constraints

- Every new Server Action that mutates data must call `requireAdmin()` (financial-adjacent: credit, refund, cancel) — never `requireStaff()` — matching the existing `deleteTournament` precedent (moderators get read access, not financial actions per `CLAUDE.md`).
- Never write to `wallets.balance` directly — always go through `creditWallet()` (`lib/wallet/service.ts`), which already lazily upserts the wallet row.
- Any conditional state-flip that guards against a double-action (waiver redemption is the existing precedent) must use an atomic `.update(...).eq('id', x).eq('<guard column>', <expected value>).select('id')` and treat an empty returned set as "someone else already did this" — never a plain check-then-update.
- `fee_waived` must stay `false` for zero-fee registrations — it means "a fee existed but was comped for this player," which is not the case for a ₦0 tournament.
- Naira amounts are always whole integers (`Number.isInteger`), matching every existing money input in this codebase (`WalletCreditForm`, Paystack amounts).
- Run `npx tsc --noEmit` after every task that touches `.ts`/`.tsx` files — the codebase has no separate `typecheck` script, and `tsc --noEmit` is faster than a full `next build` for iteration.

---

### Task 1: Migration — allow tournaments to be cancelled

**Files:**
- Create: `supabase/migrations/032_tournament_cancellation.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `tournaments.status` now accepts `'cancelled'` in addition to the existing five values. No TypeScript type changes needed — `lib/supabase/types.ts` already types `tournaments.status` as plain `string` (CHECK constraints on `text` columns don't generate literal unions in this codebase's generated types; verified by checking `lib/supabase/types.ts:1304`).

- [ ] **Step 1: Write the migration**

```sql
-- 032_tournament_cancellation.sql
-- Adds 'cancelled' as a valid tournament status so admins can cancel a live
-- or announced tournament (e.g. Season 2) and unlock per-registration refunds.
ALTER TABLE public.tournaments DROP CONSTRAINT tournaments_status_check;
ALTER TABLE public.tournaments ADD CONSTRAINT tournaments_status_check
  CHECK (status IN (
    'draft', 'registration_open', 'registration_closed',
    'active', 'completed', 'cancelled'
  ));
```

- [ ] **Step 2: Apply the migration to the Supabase project**

Use the `mcp__claude_ai_Supabase__apply_migration` tool with the file's contents (name: `tournament_cancellation`, matching the `032_` filename). If that tool is unavailable in the executing environment, run the equivalent via the Supabase CLI (`supabase db push`) or `mcp__claude_ai_Supabase__execute_sql` with the same SQL.

- [ ] **Step 3: Verify the constraint was updated**

Run via `mcp__claude_ai_Supabase__execute_sql`:
```sql
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.tournaments'::regclass and conname = 'tournaments_status_check';
```
Expected: the definition string includes `'cancelled'::text`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/032_tournament_cancellation.sql
git commit -m "feat: allow tournaments.status = 'cancelled'"
```

---

### Task 2: `manualCreditWallet` server action

**Files:**
- Create: `lib/admin/wallet-actions.ts`

**Interfaces:**
- Consumes: `creditWallet(admin, playerId, amount, type, referenceId, note)` and `getWalletBalance(admin, playerId)` from `lib/wallet/service.ts` (both already exist, unchanged — `creditWallet` already lazily upserts the `wallets` row, so no separate upsert is needed here). `requireAdmin()` from `lib/admin/auth.ts`. `createAdminClient()` from `lib/supabase/admin.ts`. `notifyInApp()` from `lib/notifications/inbox.ts` (its `NotificationType` already includes `'wallet_credited'`, used identically by the existing `lib/wallet/admin-actions.ts::adminCreditWallet`). `formatNaira` from `lib/format.ts`.
- Produces (used by Tasks 3, 5, 6):
  - `manualCreditWallet(playerId: string, amount: number, reason: string, type: WalletTxnType = 'admin_credit'): Promise<{ balance: number } | { error: string }>` — the callable core, usable directly from other Server Actions (Task 5's `refundRegistration`).
  - `manualCreditWalletFormAction(_prev: ManualCreditFormState, formData: FormData): Promise<ManualCreditFormState>` — `useFormState`-compatible wrapper reading `playerId`, `amount`, `reason` from `FormData` (Task 3's UI).
  - `export type ManualCreditFormState = { error?: string; success?: boolean; balance?: number } | undefined`

- [ ] **Step 1: Write `lib/admin/wallet-actions.ts`**

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/admin/auth'
import { creditWallet, getWalletBalance, type WalletTxnType } from '@/lib/wallet/service'
import { notifyInApp } from '@/lib/notifications/inbox'
import { formatNaira } from '@/lib/format'

export type ManualCreditResult = { balance: number } | { error: string }

// Core credit action, reusable from any Server Action (e.g. refundRegistration).
// Never writes wallets.balance directly — always goes through creditWallet(),
// which already lazily creates the wallet row on first credit.
export async function manualCreditWallet(
  playerId: string,
  amount: number,
  reason: string,
  type: WalletTxnType = 'admin_credit',
): Promise<ManualCreditResult> {
  await requireAdmin()
  if (!playerId) return { error: 'Missing player.' }
  if (!Number.isInteger(amount) || amount <= 0) {
    return { error: 'Enter a whole naira amount greater than 0.' }
  }
  const trimmedReason = reason.trim()
  if (!trimmedReason) return { error: 'Enter a reason for this credit.' }

  const admin = createAdminClient()
  await creditWallet(admin, playerId, amount, type, null, trimmedReason)
  const balance = await getWalletBalance(admin, playerId)

  await notifyInApp({
    playerId,
    type: 'wallet_credited',
    title: 'Wallet credited',
    body: `${formatNaira(amount)} was added to your wallet: ${trimmedReason}`,
    link: '/dashboard#wallet',
  })

  revalidatePath('/admin/wallet')
  revalidatePath('/dashboard')
  return { balance }
}

export type ManualCreditFormState = { error?: string; success?: boolean; balance?: number } | undefined

export async function manualCreditWalletFormAction(
  _prev: ManualCreditFormState,
  formData: FormData,
): Promise<ManualCreditFormState> {
  const playerId = String(formData.get('playerId') ?? '')
  const amount = Number(formData.get('amount'))
  const reason = String(formData.get('reason') ?? '')
  const result = await manualCreditWallet(playerId, amount, reason)
  if ('error' in result) return { error: result.error }
  return { success: true, balance: result.balance }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors referencing `lib/admin/wallet-actions.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/admin/wallet-actions.ts
git commit -m "feat: add manualCreditWallet admin action"
```

---

### Task 3: Wallet list on the existing `/admin/wallet` page

**Files:**
- Create: `components/admin/WalletListRow.tsx`
- Modify: `app/admin/wallet/page.tsx`

**Interfaces:**
- Consumes: `manualCreditWalletFormAction`, `type ManualCreditFormState` from Task 2 (`lib/admin/wallet-actions.ts`). `formatNaira`, `formatDateTime` from `lib/format.ts`.
- Produces: `WalletListRow({ wallet: AdminWalletRow })` component and the exported `AdminWalletRow` interface, rendered by `app/admin/wallet/page.tsx`. No other task depends on this.

- [ ] **Step 1: Write `components/admin/WalletListRow.tsx`**

```tsx
'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { manualCreditWalletFormAction, type ManualCreditFormState } from '@/lib/admin/wallet-actions'
import { formatNaira, formatDateTime } from '@/lib/format'

export interface AdminWalletRow {
  playerId: string
  name: string
  username: string | null
  balance: number
  updatedAt: string
}

const inputClass =
  'rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none'

export function WalletListRow({ wallet }: { wallet: AdminWalletRow }) {
  const [state, action] = useFormState<ManualCreditFormState, FormData>(
    manualCreditWalletFormAction,
    undefined,
  )
  const [confirming, setConfirming] = useState(false)

  // Reset after a successful credit — watched in the render body (not the
  // submit button's onClick) so we never unmount the <form> mid-submission.
  if (state?.success && confirming) setConfirming(false)

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-bold text-white">{wallet.name}</p>
          <p className="text-xs text-slate-500">
            {wallet.username ? `@${wallet.username} · ` : ''}Last updated {formatDateTime(wallet.updatedAt)}
          </p>
        </div>
        <p className="shrink-0 text-sm font-bold text-emerald-400">{formatNaira(wallet.balance)}</p>
      </div>

      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mt-3 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-300 hover:border-slate-500"
        >
          Credit wallet…
        </button>
      ) : (
        <form action={action} className="mt-3 space-y-2">
          <input type="hidden" name="playerId" value={wallet.playerId} />
          <input name="amount" type="number" min={1} placeholder="Amount (₦)" required className={inputClass} />
          <input name="reason" placeholder="Reason (required)" required className={`w-full ${inputClass}`} />
          <p className="text-xs font-semibold text-amber-400">Credit {wallet.name}&apos;s wallet?</p>
          <div className="flex gap-2">
            <button
              type="submit"
              className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-500"
            >
              Confirm credit
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-bold text-slate-300 hover:border-slate-500"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {state?.success && (
        <p className="mt-2 text-xs text-emerald-400">Credited — new balance {formatNaira(state.balance ?? 0)}.</p>
      )}
      {state?.error && <p className="mt-2 text-xs text-red-400">{state.error}</p>}
    </div>
  )
}
```

- [ ] **Step 2: Add the wallet list query + section to `app/admin/wallet/page.tsx`**

Modify `app/admin/wallet/page.tsx`: add the import and a new query alongside the two existing ones, and render the list above the "Needs action" section.

```ts
import { WalletListRow, type AdminWalletRow } from '@/components/admin/WalletListRow'
```

Change the `Promise.all` at line 25 to fetch three queries instead of two:

```ts
  const [{ data: walletsData }, { data: queueData }, { data: resolvedData }] = await Promise.all([
    supabase
      .from('wallets')
      .select('player_id, balance, updated_at, profiles(username, display_name)')
      .order('balance', { ascending: false }),
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
```

Add the mapping (using the existing `nameOf`/`firstP` helpers already defined in this file) right after the `walletsData` destructure:

```ts
  const wallets: AdminWalletRow[] = ((walletsData as unknown[] | null) ?? []).map((raw) => {
    const w = raw as {
      player_id: string
      balance: number
      updated_at: string
      profiles: ProfileRef | ProfileRef[]
    }
    const profile = firstP(w.profiles)
    return {
      playerId: w.player_id,
      name: nameOf(profile),
      username: profile?.username ?? null,
      balance: w.balance,
      updatedAt: w.updated_at,
    }
  })
```

Render it as a new section before `<WalletCreditForm />` (replace the opening of the returned JSX):

```tsx
  return (
    <section className="space-y-8">
      <div>
        <h2 className="mb-4 text-base font-bold text-white">All wallets</h2>
        {wallets.length === 0 ? (
          <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center text-sm text-slate-500">
            No wallets yet.
          </p>
        ) : (
          <div className="space-y-2">
            {wallets.map((w) => (
              <WalletListRow key={w.playerId} wallet={w} />
            ))}
          </div>
        )}
      </div>

      <WalletCreditForm />
```

(Leave the rest of the file — "Needs action" and "Recently resolved" sections — unchanged.)

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual QA**

Run `npm run dev`, log in as an admin, visit `/admin/wallet`. Confirm:
- The "All wallets" list renders above the existing credit-by-username form, showing name, `@username`, balance, and "Last updated" for every wallet.
- Clicking "Credit wallet…" on a row reveals the amount/reason inputs and a confirm/cancel pair; "Cancel" collapses it back.
- Submitting a valid amount+reason shows "Credited — new balance …" and the row's balance updates after a refresh.
- Submitting with amount `0` or empty reason shows the corresponding validation error without crediting anything.

- [ ] **Step 5: Commit**

```bash
git add components/admin/WalletListRow.tsx app/admin/wallet/page.tsx
git commit -m "feat: list all wallets with per-row manual credit on /admin/wallet"
```

---

### Task 4: `cancelTournament` action + admin UI

**Files:**
- Create: `components/admin/CancelTournamentButton.tsx`
- Modify: `lib/tournaments/admin-actions.ts` (add function after `openRegistration`, i.e. after line 201)
- Modify: `app/admin/tournaments/page.tsx`
- Modify: `components/admin/TournamentListRow.tsx`

**Interfaces:**
- Consumes: `TournamentFormState` type (already exported from `lib/tournaments/admin-actions.ts`, defined at line 10 — reused, not redefined). `requireAdmin` from `lib/admin/auth.ts`. `createClient` from `lib/supabase/server.ts`.
- Produces (used by Task 6's revalidation expectations and by this task's own UI):
  - `cancelTournament(_prev: TournamentFormState, formData: FormData): Promise<TournamentFormState>` — reads `id` from `FormData`.
  - `AdminTournamentRow` gains a new required field `paidRegistrations: number`.
  - `TournamentListRow` gains a `CancelTournamentButton` rendered when `isAdmin && ['registration_open','registration_closed','active'].includes(t.status)`.

- [ ] **Step 1: Add `cancelTournament` to `lib/tournaments/admin-actions.ts`**

Append after `openRegistration` (after the existing line 201):

```ts

export async function cancelTournament(
  _prev: TournamentFormState,
  formData: FormData,
): Promise<TournamentFormState> {
  await requireAdmin()
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing tournament.' }

  const supabase = createClient()
  const { data: current } = await supabase.from('tournaments').select('status').eq('id', id).maybeSingle()
  if (!current) return { error: 'Tournament not found.' }
  if (!['registration_open', 'registration_closed', 'active'].includes(current.status)) {
    return { error: 'Only a live or announced tournament can be cancelled.' }
  }

  const { error } = await supabase.from('tournaments').update({ status: 'cancelled' }).eq('id', id)
  if (error) return { error: 'Could not cancel the tournament.' }

  revalidatePath('/admin/tournaments')
  revalidatePath(`/admin/tournaments/${id}/registrations`)
  return { success: true }
}
```

(`requireAdmin`, `revalidatePath`, and `createClient` are already imported at the top of this file — no import changes needed.)

- [ ] **Step 2: Write `components/admin/CancelTournamentButton.tsx`**

```tsx
'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { cancelTournament, type TournamentFormState } from '@/lib/tournaments/admin-actions'

export function CancelTournamentButton({
  id,
  title,
  paidRegistrations,
}: {
  id: string
  title: string
  paidRegistrations: number
}) {
  const [state, action] = useFormState<TournamentFormState, FormData>(cancelTournament, undefined)
  const [confirming, setConfirming] = useState(false)

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs font-bold text-red-400 hover:bg-red-500/10"
      >
        Cancel tournament
      </button>
    )
  }
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <p className="text-xs font-semibold text-amber-400">
        Confirm — cancel {title}? {paidRegistrations} paid registration
        {paidRegistrations === 1 ? '' : 's'} will need manual refunds.
      </p>
      <div className="flex gap-2">
        <button
          type="submit"
          className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-500"
        >
          Yes, cancel
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-300 hover:border-slate-500"
        >
          Keep tournament
        </button>
      </div>
      {state?.error && <p className="text-xs text-red-400">{state.error}</p>}
    </form>
  )
}
```

(No success-state reset needed: once `cancelTournament` succeeds, `t.status` becomes `'cancelled'` server-side, `revalidatePath` refreshes the list, and `TournamentListRow`'s render condition for showing this button — Step 4 below — becomes false, so it naturally disappears instead of needing to reset its own `confirming` flag.)

- [ ] **Step 3: Add per-tournament paid-registration counts to `app/admin/tournaments/page.tsx`**

Add a second query and a count map. Change the single-query block (lines 19-24) plus the `rows` mapping:

```ts
  const [{ data }, { data: paidRegs }] = await Promise.all([
    supabase
      .from('tournaments')
      .select(
        'id, title, slug, status, game_id, max_players, registration_fee, prize_pool, registration_start, registration_end, tournament_start, tournament_end, games(name)',
      )
      .order('created_at', { ascending: false }),
    supabase.from('tournament_registrations').select('tournament_id').eq('payment_status', 'paid'),
  ])

  const paidCountByTournament = new Map<string, number>()
  for (const r of (paidRegs as { tournament_id: string }[] | null) ?? []) {
    paidCountByTournament.set(r.tournament_id, (paidCountByTournament.get(r.tournament_id) ?? 0) + 1)
  }
```

In the existing `rows` mapping (the `return { ... }` inside `.map`), add:

```ts
      paidRegistrations: paidCountByTournament.get(t.id) ?? 0,
```

And update the `AdminTournamentRow` import site's type usage is unaffected (the interface itself lives in `components/admin/TournamentListRow.tsx`, edited next).

- [ ] **Step 4: Add `paidRegistrations` to `AdminTournamentRow` and render the button in `components/admin/TournamentListRow.tsx`**

Add the field to the interface (after line 17):

```ts
  paidRegistrations: number
```

Import the new button at the top:

```ts
import { CancelTournamentButton } from './CancelTournamentButton'
```

Inside the component, after computing `canPublish` (line 35), add:

```ts
  const canCancel = isAdmin && ['registration_open', 'registration_closed', 'active'].includes(t.status)
```

Render it in the button row, after the "Delete" form block (after line 96, before the closing `</div>` at line 97):

```tsx
          {canCancel && (
            <CancelTournamentButton id={t.id} title={t.title} paidRegistrations={t.paidRegistrations} />
          )}
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Manual QA**

Run `npm run dev`, log in as admin, go to `/admin/tournaments`. Confirm:
- A tournament with status `registration_open`/`registration_closed`/`active` shows a red "Cancel tournament" button; `draft`/`completed` tournaments do not.
- Clicking it shows the confirm text with the correct paid-registration count for that tournament.
- Confirming flips the status to `cancelled` (visible in the row's status label) and the button disappears.
- As a moderator (non-admin), the button never appears.

- [ ] **Step 7: Commit**

```bash
git add lib/tournaments/admin-actions.ts components/admin/CancelTournamentButton.tsx app/admin/tournaments/page.tsx components/admin/TournamentListRow.tsx
git commit -m "feat: add cancelTournament admin action and UI"
```

---

### Task 5: `refundRegistration` server action

**Files:**
- Modify: `lib/tournaments/admin-actions.ts` (add after `cancelTournament`)

**Interfaces:**
- Consumes: `manualCreditWallet` from Task 2 (`lib/admin/wallet-actions.ts`).
- Produces (used by Task 6): `refundRegistration(_prev: RefundState, formData: FormData): Promise<RefundState>` reading `registrationId`, `tournamentId`, `playerId`, `amount`, `reason` from `FormData`. `export type RefundState = { error?: string; success?: boolean } | undefined`.

- [ ] **Step 1: Add the import and action to `lib/tournaments/admin-actions.ts`**

Add to the top imports:

```ts
import { manualCreditWallet } from '@/lib/admin/wallet-actions'
```

Append after `cancelTournament`:

```ts

export type RefundState = { error?: string; success?: boolean } | undefined

export async function refundRegistration(
  _prev: RefundState,
  formData: FormData,
): Promise<RefundState> {
  await requireAdmin()
  const registrationId = String(formData.get('registrationId') ?? '')
  const tournamentId = String(formData.get('tournamentId') ?? '')
  const playerId = String(formData.get('playerId') ?? '')
  const amount = Number(formData.get('amount'))
  const reason = String(formData.get('reason') ?? '')
  if (!registrationId || !playerId) return { error: 'Missing registration.' }
  if (!Number.isInteger(amount) || amount <= 0) return { error: 'Invalid refund amount.' }
  if (!reason.trim()) return { error: 'Missing refund reason.' }

  const supabase = createClient()

  // Atomic conditional update — same non-race pattern as waiver redemption.
  // If no row comes back, someone already refunded this registration.
  const { data: claimed } = await supabase
    .from('tournament_registrations')
    .update({ payment_status: 'refunded' })
    .eq('id', registrationId)
    .eq('payment_status', 'paid')
    .select('id')
  if (!claimed || claimed.length === 0) {
    return { error: 'This registration has already been refunded or is not paid.' }
  }

  const result = await manualCreditWallet(playerId, amount, reason.trim())
  if ('error' in result) {
    // Roll back the claim so the row is refundable again — a failed wallet
    // credit must never leave a registration marked refunded with no credit.
    await supabase.from('tournament_registrations').update({ payment_status: 'paid' }).eq('id', registrationId)
    return { error: `Refund could not be completed: ${result.error}` }
  }

  revalidatePath(`/admin/tournaments/${tournamentId}/registrations`)
  return { success: true }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/tournaments/admin-actions.ts
git commit -m "feat: add refundRegistration admin action"
```

---

### Task 6: Refund button UI on the registrations page

**Files:**
- Create: `components/admin/RefundButton.tsx`
- Modify: `components/admin/RegistrationsTable.tsx`
- Modify: `app/admin/tournaments/[id]/registrations/page.tsx`

**Interfaces:**
- Consumes: `refundRegistration`, `type RefundState` from Task 5. `formatNaira` from `lib/format.ts`.
- Produces: nothing consumed by later tasks — this is the last task in the cancellation/refund branch.

- [ ] **Step 1: Write `components/admin/RefundButton.tsx`**

```tsx
'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { refundRegistration, type RefundState } from '@/lib/tournaments/admin-actions'
import { formatNaira } from '@/lib/format'

export function RefundButton({
  registrationId,
  tournamentId,
  playerId,
  amount,
  reason,
}: {
  registrationId: string
  tournamentId: string
  playerId: string
  amount: number
  reason: string
}) {
  const [state, action] = useFormState<RefundState, FormData>(refundRegistration, undefined)
  const [confirming, setConfirming] = useState(false)

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs font-bold text-slate-300 hover:border-slate-500"
      >
        Refund
      </button>
    )
  }
  return (
    <form action={action} className="flex flex-col gap-1.5">
      <input type="hidden" name="registrationId" value={registrationId} />
      <input type="hidden" name="tournamentId" value={tournamentId} />
      <input type="hidden" name="playerId" value={playerId} />
      <input type="hidden" name="amount" value={amount} />
      <input type="hidden" name="reason" value={reason} />
      <p className="text-xs text-amber-400">Refund {formatNaira(amount)}?</p>
      <div className="flex gap-1.5">
        <button
          type="submit"
          className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-red-500"
        >
          Confirm
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs font-bold text-slate-300 hover:border-slate-500"
        >
          Cancel
        </button>
      </div>
      {state?.error && <p className="text-xs text-red-400">{state.error}</p>}
    </form>
  )
}
```

(No success-state handling needed: on success the registration's `payment_status` becomes `'refunded'` server-side; `RegistrationsTable`, edited next, renders "Refunded ✓" instead of this component once that happens — same principle as `WaiverRow` deriving its display from server data, not local state.)

- [ ] **Step 2: Extend `components/admin/RegistrationsTable.tsx`**

Add `playerId` to the row interface and add `tournamentId`/`tournamentStatus`/`registrationFee` props, plus a new "Refund" column. Replace the file's interface and component signature:

```tsx
'use client'
import { useState } from 'react'
import { matchesPlayerQuery } from '@/lib/admin/search'
import { PlayerSearch } from './PlayerSearch'
import { formatDateTime } from '@/lib/format'
import { RefundButton } from './RefundButton'

export interface AdminRegistrationRow {
  id: string
  playerId: string
  username: string | null
  regDisplayName: string | null
  regWhatsapp: string | null
  regClubName: string | null
  regIgnTag: string | null
  paymentStatus: string
  registeredAt: string
}

export function RegistrationsTable({
  rows,
  tournamentId,
  tournamentStatus,
  registrationFee,
}: {
  rows: AdminRegistrationRow[]
  tournamentId: string
  tournamentStatus: string
  registrationFee: number
}) {
  const [query, setQuery] = useState('')
  const filtered = rows.filter((r) =>
    matchesPlayerQuery(
      { username: r.username, displayName: r.regDisplayName, clubName: r.regClubName },
      query,
    ),
  )
  const showRefunds = tournamentStatus === 'cancelled'

  return (
    <div>
      <PlayerSearch value={query} onChange={setQuery} />
      {filtered.length === 0 ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center text-sm text-slate-500">
          No registrations match &quot;{query}&quot;.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-[11px] uppercase tracking-widest text-slate-500">
                <th className="px-3 py-2.5 text-left">Player</th>
                <th className="px-2 py-2.5 text-left">WhatsApp</th>
                <th className="px-2 py-2.5 text-left">Club</th>
                <th className="px-2 py-2.5 text-left">IGN / Tag</th>
                <th className="px-2 py-2.5 text-left">Payment</th>
                <th className="px-3 py-2.5 text-left">Registered</th>
                {showRefunds && <th className="px-3 py-2.5 text-left">Refund</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-b border-slate-800/50 last:border-0">
                  <td className="px-3 py-2.5 font-semibold text-white">
                    {r.regDisplayName ?? r.username ?? 'Unknown'}
                  </td>
                  <td className="px-2 py-2.5 text-slate-300">{r.regWhatsapp ?? '—'}</td>
                  <td className="px-2 py-2.5 text-slate-300">{r.regClubName ?? '—'}</td>
                  <td className="px-2 py-2.5 text-slate-300">{r.regIgnTag ?? '—'}</td>
                  <td className="px-2 py-2.5 capitalize text-slate-300">{r.paymentStatus}</td>
                  <td className="px-3 py-2.5 text-slate-400">{formatDateTime(r.registeredAt)}</td>
                  {showRefunds && (
                    <td className="px-3 py-2.5">
                      {r.paymentStatus === 'refunded' ? (
                        <span className="text-xs font-bold text-emerald-400">Refunded ✓</span>
                      ) : r.paymentStatus === 'paid' ? (
                        <RefundButton
                          registrationId={r.id}
                          tournamentId={tournamentId}
                          playerId={r.playerId}
                          amount={registrationFee}
                          reason="Season 2 registration refund"
                        />
                      ) : (
                        <span className="text-xs text-slate-600">—</span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Update `app/admin/tournaments/[id]/registrations/page.tsx`**

Select `status, registration_fee` on the tournament query and `player_id` on the registrations query, then pass the new props to `RegistrationsTable`.

Change the tournament fetch (line 20-24):

```ts
  const { data: t } = await supabase
    .from('tournaments')
    .select('id, title, status, registration_fee')
    .eq('id', params.id)
    .maybeSingle()
```

Change the registrations select (line 30-33) to include `player_id`:

```ts
      .select(
        'id, player_id, payment_status, registered_at, reg_display_name, reg_whatsapp, reg_club_name, reg_ign_tag, profiles(username)',
      )
```

Update the row-mapping type cast and returned object (lines 42-63) to carry `playerId`:

```ts
  const rows: AdminRegistrationRow[] = ((data as unknown[] | null) ?? []).map((raw) => {
    const r = raw as {
      id: string
      player_id: string
      payment_status: string
      registered_at: string
      reg_display_name: string | null
      reg_whatsapp: string | null
      reg_club_name: string | null
      reg_ign_tag: string | null
      profiles: ProfileRef
    }
    return {
      id: r.id,
      playerId: r.player_id,
      username: firstUsername(r.profiles),
      regDisplayName: r.reg_display_name,
      regWhatsapp: r.reg_whatsapp,
      regClubName: r.reg_club_name,
      regIgnTag: r.reg_ign_tag,
      paymentStatus: r.payment_status,
      registeredAt: r.registered_at,
    }
  })
```

Update the render call (line 107):

```tsx
        <RegistrationsTable
          rows={rows}
          tournamentId={t.id}
          tournamentStatus={t.status}
          registrationFee={t.registration_fee}
        />
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual QA**

Using the tournament cancelled in Task 4's QA (or cancel a fresh test tournament with at least one paid registration):
- Visit its `/admin/tournaments/[id]/registrations` page. Confirm a "Refund" column now appears, pre-filled amount matching the tournament's registration fee, reason "Season 2 registration refund" (visible once you click "Refund" to expand the confirm step).
- Confirming credits the player's wallet (check `/admin/wallet`'s list balance increases) and flips the row to "Refunded ✓".
- Re-visiting the page after a refund shows "Refunded ✓" persists (derived from `payment_status`, not client state).
- On a tournament that is not cancelled, the Refund column does not appear at all.

- [ ] **Step 6: Commit**

```bash
git add components/admin/RefundButton.tsx components/admin/RegistrationsTable.tsx "app/admin/tournaments/[id]/registrations/page.tsx"
git commit -m "feat: add per-registration refund button for cancelled tournaments"
```

---

### Task 7: Zero-fee registration — server action branch

**Files:**
- Modify: `lib/tournaments/actions.ts`

**Interfaces:**
- Consumes: nothing new — uses the existing `admin`, `regFields`, `existing`, `tournament`, `tournamentId`, `user` locals already in scope in `registerForTournament`.
- Produces: no new exports; behavior change only (used by Task 8's UI wording, which does not import anything from here).

- [ ] **Step 1: Add the zero-fee branch to `lib/tournaments/actions.ts`**

Insert immediately after the waiver block's closing `redirect(...)` and `}` (after line 132, before the comment on line 134):

```ts

  // A zero-fee tournament (e.g. a free community event) needs no payment at
  // all. This is distinct from a waiver, which comps an existing fee for one
  // specific player — a ₦0 tournament has no fee to waive, so fee_waived
  // stays false and this never touches tournament_fee_waivers.
  if (tournament.registration_fee === 0) {
    const freeRegRow = {
      tournament_id: tournamentId,
      player_id: user.id,
      payment_status: 'paid',
      fee_waived: false,
      paystack_reference: null,
      ...regFields,
    }
    if (!existing) {
      const { error: insertErr } = await admin.from('tournament_registrations').insert(freeRegRow)
      if (insertErr) return { error: 'Could not complete registration. Please try again.' }
    } else {
      await admin
        .from('tournament_registrations')
        .update({ payment_status: 'paid', fee_waived: false, paystack_reference: null, ...regFields })
        .eq('id', existing.id)
    }

    redirect(`/tournaments/${tournament.slug}?paid=1`)
  }
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual QA**

Create a test tournament (or edit one) with `registrationFee: 0` and status `registration_open`. Log in as a player, visit its page, submit the registration form. Confirm:
- No redirect to Paystack occurs.
- The player lands on `/tournaments/[slug]?paid=1` immediately.
- The registration row in `/admin/tournaments/[id]/registrations` shows `payment_status = paid` and, if you inspect the DB row, `fee_waived = false`.
- Submitting again (re-registering) is blocked by the existing `checkCanRegister` "already registered" guard, same as any paid tournament.

- [ ] **Step 4: Commit**

```bash
git add lib/tournaments/actions.ts
git commit -m "feat: skip Paystack for zero-fee tournament registration"
```

---

### Task 8: Zero-fee registration — UI wording

**Files:**
- Modify: `components/tournament/RegistrationPanel.tsx`

**Interfaces:**
- Consumes: the `fee: number` prop already passed into `RegistrationPanel` and `RegisterForm`.
- Produces: nothing consumed elsewhere — final task.

- [ ] **Step 1: Update the `guest` view's label (around line 50)**

Replace:
```tsx
          Register — {formatNaira(fee)}
```
with:
```tsx
          {fee === 0 ? 'Register — Free' : `Register — ${formatNaira(fee)}`}
```

- [ ] **Step 2: Update the `can_register`/`complete_payment` view's label and subtext (around lines 64-70)**

Replace:
```tsx
          label={
            view === 'complete_payment' ? 'Complete payment →' : `Register — ${formatNaira(fee)}`
          }
        />
        <p className="mt-2 text-center text-xs text-slate-500">
          Secure payment via Paystack. Entry fee {formatNaira(fee)}.
        </p>
```
with:
```tsx
          label={
            view === 'complete_payment'
              ? 'Complete payment →'
              : fee === 0
                ? 'Register — Free'
                : `Register — ${formatNaira(fee)}`
          }
        />
        <p className="mt-2 text-center text-xs text-slate-500">
          {fee === 0 ? 'Free entry — no payment required.' : `Secure payment via Paystack. Entry fee ${formatNaira(fee)}.`}
        </p>
```

- [ ] **Step 3: Update the submit button's pending label in `RegisterForm` (line 156)**

`RegisterForm` needs the `fee` value to pick the right pending label — add a `fee` prop. Change the function signature (around line 119):

```tsx
function RegisterForm({
  tournamentId,
  label,
  fee,
  prefill,
  hasRules,
}: {
  tournamentId: string
  label: string
  fee: number
  prefill: { displayName: string; whatsapp: string }
  hasRules: boolean
}) {
```

Update its call site inside `RegistrationPanel` (around line 60) to pass `fee={fee}`:

```tsx
        <RegisterForm
          tournamentId={tournamentId}
          fee={fee}
          prefill={prefill}
          hasRules={hasRules}
          label={
```

Update the `SubmitButton` call (line 156):

```tsx
          <SubmitButton label={label} pendingLabel={fee === 0 ? 'Registering…' : 'Redirecting to payment…'} />
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual QA**

On the same `registrationFee: 0` test tournament from Task 7:
- The registration panel shows "Register — Free" (not "Register — ₦0").
- Subtext reads "Free entry — no payment required."
- Submitting shows "Registering…" while pending, not "Redirecting to payment…".
- On a normal paid tournament, all wording is unchanged from before this task.

- [ ] **Step 6: Commit**

```bash
git add components/tournament/RegistrationPanel.tsx
git commit -m "feat: show free-entry wording for zero-fee tournament registration"
```

---

## Self-Review

**Spec coverage:**
- Admin wallet view listing all wallets (balance, name, username, last-updated) — Task 3. ✓
- `manualCreditWallet(playerId, amount, reason)` via `creditWallet()`, logging `wallet_transactions.note`, handling players with no existing wallet row — Task 2 (delegates to `creditWallet`'s existing lazy upsert). ✓
- Two-step confirm on the credit form — Task 3. ✓
- Refund button on cancelled tournaments' registrations, pre-filled amount/reason, tracked via `payment_status`, "Refunded ✓" display — Task 6 (built on Tasks 4/5 which add the cancellation state this depends on). ✓
- Zero-fee registration skipping Paystack, `payment_status: 'paid'`, `paystack_reference: null` — Task 7. ✓
- UI not showing a Paystack step for free tournaments — Task 8. ✓
- Migration — Task 1 (only the tournaments status constraint; `wallet_transactions.note` and the `refunded`/`admin_credit`/`prize` values already existed, so no migration work was needed for those, per the design doc). ✓
- Prize crediting for free tournaments (`type: 'prize'`, ₦5,000, "Community tournament winner") — covered by Task 2's `manualCreditWallet(..., type)` parameter and Task 3's UI (admin just fills the existing form fields; no dedicated "prize" UI needed since the form is generic). ✓

**Placeholder scan:** No TBD/TODO; every step has complete code.

**Type consistency:** `ManualCreditFormState`/`ManualCreditResult` (Task 2) match their use in Task 3. `TournamentFormState` (existing, Task 4) reused as-is for `cancelTournament`. `RefundState` (Task 5) matches Task 6's `RefundButton` import. `AdminRegistrationRow.playerId` (Task 6) matches the `player_id` select added in the same task. `AdminTournamentRow.paidRegistrations` (Task 4) is produced and consumed within the same task. `RegisterForm`'s new `fee` prop (Task 8) is added and wired at its only call site in the same task.
