# Wallet Page Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the thin `/dashboard/wallet` page (built in the HexAvatar/Dashboard/Hall-of-Fame plan, Task B13) with the full multi-page wallet section from `docs/superpowers/specs/2026-08-15-wallet-page-design.md`, reconciled against the real schema.

**Architecture:** A `layout.tsx` with sidebar/tab-bar nav wraps five routes under `app/dashboard/wallet/`. All data comes from tables that already exist (`wallets`, `wallet_transactions`, `withdrawal_requests`, `wallet_deposits`, `player_kyc`, `profiles.kyc_verified`) — no migration needed. Every server action needed already exists (`requestWalletWithdrawal`, `initiateWalletDeposit`, `submitKyc`) except one small new one (self-service payout-account removal).

**Tech Stack:** Next.js 14 App Router (Server Components by default), TypeScript, Tailwind, Supabase, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-15-wallet-page-design.md` — read alongside this plan; every deviation from it is called out below with the real reason.

## Global Constraints

- **This spec was written without checking the real schema** (same class of gap as the other three specs in the earlier plan). Concrete corrections, all confirmed by reading the actual migrations/`lib/wallet/*`/`lib/kyc/*` code in this worktree:
  - `wallet_transactions` **does exist** (migration 024, extended in 044/054) with `type`, `category`, `amount`, `reference_id`, `note`, `created_at` — the spec assumed it might not. Categories: `'tournament_prize' | 'referral' | 'community' | 'bonus' | 'withdrawal' | 'entry_fee' | 'refund'`.
  - There is **no `wallet_transactions.status` column** — it's an append-only ledger, always "already happened." Only `type IN ('withdrawal_request', 'withdrawal_reversal')` rows have a real pending/resolved state, and that state lives on `withdrawal_requests` (joined via `wallet_transactions.reference_id = withdrawal_requests.id`). Every other row is "completed" the moment it exists.
  - **Deposits are already live**, not "Phase 3+ locked" as the spec assumes — `wallet_deposits` + `initiateWalletDeposit` (`lib/wallet/deposit.ts`) + the existing `FundWalletForm` in `WalletPanel.tsx` are a working Paystack top-up flow today. Ship `/dashboard/wallet/deposit` as **live**, and the Deposit quick-action/nav item as **live**, not locked — hiding a shipped feature behind a fake lock is a regression.
  - **Referral Rewards are already live**, not locked — `lib/referrals/credit.ts` calls `creditWallet(admin, referrerId, REFERRAL_CREDIT_NGN, 'referral', referral.id)` today. Show the real total, not "Coming Soon."
  - `profiles.kyc_verified` **does exist** (set by `submitKyc`/`resetKycForPlayer` in `lib/kyc/actions.ts`) — the spec correctly names it, just wasn't sure it existed.
  - There is **no `player_bank_accounts` table** — a player has exactly one payout account, stored directly on `player_kyc` (`payout_bank_name`, `payout_account_number`, `payout_account_name`, `payout_bank_code`). "Payment Methods" manages that single row, not a list.
  - **"Available Balance = Total − Pending" is wrong for this system.** `debitWallet` (in `requestWalletWithdrawal`) subtracts a withdrawal's amount from `wallets.balance` **immediately** on request, not on payout — so `wallets.balance` already excludes any pending withdrawal. Subtracting pending again would double-count. The Balance Hero Card shows `wallets.balance` as the one real number, with a secondary "⏳ ₦X pending — processed within 24h" line only when a pending `withdrawal_requests` row exists.
  - **Minimum amounts are ₦100, not ₦1,000/₦1,000** — `lib/wallet/schema.ts`'s `walletWithdrawalSchema`/`walletDepositSchema` both enforce a ₦100 floor. Copy must match the schema exactly (a mismatched minimum in the UI is a real bug, not a style choice).
- **No toast library exists in this project** (`grep` for `sonner`/`react-hot-toast` in `package.json` found nothing). Do not add one for this feature. "Locked" quick-actions/nav items render as visually-styled-but-inert (`aria-disabled`, `pointer-events-none`, a `title` tooltip reading "Coming in a future update") — the same pattern this codebase already uses for disabled pagination controls (`app/(public)/tournaments/page.tsx`).
- Reuse, never re-derive: `requestWalletWithdrawal`/`getWalletBalance`/`debitWallet`/`creditWallet` (`lib/wallet/*`), `initiateWalletDeposit` (`lib/wallet/deposit.ts`), `submitKyc`/`resolveAccountName`/`resetKycForPlayer` (`lib/kyc/actions.ts`), `KycForm.tsx`, `kycPanelMode`/`maskAccountNumber` (`lib/kyc/logic.ts`), `computeTier`/`TIER_XP_THRESHOLDS` (`lib/membership/tiers.ts`), `xpToNextTierLabel` (`lib/dashboard/command-centre.ts`), `listBanks` (`lib/paystack/server.ts`), `formatNaira`/`formatDateTime` (`lib/format.ts`), the `?page=` pagination convention from `app/(public)/tournaments/page.tsx`.
- **Retire** (superseded, no other callers — confirmed via repo-wide grep): `components/dashboard/WalletPanel.tsx`, `components/dashboard/EarningsBreakdownPanel.tsx`. **Keep and reuse**: `components/dashboard/KycForm.tsx` (still exactly right for Payment Methods), `lib/wallet/breakdown.ts`'s `summarizeEarningsByCategory` (already unit-tested pure logic).
- `app/dashboard/page.tsx`'s `QuickActions` "Withdraw Prize" tile already links to `/dashboard/wallet` — no change needed there; it still lands on the new Overview page.
- Mobile-first throughout; sidebar nav collapses to a horizontal scrollable tab bar below `sm:`, matching the existing `scrollbar-hide` utility already in `app/globals.css`.

---

### Task W1: `lib/wallet/nav.ts` — sidebar/tab-bar nav model

**Files:**
- Create: `lib/wallet/nav.ts`
- Test: `lib/wallet/nav.test.ts`

**Interfaces:**
- Produces: `WalletNavItem`, `WALLET_NAV_ITEMS: WalletNavItem[]` — consumed by W9 (`WalletSidebar`).

- [ ] **Step 1: Write the failing test**

```ts
// lib/wallet/nav.test.ts
import { describe, it, expect } from 'vitest'
import { WALLET_NAV_ITEMS } from './nav'

describe('WALLET_NAV_ITEMS', () => {
  it('marks deposit and referrals correctly (deposit live, referrals locked)', () => {
    const deposit = WALLET_NAV_ITEMS.find((i) => i.href === '/dashboard/wallet/deposit')
    const referrals = WALLET_NAV_ITEMS.find((i) => i.href === '/dashboard/wallet/referrals')
    expect(deposit?.locked).toBe(false)
    expect(referrals?.locked).toBe(true)
  })
  it('every item has a unique href', () => {
    const hrefs = WALLET_NAV_ITEMS.map((i) => i.href)
    expect(new Set(hrefs).size).toBe(hrefs.length)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/wallet/nav.test.ts`
Expected: FAIL — `Cannot find module './nav'`

- [ ] **Step 3: Write the implementation**

```ts
// lib/wallet/nav.ts
// Wallet section nav — spec §2, corrected: Deposit is live (see plan's
// Global Constraints), not Phase 3+.
export interface WalletNavItem {
  label: string
  href: string
  locked: boolean
}

export const WALLET_NAV_ITEMS: WalletNavItem[] = [
  { label: 'Overview', href: '/dashboard/wallet', locked: false },
  { label: 'Transactions', href: '/dashboard/wallet/transactions', locked: false },
  { label: 'Deposit', href: '/dashboard/wallet/deposit', locked: false },
  { label: 'Withdraw', href: '/dashboard/wallet/withdraw', locked: false },
  { label: 'Payment Methods', href: '/dashboard/wallet/payment-methods', locked: false },
  { label: 'Transfer', href: '/dashboard/wallet/transfer', locked: true },
  { label: 'Rewards', href: '/dashboard/wallet/rewards', locked: true },
  { label: 'Referrals', href: '/dashboard/wallet/referrals', locked: true },
]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/wallet/nav.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/wallet/nav.ts lib/wallet/nav.test.ts
git commit -m "feat(wallet): add wallet section nav model"
```

---

### Task W2: `lib/wallet/transactions.ts` — transaction display mapping

**Files:**
- Create: `lib/wallet/transactions.ts`
- Test: `lib/wallet/transactions.test.ts`

**Interfaces:**
- Produces: `WalletTxnDisplayStatus`, `RawWalletTxnRow`, `WalletTxnRow`, `mapTransactionRows(rows, withdrawalStatusByRequestId): WalletTxnRow[]` — consumed by W6 (`TransactionRow`/`RecentTransactionsList`), W12 (overview page), W13 (transactions page).

- [ ] **Step 1: Write the failing test**

```ts
// lib/wallet/transactions.test.ts
import { describe, it, expect } from 'vitest'
import { mapTransactionRows, type RawWalletTxnRow } from './transactions'

describe('mapTransactionRows', () => {
  it('is always completed for a non-withdrawal type', () => {
    const row: RawWalletTxnRow = {
      id: 't1', type: 'prize', category: 'tournament_prize', amount: 5000,
      reference_id: null, note: null, created_at: '2026-07-20T00:00:00Z',
    }
    expect(mapTransactionRows([row], new Map())[0].status).toBe('completed')
  })

  it('derives status from the matching withdrawal_requests row for a withdrawal_request type', () => {
    const row: RawWalletTxnRow = {
      id: 't2', type: 'withdrawal_request', category: 'withdrawal', amount: -3000,
      reference_id: 'wr1', note: null, created_at: '2026-07-18T00:00:00Z',
    }
    const byId = new Map([['wr1', 'pending']])
    expect(mapTransactionRows([row], byId)[0].status).toBe('pending')
  })

  it('maps a rejected withdrawal_requests status to failed', () => {
    const row: RawWalletTxnRow = {
      id: 't3', type: 'withdrawal_request', category: 'withdrawal', amount: -3000,
      reference_id: 'wr2', note: null, created_at: '2026-07-18T00:00:00Z',
    }
    const byId = new Map([['wr2', 'rejected']])
    expect(mapTransactionRows([row], byId)[0].status).toBe('failed')
  })

  it('a withdrawal_reversal is always completed (the reversal already happened)', () => {
    const row: RawWalletTxnRow = {
      id: 't4', type: 'withdrawal_reversal', category: 'withdrawal', amount: 3000,
      reference_id: 'wr2', note: null, created_at: '2026-07-19T00:00:00Z',
    }
    expect(mapTransactionRows([row], new Map([['wr2', 'rejected']]))[0].status).toBe('completed')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/wallet/transactions.test.ts`
Expected: FAIL — `Cannot find module './transactions'`

- [ ] **Step 3: Write the implementation**

```ts
// lib/wallet/transactions.ts
export type WalletTxnDisplayStatus = 'completed' | 'pending' | 'failed'

export interface RawWalletTxnRow {
  id: string
  type: string
  category: string | null
  amount: number
  reference_id: string | null
  note: string | null
  created_at: string
}

export interface WalletTxnRow {
  id: string
  type: string
  category: string | null
  amount: number
  createdAt: string
  status: WalletTxnDisplayStatus
}

const WITHDRAWAL_REQUEST_STATUS_TO_DISPLAY: Record<string, WalletTxnDisplayStatus> = {
  pending: 'pending',
  paid: 'completed',
  rejected: 'failed',
}

// wallet_transactions is an append-only ledger with no status column of its
// own (see plan Global Constraints) — every row is "completed" except a
// 'withdrawal_request' row, whose real status lives on the withdrawal_requests
// row it references. A 'withdrawal_reversal' row represents money already
// credited back, so it's always completed regardless of the original
// request's final status.
export function mapTransactionRows(
  rows: RawWalletTxnRow[],
  withdrawalRequestStatusById: Map<string, string>,
): WalletTxnRow[] {
  return rows.map((r) => {
    let status: WalletTxnDisplayStatus = 'completed'
    if (r.type === 'withdrawal_request' && r.reference_id) {
      const wrStatus = withdrawalRequestStatusById.get(r.reference_id)
      status = wrStatus ? WITHDRAWAL_REQUEST_STATUS_TO_DISPLAY[wrStatus] ?? 'completed' : 'completed'
    }
    return {
      id: r.id, type: r.type, category: r.category, amount: r.amount,
      createdAt: r.created_at, status,
    }
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/wallet/transactions.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/wallet/transactions.ts lib/wallet/transactions.test.ts
git commit -m "feat(wallet): add transaction status derivation"
```

---

### Task W3: `lib/wallet/earnings-trend.ts` — real month-over-month % change

**Files:**
- Create: `lib/wallet/earnings-trend.ts`
- Test: `lib/wallet/earnings-trend.test.ts`

**Interfaces:**
- Produces: `monthOverMonthChange(rows, category, now): number | null` — consumed by W7 (`EarningsOverview`).

- [ ] **Step 1: Write the failing test**

```ts
// lib/wallet/earnings-trend.test.ts
import { describe, it, expect } from 'vitest'
import { monthOverMonthChange } from './earnings-trend'
import type { RawWalletTxnRow } from './transactions'

function txn(overrides: Partial<RawWalletTxnRow>): RawWalletTxnRow {
  return { id: 'x', type: 'prize', category: 'tournament_prize', amount: 1000, reference_id: null, note: null, created_at: '2026-08-01T00:00:00Z', ...overrides }
}
const NOW = new Date('2026-08-15T00:00:00Z')

describe('monthOverMonthChange', () => {
  it('computes percent change vs the prior calendar month for the given category', () => {
    const rows = [
      txn({ id: 'a', amount: 5000, created_at: '2026-08-05T00:00:00Z' }), // this month
      txn({ id: 'b', amount: 4000, created_at: '2026-07-05T00:00:00Z' }), // last month
    ]
    expect(monthOverMonthChange(rows, 'tournament_prize', NOW)).toBe(25)
  })
  it('is null when there is no data for the prior month (nothing to compare against)', () => {
    const rows = [txn({ id: 'a', amount: 5000, created_at: '2026-08-05T00:00:00Z' })]
    expect(monthOverMonthChange(rows, 'tournament_prize', NOW)).toBeNull()
  })
  it('ignores other categories', () => {
    const rows = [
      txn({ id: 'a', category: 'referral', amount: 5000, created_at: '2026-08-05T00:00:00Z' }),
      txn({ id: 'b', category: 'referral', amount: 4000, created_at: '2026-07-05T00:00:00Z' }),
    ]
    expect(monthOverMonthChange(rows, 'tournament_prize', NOW)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/wallet/earnings-trend.test.ts`
Expected: FAIL — `Cannot find module './earnings-trend'`

- [ ] **Step 3: Write the implementation**

```ts
// lib/wallet/earnings-trend.ts
import type { RawWalletTxnRow } from './transactions'

// "Total Earned +18%" on the Tournament Winnings card — spec §3.4, scoped
// (per the spec's own wording) to tournament winnings only. Real data only:
// returns null rather than a fabricated 0%/∞% when there's nothing to
// compare against.
export function monthOverMonthChange(rows: RawWalletTxnRow[], category: string, now: Date): number | null {
  const thisMonthKey = `${now.getUTCFullYear()}-${now.getUTCMonth()}`
  const lastMonthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  const lastMonthKey = `${lastMonthDate.getUTCFullYear()}-${lastMonthDate.getUTCMonth()}`

  let thisMonthTotal = 0
  let lastMonthTotal = 0
  for (const r of rows) {
    if (r.category !== category || r.amount <= 0) continue
    const d = new Date(r.created_at)
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`
    if (key === thisMonthKey) thisMonthTotal += r.amount
    else if (key === lastMonthKey) lastMonthTotal += r.amount
  }

  if (lastMonthTotal === 0) return null
  return Math.round(((thisMonthTotal - lastMonthTotal) / lastMonthTotal) * 100)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/wallet/earnings-trend.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/wallet/earnings-trend.ts lib/wallet/earnings-trend.test.ts
git commit -m "feat(wallet): add real month-over-month earnings trend"
```

---

### Task W4: `removePayoutAccount` self-service action

**Files:**
- Modify: `lib/kyc/actions.ts`

**Interfaces:**
- Produces: `removePayoutAccount(): Promise<{ error?: string; success?: boolean }>` — consumed by W16 (Payment Methods page).

- [ ] **Step 1: Add the action**

Append to `lib/kyc/actions.ts`, after `resetKycForPlayer` (mirrors it exactly, but self-scoped — a player removing their own account, not an admin support lever):

```ts
// Player-initiated equivalent of resetKycForPlayer — lets a player clear
// their own payout account (e.g. switching banks) and go back through
// submitKyc to re-add one. withdrawal_requests already snapshots its own
// bank_name/account_number/account_name at request time (see migration
// 024), so removing player_kyc here never corrupts an already-submitted
// pending request.
export async function removePayoutAccount(): Promise<{ error?: string; success?: boolean }> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const admin = createAdminClient()
  const { error } = await admin.from('player_kyc').delete().eq('player_id', user.id)
  if (error) return { error: 'Could not remove your payout account. Please try again.' }
  await admin.from('profiles').update({ kyc_verified: false }).eq('id', user.id)

  revalidatePath('/dashboard/wallet/payment-methods')
  return { success: true }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/kyc/actions.ts
git commit -m "feat(wallet): add player-scoped removePayoutAccount action"
```

---

### Task W5: `components/wallet/BalanceHeroCard.tsx`

**Files:**
- Create: `components/wallet/BalanceHeroCard.tsx`

**Interfaces:**
- Consumes: `formatNaira` (`lib/format.ts`).
- Produces: `BalanceHeroCard` — consumed by W12 (overview page).

- [ ] **Step 1: Write the component**

```tsx
// components/wallet/BalanceHeroCard.tsx
'use client'
import { useState } from 'react'
import { formatNaira } from '@/lib/format'

// Balance = wallets.balance directly — already net of any pending
// withdrawal debit (debitWallet subtracts at request time, not at payout).
// See plan Global Constraints for why this isn't "Total − Pending".
export function BalanceHeroCard({ balance, pendingWithdrawal }: { balance: number; pendingWithdrawal: number }) {
  const [hidden, setHidden] = useState(false)
  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-sx-purple/50 bg-gradient-to-r from-sx-purple/30 via-sx-surface to-sx-purple/10 p-6"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-6 -bottom-6 h-40 w-40 rounded-full bg-sx-purple/20 blur-[60px]"
      />
      <div className="relative flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-widest text-sx-gray">Total Balance</p>
        <button
          type="button"
          onClick={() => setHidden((h) => !h)}
          className="text-sx-gray hover:text-white"
          aria-label={hidden ? 'Show balance' : 'Hide balance'}
        >
          {hidden ? '🙈' : '👁'}
        </button>
      </div>
      <p className="relative mt-1 font-display text-5xl font-black text-white">
        {hidden ? '••••••' : formatNaira(balance)}
      </p>
      <span className="relative mt-2 inline-block rounded-full border border-emerald-500/30 bg-emerald-500/20 px-2.5 py-0.5 text-[11px] font-bold text-emerald-400">
        Available Balance
      </span>
      {pendingWithdrawal > 0 && (
        <p className="relative mt-2 text-sm text-amber-400">
          ⏳ {formatNaira(pendingWithdrawal)} pending withdrawal — processed within 24 hours
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/wallet/BalanceHeroCard.tsx
git commit -m "feat(wallet): add BalanceHeroCard"
```

---

### Task W6: `components/wallet/TransactionRow.tsx` + `RecentTransactionsList.tsx`

**Files:**
- Create: `components/wallet/TransactionRow.tsx`
- Create: `components/wallet/RecentTransactionsList.tsx`

**Interfaces:**
- Consumes: `WalletTxnRow` (W2), `formatDateTime`/`formatNaira` (`lib/format.ts`).
- Produces: `TransactionRow`, `RecentTransactionsList` — consumed by W12 (overview) and W13 (transactions page).

- [ ] **Step 1: Write `TransactionRow.tsx`**

```tsx
// components/wallet/TransactionRow.tsx
import { formatDateTime, formatNaira } from '@/lib/format'
import type { WalletTxnRow } from '@/lib/wallet/transactions'

const CATEGORY_ICON: Record<string, string> = {
  tournament_prize: '🏆',
  referral: '👥',
  community: '🎁',
  bonus: '💰',
  withdrawal: '⬆',
  entry_fee: '🎫',
  refund: '↩',
}
const CATEGORY_LABEL: Record<string, string> = {
  tournament_prize: 'Tournament Winnings',
  referral: 'Referral Reward',
  community: 'Community Reward',
  bonus: 'Bonus',
  withdrawal: 'Withdrawal',
  entry_fee: 'Entry Fee',
  refund: 'Refund',
}
const STATUS_ICON: Record<WalletTxnRow['status'], string> = { completed: '✅', pending: '⏳', failed: '❌' }

export function TransactionRow({ txn }: { txn: WalletTxnRow }) {
  const label = txn.type === 'deposit' ? 'Wallet Top-up' : CATEGORY_LABEL[txn.category ?? ''] ?? 'Transaction'
  const icon = txn.type === 'deposit' ? '⬇' : CATEGORY_ICON[txn.category ?? ''] ?? '💳'
  const isCredit = txn.amount > 0
  return (
    <div className="flex items-center gap-3 py-2.5 text-sm">
      <span className="text-lg">{icon}</span>
      <p className="min-w-0 flex-1 truncate text-white">{label}</p>
      <p className="shrink-0 text-xs text-sx-gray">{formatDateTime(txn.createdAt)}</p>
      <span className="shrink-0">{STATUS_ICON[txn.status]}</span>
      <p className={`shrink-0 font-bold ${isCredit ? 'text-emerald-400' : 'text-red-400'}`}>
        {isCredit ? '+' : ''}
        {formatNaira(txn.amount)}
      </p>
    </div>
  )
}
```

- [ ] **Step 2: Write `RecentTransactionsList.tsx`**

```tsx
// components/wallet/RecentTransactionsList.tsx
import Link from 'next/link'
import { TransactionRow } from './TransactionRow'
import type { WalletTxnRow } from '@/lib/wallet/transactions'

export function RecentTransactionsList({ transactions }: { transactions: WalletTxnRow[] }) {
  return (
    <section className="rounded-2xl border border-sx-border bg-sx-surface p-5">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wide text-white">Recent Transactions</h2>
        <Link href="/dashboard/wallet/transactions" className="text-xs font-semibold text-sx-purple-text hover:text-sx-purple-light">
          View All →
        </Link>
      </div>
      {transactions.length === 0 ? (
        <p className="text-sm text-sx-gray">No transactions yet — your history will appear here.</p>
      ) : (
        <div className="divide-y divide-sx-border">
          {transactions.map((t) => (
            <TransactionRow key={t.id} txn={t} />
          ))}
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/wallet/TransactionRow.tsx components/wallet/RecentTransactionsList.tsx
git commit -m "feat(wallet): add TransactionRow and RecentTransactionsList"
```

---

### Task W7: `components/wallet/EarningsOverview.tsx`

**Files:**
- Create: `components/wallet/EarningsOverview.tsx`

**Interfaces:**
- Consumes: `formatNaira` (`lib/format.ts`).
- Produces: `EarningsOverview` — consumed by W12.

- [ ] **Step 1: Write the component**

```tsx
// components/wallet/EarningsOverview.tsx
import Link from 'next/link'
import { formatNaira } from '@/lib/format'

interface EarningCard {
  key: string
  icon: string
  label: string
  amount: number
  locked: boolean
  trendPct: number | null
}

// Referral is live (see plan Global Constraints) — only 'community' has no
// real data source yet.
export function EarningsOverview({
  tournamentPrize,
  tournamentPrizeTrendPct,
  referral,
  bonus,
}: {
  tournamentPrize: number
  tournamentPrizeTrendPct: number | null
  referral: number
  bonus: number
}) {
  const cards: EarningCard[] = [
    { key: 'tournament_prize', icon: '🏆', label: 'Tournament Winnings', amount: tournamentPrize, locked: false, trendPct: tournamentPrizeTrendPct },
    { key: 'referral', icon: '👥', label: 'Referral Rewards', amount: referral, locked: false, trendPct: null },
    { key: 'community', icon: '🎁', label: 'Community Rewards', amount: 0, locked: true, trendPct: null },
    { key: 'bonus', icon: '💰', label: 'Cashback / Bonuses', amount: bonus, locked: false, trendPct: null },
  ]

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wide text-white">Earnings Overview</h2>
        <Link href="/dashboard/wallet/transactions" className="text-xs font-semibold text-sx-purple-text hover:text-sx-purple-light">
          View Earnings History →
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cards.map((c) => (
          <div key={c.key} className={`rounded-xl border border-sx-border bg-sx-surface p-4 ${c.locked ? 'opacity-50' : ''}`}>
            <p className="text-lg">{c.icon}</p>
            <p className="mt-1 font-display text-xl font-black text-white">{c.locked ? '—' : formatNaira(c.amount)}</p>
            <p className="text-xs text-sx-gray">{c.label}</p>
            {c.locked ? (
              <p className="mt-1 text-[11px] font-semibold text-sx-gray">Coming Soon</p>
            ) : c.trendPct != null ? (
              <p className={`mt-1 text-[11px] font-semibold ${c.trendPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {c.trendPct >= 0 ? '+' : ''}
                {c.trendPct}% vs last month
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/wallet/EarningsOverview.tsx
git commit -m "feat(wallet): add EarningsOverview"
```

---

### Task W8: `components/wallet/QuickActionsRow.tsx`

**Files:**
- Create: `components/wallet/QuickActionsRow.tsx`

**Interfaces:**
- Produces: `QuickActionsRow` — consumed by W12.

- [ ] **Step 1: Write the component**

```tsx
// components/wallet/QuickActionsRow.tsx
import Link from 'next/link'

// Deposit is live (see plan Global Constraints) — only Transfer and Rewards
// have no backing feature yet.
const ACTIONS = [
  { label: 'Deposit', icon: '⬇', href: '/dashboard/wallet/deposit', locked: false },
  { label: 'Withdraw', icon: '⬆', href: '/dashboard/wallet/withdraw', locked: false },
  { label: 'Transfer', icon: '↔', href: '/dashboard/wallet/transfer', locked: true },
  { label: 'Rewards', icon: '🎁', href: '/dashboard/wallet/rewards', locked: true },
]

export function QuickActionsRow() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {ACTIONS.map((a) =>
        a.locked ? (
          <span
            key={a.label}
            aria-disabled
            title="Coming in a future update"
            className="flex cursor-not-allowed flex-col items-center gap-1 rounded-xl bg-sx-surface px-3 py-4 text-center opacity-60"
          >
            <span className="text-xl">🔒</span>
            <span className="text-xs font-semibold text-white">{a.label}</span>
          </span>
        ) : (
          <Link
            key={a.label}
            href={a.href}
            className="flex flex-col items-center gap-1 rounded-xl bg-sx-surface px-3 py-4 text-center transition-colors hover:bg-sx-purple/20"
          >
            <span className="text-xl text-sx-purple-text">{a.icon}</span>
            <span className="text-xs font-semibold text-white">{a.label}</span>
          </Link>
        ),
      )}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/wallet/QuickActionsRow.tsx
git commit -m "feat(wallet): add QuickActionsRow"
```

---

### Task W9: `components/wallet/WalletSidebar.tsx`

**Files:**
- Create: `components/wallet/WalletSidebar.tsx`

**Interfaces:**
- Consumes: `WALLET_NAV_ITEMS` (W1).
- Produces: `WalletSidebar` — consumed by W11 (`layout.tsx`).

- [ ] **Step 1: Write the component**

```tsx
// components/wallet/WalletSidebar.tsx
'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { WALLET_NAV_ITEMS } from '@/lib/wallet/nav'

// Needs 'use client' for usePathname to highlight the active tab — the only
// client component in the wallet section besides BalanceHeroCard's toggle.
export function WalletSidebar() {
  const pathname = usePathname()
  return (
    <nav className="flex gap-2 overflow-x-auto scrollbar-hide sm:w-48 sm:shrink-0 sm:flex-col sm:gap-1">
      {WALLET_NAV_ITEMS.map((item) => {
        const active = pathname === item.href
        if (item.locked) {
          return (
            <span
              key={item.href}
              aria-disabled
              title="Coming in a future update"
              className="shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-sm text-sx-gray opacity-50"
            >
              🔒 {item.label}
            </span>
          )
        }
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
              active ? 'bg-sx-purple/20 text-sx-purple-text' : 'text-sx-gray hover:text-white'
            }`}
          >
            {item.label}
          </Link>
        )
      })}
      <Link
        href="/dashboard#profile"
        className="shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-sm text-sx-gray hover:text-white"
      >
        Settings
      </Link>
    </nav>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/wallet/WalletSidebar.tsx
git commit -m "feat(wallet): add WalletSidebar nav"
```

---

### Task W10: `components/wallet/WalletSecurityBadges.tsx` + `RewardsProgressWidget.tsx`

**Files:**
- Create: `components/wallet/WalletSecurityBadges.tsx`
- Create: `components/wallet/RewardsProgressWidget.tsx`

**Interfaces:**
- Consumes: `computeTier`, `TIER_XP_THRESHOLDS`, `type MembershipTier` (`lib/membership/tiers.ts`), `xpToNextTierLabel` (`lib/dashboard/command-centre.ts`).
- Produces: `WalletSecurityBadges`, `RewardsProgressWidget` — consumed by W12.

- [ ] **Step 1: Write `WalletSecurityBadges.tsx`**

```tsx
// components/wallet/WalletSecurityBadges.tsx
export function WalletSecurityBadges({ kycVerified }: { kycVerified: boolean }) {
  const badges = [
    { icon: '🛡', label: 'Wallet Protected', sub: 'Zolarux Escrow Active' },
    { icon: kycVerified ? '✅' : '⏳', label: 'Verified Account', sub: kycVerified ? 'KYC Verified' : 'Pending Verification' },
    { icon: '🔒', label: 'Escrow Enabled', sub: 'All Transactions Safe' },
  ]
  return (
    <div className="space-y-2 rounded-2xl border border-sx-border bg-sx-surface p-4">
      {badges.map((b) => (
        <div key={b.label} className="flex items-center gap-2 text-sm">
          <span>{b.icon}</span>
          <div>
            <p className="font-semibold text-white">{b.label}</p>
            <p className="text-xs text-sx-gray">{b.sub}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Write `RewardsProgressWidget.tsx`**

```tsx
// components/wallet/RewardsProgressWidget.tsx
import { computeTier, TIER_XP_THRESHOLDS, type MembershipTier } from '@/lib/membership/tiers'
import { xpToNextTierLabel } from '@/lib/dashboard/command-centre'

const TIER_LABEL: Record<MembershipTier, string> = {
  recruit: 'Recruit', guardian: 'Guardian', elite: 'Elite', sentinel: 'Sentinel', legend: 'Legend',
}

export function RewardsProgressWidget({ xp }: { xp: number }) {
  const tier = computeTier(xp)
  const floor = TIER_XP_THRESHOLDS[tier]
  const next = (Object.entries(TIER_XP_THRESHOLDS).find(([, v]) => v > xp)?.[0] ?? null) as MembershipTier | null
  const ceiling = next ? TIER_XP_THRESHOLDS[next] : null
  const pct = ceiling ? Math.min(100, Math.round(((xp - floor) / (ceiling - floor)) * 100)) : 100

  return (
    <div className="rounded-2xl border border-sx-border bg-sx-surface p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-sx-gray">Your Level</p>
      <p className="mt-1 font-display text-lg font-black text-white">{TIER_LABEL[tier]}</p>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
        <div className="h-full rounded-full bg-sx-purple transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-xs text-sx-gray">{xpToNextTierLabel(xp)}</p>
    </div>
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/wallet/WalletSecurityBadges.tsx components/wallet/RewardsProgressWidget.tsx
git commit -m "feat(wallet): add security badges and rewards progress widget"
```

---

### Task W11: `app/dashboard/wallet/layout.tsx`

**Files:**
- Create: `app/dashboard/wallet/layout.tsx`

**Interfaces:**
- Consumes: `WalletSidebar` (W9).
- Produces: layout wrapper for every route in W12–W16.

- [ ] **Step 1: Write the layout**

```tsx
// app/dashboard/wallet/layout.tsx
import { WalletSidebar } from '@/components/wallet/WalletSidebar'

export default function WalletLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-4xl px-4 pb-20">
      <div className="py-8">
        <h1 className="text-2xl font-black text-white">Your Wallet Overview</h1>
        <p className="mt-1 text-sm text-slate-400">Manage your balance, earnings and transactions.</p>
      </div>
      <div className="flex flex-col gap-6 sm:flex-row">
        <WalletSidebar />
        <div className="min-w-0 flex-1 space-y-6">{children}</div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/dashboard/wallet/layout.tsx
git commit -m "feat(wallet): add wallet section layout with sidebar nav"
```

---

### Task W12: Rewrite `app/dashboard/wallet/page.tsx` (Overview)

**Files:**
- Modify: `app/dashboard/wallet/page.tsx`

**Interfaces:**
- Consumes: `BalanceHeroCard` (W5), `QuickActionsRow` (W8), `EarningsOverview` (W7), `RecentTransactionsList` (W6), `WalletSecurityBadges`/`RewardsProgressWidget` (W10), `mapTransactionRows` (W2), `monthOverMonthChange` (W3).

- [ ] **Step 1: Rewrite the page**

Replace the entire file (the old inline `WalletPanel`/`EarningsBreakdownPanel` render built in the earlier plan's Task B13 is fully superseded):

```tsx
// app/dashboard/wallet/page.tsx
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { BalanceHeroCard } from '@/components/wallet/BalanceHeroCard'
import { QuickActionsRow } from '@/components/wallet/QuickActionsRow'
import { EarningsOverview } from '@/components/wallet/EarningsOverview'
import { RecentTransactionsList } from '@/components/wallet/RecentTransactionsList'
import { WalletSecurityBadges } from '@/components/wallet/WalletSecurityBadges'
import { RewardsProgressWidget } from '@/components/wallet/RewardsProgressWidget'
import { mapTransactionRows, type RawWalletTxnRow } from '@/lib/wallet/transactions'
import { monthOverMonthChange } from '@/lib/wallet/earnings-trend'
import { summarizeEarningsByCategory } from '@/lib/wallet/breakdown'

export const metadata: Metadata = {
  title: 'Wallet · SentinelX Esports',
  robots: { index: false, follow: false },
}

export default async function WalletOverviewPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/dashboard/wallet')

  const admin = createAdminClient()
  const [walletRes, allTxnRes, pendingWithdrawalsRes, profileRes] = await Promise.all([
    admin.from('wallets').select('balance').eq('player_id', user.id).maybeSingle(),
    admin
      .from('wallet_transactions')
      .select('id, type, category, amount, reference_id, note, created_at')
      .eq('player_id', user.id)
      .order('created_at', { ascending: false }),
    admin.from('withdrawal_requests').select('id, amount, status').eq('player_id', user.id).eq('status', 'pending'),
    admin.from('profiles').select('xp, kyc_verified').eq('id', user.id).maybeSingle(),
  ])

  const allTxnRows = (allTxnRes.data ?? []) as RawWalletTxnRow[]
  const pendingWithdrawalTotal = (pendingWithdrawalsRes.data ?? []).reduce((sum, r) => sum + r.amount, 0)

  // Every withdrawal-status lookup this page needs is for the player's own
  // rows — fetch withdrawal_requests statuses by id for the recent-5 slice only.
  const recentRaw = allTxnRows.slice(0, 5)
  const withdrawalRequestIds = recentRaw.flatMap((r) => (r.type === 'withdrawal_request' && r.reference_id ? [r.reference_id] : []))
  const { data: wrRows } =
    withdrawalRequestIds.length > 0
      ? await admin.from('withdrawal_requests').select('id, status').in('id', withdrawalRequestIds)
      : { data: [] as { id: string; status: string }[] }
  const withdrawalStatusById = new Map((wrRows ?? []).map((r) => [r.id, r.status]))
  const recentTransactions = mapTransactionRows(recentRaw, withdrawalStatusById)

  const breakdown = summarizeEarningsByCategory(allTxnRows)
  const tournamentPrizeTrendPct = monthOverMonthChange(allTxnRows, 'tournament_prize', new Date())

  return (
    <>
      <BalanceHeroCard balance={walletRes.data?.balance ?? 0} pendingWithdrawal={pendingWithdrawalTotal} />
      <QuickActionsRow />
      <EarningsOverview
        tournamentPrize={breakdown.tournament_prize ?? 0}
        tournamentPrizeTrendPct={tournamentPrizeTrendPct}
        referral={breakdown.referral ?? 0}
        bonus={breakdown.bonus ?? 0}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <RecentTransactionsList transactions={recentTransactions} />
        </div>
        <div className="space-y-4">
          <RewardsProgressWidget xp={profileRes.data?.xp ?? 0} />
          <WalletSecurityBadges kycVerified={profileRes.data?.kyc_verified ?? false} />
        </div>
      </div>
    </>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/dashboard/wallet/page.tsx
git commit -m "feat(wallet): rebuild Overview page per full wallet spec"
```

---

### Task W13: `app/dashboard/wallet/transactions/page.tsx`

**Files:**
- Create: `app/dashboard/wallet/transactions/page.tsx`

**Interfaces:**
- Consumes: `mapTransactionRows` (W2), `TransactionRow` (W6).

- [ ] **Step 1: Write the page**

Filters map directly onto `category`: "Winnings" → `tournament_prize`, "Withdrawals" → `withdrawal`, "Deposits" → `type = 'deposit'` (deposits share the `bonus` category per migration 054's backfill, so filter by `type` for this one, not `category`, to isolate them precisely).

```tsx
// app/dashboard/wallet/transactions/page.tsx
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { TransactionRow } from '@/components/wallet/TransactionRow'
import { mapTransactionRows, type RawWalletTxnRow } from '@/lib/wallet/transactions'

export const metadata: Metadata = { title: 'Transactions · Wallet · SentinelX Esports', robots: { index: false, follow: false } }

const PAGE_SIZE = 20
type Filter = 'all' | 'winnings' | 'withdrawals' | 'deposits'
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'winnings', label: 'Winnings' },
  { key: 'withdrawals', label: 'Withdrawals' },
  { key: 'deposits', label: 'Deposits' },
]

export default async function WalletTransactionsPage({
  searchParams,
}: {
  searchParams: { filter?: string; page?: string }
}) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/dashboard/wallet/transactions')

  const filter: Filter = (['winnings', 'withdrawals', 'deposits'] as const).includes(searchParams.filter as Filter)
    ? (searchParams.filter as Filter)
    : 'all'
  const page = Math.max(1, Number.parseInt(searchParams.page ?? '1', 10) || 1)
  const offset = (page - 1) * PAGE_SIZE

  const admin = createAdminClient()
  let query = admin
    .from('wallet_transactions')
    .select('id, type, category, amount, reference_id, note, created_at', { count: 'exact' })
    .eq('player_id', user.id)
  if (filter === 'winnings') query = query.eq('category', 'tournament_prize')
  else if (filter === 'withdrawals') query = query.eq('category', 'withdrawal')
  else if (filter === 'deposits') query = query.eq('type', 'deposit')

  const { data, count } = await query.order('created_at', { ascending: false }).range(offset, offset + PAGE_SIZE - 1)
  const rows = (data ?? []) as RawWalletTxnRow[]
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE))

  const withdrawalRequestIds = rows.flatMap((r) => (r.type === 'withdrawal_request' && r.reference_id ? [r.reference_id] : []))
  const { data: wrRows } =
    withdrawalRequestIds.length > 0
      ? await admin.from('withdrawal_requests').select('id, status').in('id', withdrawalRequestIds)
      : { data: [] as { id: string; status: string }[] }
  const transactions = mapTransactionRows(rows, new Map((wrRows ?? []).map((r) => [r.id, r.status])))

  function hrefFor(next: { filter?: string; page?: string }) {
    const sp = new URLSearchParams()
    const f = next.filter ?? filter
    if (f !== 'all') sp.set('filter', f)
    const p = next.page ?? String(page)
    if (p !== '1') sp.set('page', p)
    const qs = sp.toString()
    return `/dashboard/wallet/transactions${qs ? `?${qs}` : ''}`
  }

  return (
    <section className="rounded-2xl border border-sx-border bg-sx-surface p-5">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-white">All Transactions</h2>
      <div className="mb-4 flex gap-2 overflow-x-auto scrollbar-hide">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={hrefFor({ filter: f.key, page: '1' })}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold ${
              filter === f.key ? 'bg-sx-purple text-white' : 'border border-sx-border text-sx-gray hover:text-white'
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>
      {transactions.length === 0 ? (
        <p className="text-sm text-sx-gray">No transactions match this filter.</p>
      ) : (
        <div className="divide-y divide-sx-border">
          {transactions.map((t) => (
            <TransactionRow key={t.id} txn={t} />
          ))}
        </div>
      )}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2 text-sm">
          <Link
            href={hrefFor({ page: String(Math.max(1, page - 1)) })}
            aria-disabled={page === 1}
            className={page === 1 ? 'pointer-events-none opacity-30' : 'text-white hover:text-sx-purple-text'}
          >
            ← Prev
          </Link>
          <span className="text-sx-gray">
            Page {page} of {totalPages}
          </span>
          <Link
            href={hrefFor({ page: String(Math.min(totalPages, page + 1)) })}
            aria-disabled={page === totalPages}
            className={page === totalPages ? 'pointer-events-none opacity-30' : 'text-white hover:text-sx-purple-text'}
          >
            Next →
          </Link>
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 2: Typecheck and build**

Run: `npx tsc --noEmit && npm run build 2>&1 | tail -30`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/dashboard/wallet/transactions/page.tsx
git commit -m "feat(wallet): add Transactions page with filters + pagination"
```

---

### Task W14: `app/dashboard/wallet/withdraw/page.tsx`

**Files:**
- Create: `app/dashboard/wallet/withdraw/page.tsx`

**Interfaces:**
- Consumes: `requestWalletWithdrawal` (`lib/wallet/actions.ts`), `getWalletBalance` (`lib/wallet/service.ts`), `maskAccountNumber`/`kycPanelMode` (`lib/kyc/logic.ts`), `Field` (`components/dashboard/FormField.tsx`).

- [ ] **Step 1: Write the page — a thin server wrapper around a new client form (the existing `VerifiedWithdrawalForm` logic from `WalletPanel.tsx`, lifted out since `WalletPanel.tsx` itself is retired in W17)**

```tsx
// app/dashboard/wallet/withdraw/page.tsx
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getWalletBalance } from '@/lib/wallet/service'
import { maskAccountNumber, kycPanelMode } from '@/lib/kyc/logic'
import { formatNaira } from '@/lib/format'
import { WithdrawForm } from '@/components/wallet/WithdrawForm'

export const metadata: Metadata = { title: 'Withdraw · Wallet · SentinelX Esports', robots: { index: false, follow: false } }

export default async function WalletWithdrawPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/dashboard/wallet/withdraw')

  const admin = createAdminClient()
  const [balance, kycRes, activeRes] = await Promise.all([
    getWalletBalance(admin, user.id),
    admin
      .from('player_kyc')
      .select('kyc_status, payout_bank_name, payout_account_number, payout_account_name')
      .eq('player_id', user.id)
      .maybeSingle(),
    admin.from('withdrawal_requests').select('id').eq('player_id', user.id).eq('status', 'pending').maybeSingle(),
  ])
  const kyc = kycRes.data
  const mode = kycPanelMode(kyc?.kyc_status ?? 'unverified')

  if (mode !== 'verified' || !kyc?.payout_bank_name) {
    return (
      <section className="rounded-2xl border border-sx-border bg-sx-surface p-5 text-center">
        <p className="font-bold text-white">Add a payout account before withdrawing</p>
        <p className="mt-1 text-sm text-sx-gray">You need a verified bank account on file to request a withdrawal.</p>
        <Link
          href="/dashboard/wallet/payment-methods"
          className="mt-4 inline-block rounded-xl bg-sx-purple px-6 py-3 text-sm font-bold text-white hover:bg-sx-purple-light"
        >
          Add Payout Account
        </Link>
      </section>
    )
  }

  return (
    <section className="rounded-2xl border border-sx-border bg-sx-surface p-5">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-white">Request Withdrawal</h2>
      <div className="mb-4 rounded-xl border border-sx-border bg-sx-bg p-4 text-sm">
        <p className="text-xs uppercase tracking-wide text-sx-gray">Linked Bank Account</p>
        <p className="mt-1 text-white">
          🏦 {kyc.payout_bank_name} {maskAccountNumber(kyc.payout_account_number!)} — {kyc.payout_account_name}
        </p>
        <Link href="/dashboard/wallet/payment-methods" className="mt-1 inline-block text-xs font-semibold text-sx-purple-text hover:text-sx-purple-light">
          Change account →
        </Link>
      </div>
      <WithdrawForm balance={balance} hasActive={!!activeRes.data} />
      <p className="mt-4 text-xs text-sx-gray">
        🔒 Withdrawals are reviewed and processed within 24 hours. Funds go to your linked account above.
      </p>
    </section>
  )
}
```

- [ ] **Step 2: Write `components/wallet/WithdrawForm.tsx`** (the client form, lifted from `WalletPanel.tsx`'s `VerifiedWithdrawalForm` — same server action, same schema-enforced ₦100 minimum, this time full-page instead of an inline card)

```tsx
// components/wallet/WithdrawForm.tsx
'use client'
import { useFormState } from 'react-dom'
import { requestWalletWithdrawal, type WalletWithdrawalState } from '@/lib/wallet/actions'
import { formatNaira } from '@/lib/format'
import { Field } from '@/components/dashboard/FormField'

export function WithdrawForm({ balance, hasActive }: { balance: number; hasActive: boolean }) {
  const [state, formAction] = useFormState<WalletWithdrawalState, FormData>(requestWalletWithdrawal, undefined)

  if (hasActive || state?.success) {
    return (
      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-center text-sm font-semibold text-amber-300">
        Request pending — we&apos;ll be in touch once it&apos;s reviewed.
      </div>
    )
  }

  return (
    <form action={formAction} className="space-y-4">
      <Field name="amount" label={`Amount (₦, up to ${formatNaira(balance)})`} type="number" min={100} max={balance} placeholder="100" />
      <p className="text-xs text-sx-gray">Available: {formatNaira(balance)} · Min: ₦100</p>
      {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
      <button
        type="submit"
        className="w-full rounded-xl bg-sx-purple px-7 py-3 text-sm font-bold text-white transition-colors hover:bg-sx-purple-light"
      >
        Withdraw
      </button>
    </form>
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/dashboard/wallet/withdraw/page.tsx components/wallet/WithdrawForm.tsx
git commit -m "feat(wallet): add dedicated Withdraw page"
```

---

### Task W15: `app/dashboard/wallet/deposit/page.tsx`

**Files:**
- Create: `app/dashboard/wallet/deposit/page.tsx`
- Create: `components/wallet/DepositForm.tsx`

**Interfaces:**
- Consumes: `initiateWalletDeposit` (`lib/wallet/deposit.ts`), `computePaystackFee` (`lib/paystack/fees.ts`) — both lifted from `WalletPanel.tsx`'s existing `FundWalletForm`, same server action and fee math, no new logic.

- [ ] **Step 1: Write `components/wallet/DepositForm.tsx`** (copy of `WalletPanel.tsx`'s existing `FundWalletForm`, unchanged behavior — ₦100 minimum per `walletDepositSchema`, matching this page's own copy)

```tsx
// components/wallet/DepositForm.tsx
'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { initiateWalletDeposit, type WalletDepositState } from '@/lib/wallet/deposit'
import { computePaystackFee } from '@/lib/paystack/fees'
import { formatNaira } from '@/lib/format'
import { Field } from '@/components/dashboard/FormField'

export function DepositForm() {
  const [state, formAction] = useFormState<WalletDepositState, FormData>(initiateWalletDeposit, undefined)
  const [amount, setAmount] = useState<number | ''>('')
  const fee = typeof amount === 'number' && amount >= 100 ? computePaystackFee(amount) : 0
  const total = typeof amount === 'number' && amount >= 100 ? amount + fee : 0

  return (
    <form action={formAction} className="space-y-4">
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
        <p className="text-xs text-sx-gray">
          You&apos;ll pay {formatNaira(total)} total — {formatNaira(amount as number)} to your wallet + {formatNaira(fee)} fee.
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

- [ ] **Step 2: Write the page**

```tsx
// app/dashboard/wallet/deposit/page.tsx
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { DepositForm } from '@/components/wallet/DepositForm'

export const metadata: Metadata = { title: 'Deposit · Wallet · SentinelX Esports', robots: { index: false, follow: false } }

export default async function WalletDepositPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/dashboard/wallet/deposit')

  return (
    <section className="rounded-2xl border border-sx-border bg-sx-surface p-5">
      <h2 className="mb-1 text-sm font-bold uppercase tracking-wide text-white">Fund Your Wallet</h2>
      <p className="mb-4 text-sm text-sx-gray">Top up via Paystack — funds are available immediately after payment.</p>
      <DepositForm />
    </section>
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/dashboard/wallet/deposit/page.tsx components/wallet/DepositForm.tsx
git commit -m "feat(wallet): add dedicated Deposit page"
```

---

### Task W16: `app/dashboard/wallet/payment-methods/page.tsx`

**Files:**
- Create: `app/dashboard/wallet/payment-methods/page.tsx`
- Create: `components/wallet/RemoveAccountButton.tsx`

**Interfaces:**
- Consumes: `KycForm` (existing, unmodified), `removePayoutAccount` (W4), `listBanks` (`lib/paystack/server.ts`), `maskAccountNumber` (`lib/kyc/logic.ts`).

- [ ] **Step 1: Write `components/wallet/RemoveAccountButton.tsx`**

```tsx
// components/wallet/RemoveAccountButton.tsx
'use client'
import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { removePayoutAccount } from '@/lib/kyc/actions'

export function RemoveAccountButton() {
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await removePayoutAccount()
          router.refresh()
        })
      }
      className="text-xs font-bold text-red-400 hover:text-red-300 disabled:opacity-50"
    >
      {pending ? 'Removing…' : 'Remove'}
    </button>
  )
}
```

- [ ] **Step 2: Write the page**

```tsx
// app/dashboard/wallet/payment-methods/page.tsx
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { listBanks, type Bank } from '@/lib/paystack/server'
import { maskAccountNumber } from '@/lib/kyc/logic'
import { KycForm } from '@/components/dashboard/KycForm'
import { RemoveAccountButton } from '@/components/wallet/RemoveAccountButton'

export const metadata: Metadata = { title: 'Payment Methods · Wallet · SentinelX Esports', robots: { index: false, follow: false } }

export default async function WalletPaymentMethodsPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/dashboard/wallet/payment-methods')

  const admin = createAdminClient()
  const [kycRes, banks] = await Promise.all([
    admin
      .from('player_kyc')
      .select('kyc_status, kyc_failure_reason, payout_bank_name, payout_account_number, payout_account_name')
      .eq('player_id', user.id)
      .maybeSingle(),
    listBanks().catch(() => [] as Bank[]),
  ])
  const kyc = kycRes.data

  return (
    <section className="rounded-2xl border border-sx-border bg-sx-surface p-5">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-white">Payment Methods</h2>
      {kyc?.kyc_status === 'verified' && kyc.payout_bank_name ? (
        <div className="flex items-center justify-between rounded-xl border border-sx-border bg-sx-bg p-4 text-sm">
          <div>
            <p className="text-white">
              🏦 {kyc.payout_bank_name} {maskAccountNumber(kyc.payout_account_number!)} — {kyc.payout_account_name}
            </p>
            <span className="text-xs font-semibold text-emerald-400">✅ Primary</span>
          </div>
          <RemoveAccountButton />
        </div>
      ) : (
        <KycForm banks={banks} failureReason={kyc?.kyc_failure_reason} />
      )}
    </section>
  )
}
```

- [ ] **Step 3: Typecheck and build**

Run: `npx tsc --noEmit && npm run build 2>&1 | tail -30`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/dashboard/wallet/payment-methods/page.tsx components/wallet/RemoveAccountButton.tsx
git commit -m "feat(wallet): add Payment Methods page"
```

---

### Task W17: Retire superseded components

**Files:**
- Delete: `components/dashboard/WalletPanel.tsx`
- Delete: `components/dashboard/EarningsBreakdownPanel.tsx`

- [ ] **Step 1: Confirm no remaining references**

Run: `grep -rn "WalletPanel\|EarningsBreakdownPanel" app components`
Expected: no matches (the only caller, the old `app/dashboard/wallet/page.tsx`, was fully rewritten in W12).

- [ ] **Step 2: Delete and verify**

```bash
rm components/dashboard/WalletPanel.tsx components/dashboard/EarningsBreakdownPanel.tsx
npx tsc --noEmit && npm run build 2>&1 | tail -40
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add -A -- components/dashboard/WalletPanel.tsx components/dashboard/EarningsBreakdownPanel.tsx
git commit -m "chore(wallet): remove WalletPanel/EarningsBreakdownPanel, superseded by the wallet section pages"
```

---

### Task W18: Manual verification

- [ ] **Step 1: Start the dev server (via the `run` skill) and walk through, as a logged-in test player:**
  - `/dashboard/wallet` — balance card (with hide/show toggle), quick actions, earnings overview (tournament/referral/bonus live, community locked), recent transactions, rewards widget, security badges
  - `/dashboard/wallet/transactions` — filters switch correctly, pagination works past 20 rows if data allows
  - `/dashboard/wallet/withdraw` — shows the "add payout account" redirect prompt if unverified, or the form if verified
  - `/dashboard/wallet/deposit` — Paystack redirect flow starts (don't complete a real payment)
  - `/dashboard/wallet/payment-methods` — `KycForm` for an unverified player; linked-account card + working Remove button for a verified one
  - Sidebar/tab-bar: locked items show 🔒 and are inert; active route highlights
- [ ] **Step 2: Run the full check**

Run: `npx vitest run && npx tsc --noEmit && npm run build 2>&1 | tail -60`
Expected: all green.

---

## Self-Review Notes (for the executor, not a task)

- Spec §2 (nav + phases), §3 (Overview: hero/actions/earnings/transactions+withdrawal/right panel), §4 (Transactions), §5 (Withdraw), §6 (Payment Methods), §7 (data), §8 (components), §9 (locked-section rules) are all covered above, each with the real-schema correction called out where the spec diverged from reality.
- §3.7 (bottom purple banner + mascot) and §3.6's "Learn More" promo card are cosmetic copy blocks with no data dependency — fold them directly into W12's JSX at execution time (omitted from the plan's code samples only to keep them focused on logic; add them as static markup using the existing `/public/mascot/mascot-home.png` asset, matching the Hero-section float pattern from the earlier plan's `HeroSection.tsx` if a decorative touch is wanted).
- §4's "Deposits filter shown but no deposit rows yet" caveat is now moot — deposits are live, so the filter has real data from day one.
