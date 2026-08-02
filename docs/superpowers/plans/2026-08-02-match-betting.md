# Match Betting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let players stake real money on the outcome of a scheduled tournament match, settled pari-mutuel (stakes pool by side, winners split the losing side's pool minus a 10% rake) once an admin confirms the result.

**Architecture:** A new `match_bets` table plus a `betting_locked` column on `matches`. Placing a bet debits the existing `wallets` system (`lib/wallet/service.ts`); settlement credits it back. Settlement is triggered from inside the existing admin result-confirmation/no-show actions — never from a player's own submission. Pure math (market-open check, implied payout multiplier, pari-mutuel payout split) lives in small standalone modules so it's unit-testable without a database.

**Tech Stack:** Next.js 14 App Router server actions, Supabase (Postgres + RLS), Zod, Vitest, Tailwind.

## Global Constraints

- Stake range: ₦100 minimum, ₦50,000 maximum per bet (spec: "Stake limits").
- Platform rake: 10% of the losing pool (spec: "Platform rake").
- Match participants may never bet on their own match (spec: "Self-betting").
- Betting locks automatically at `matches.scheduled_at`, OR earlier if admin manually locks it via `betting_locked`; once locked by either path it can never be reopened (spec: "Betting window" + follow-up).
- Settlement/refunds are only ever triggered from admin-confirmed outcomes (`confirmResult`, `declareNoShowWinner`, `markBothNoShow`) — never from a player's self-submitted result. This mirrors the existing project-wide rule that brackets only update after admin confirms.
- No age gate, no KYC gate on betting — this was an explicit, already-made decision (see the spec's "Legal note"). Do not add one.
- Follow existing code style exactly: `'use server'`/`'use client'` directives, no semicolons, `createAdminClient()` for privileged writes, `createClient()` for the current user's session, Tailwind slate/violet/emerald color scheme matching `app/(public)/matches/[id]/page.tsx`.

---

## File Structure

- `supabase/migrations/042_match_betting.sql` — new: `matches.betting_locked`, `match_bets` table, RLS.
- `lib/wallet/service.ts` — modify: extend `WalletTxnType` with `bet_stake` | `bet_payout` | `bet_refund`.
- `lib/betting/market.ts` — new: pure functions, `bettingOpen`, `impliedPayoutMultiplier`, `RAKE_RATE` constant.
- `lib/betting/market.test.ts` — new.
- `lib/betting/settle.ts` — new: pure `computePariMutuelPayouts`, plus DB-touching `settleMatchBets` / `refundMatchBets`.
- `lib/betting/settle.test.ts` — new: tests `computePariMutuelPayouts` only (the pure part).
- `lib/betting/schema.ts` — new: `placeBetSchema`.
- `lib/betting/actions.ts` — new: `placeBet` server action.
- `lib/betting/admin-actions.ts` — new: `voidBet`, `toggleBettingLocked` server actions.
- `lib/matches/verify-actions.ts` — modify: call `settleMatchBets`/`refundMatchBets` from `confirmResult`.
- `lib/matches/admin-actions.ts` — modify: call `refundMatchBets` from `declareNoShowWinner` and `markBothNoShow`.
- `components/match/BettingPanel.tsx` — new: client component, stake form + live pool display, on the Match Centre page.
- `app/(public)/matches/[id]/page.tsx` — modify: render `BettingPanel`.
- `app/(public)/betting/page.tsx` — new: hub page listing all open markets.
- `components/admin/VoidBetsList.tsx` — new: admin void-bet UI.
- `components/admin/BettingLockToggle.tsx` — new: admin manual-lock toggle.
- `app/admin/matches/[id]/review/page.tsx` — modify: render both admin components.

---

### Task 1: Migration + wallet transaction types

**Files:**
- Create: `supabase/migrations/042_match_betting.sql`
- Modify: `lib/wallet/service.ts:4-10`

**Interfaces:**
- Produces: `matches.betting_locked` (boolean, default false), `public.match_bets` table with columns `id, match_id, player_id, side, stake_amount, status, payout_amount, voided_reason, placed_at, settled_at`. `WalletTxnType` gains `'bet_stake' | 'bet_payout' | 'bet_refund'`.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/042_match_betting.sql
ALTER TABLE public.matches
  ADD COLUMN betting_locked boolean NOT NULL DEFAULT false;

CREATE TABLE public.match_bets (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id       uuid        NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  player_id      uuid        NOT NULL REFERENCES public.profiles(id),
  side           text        NOT NULL CHECK (side IN ('player_a', 'player_b')),
  stake_amount   integer     NOT NULL CHECK (stake_amount > 0),
  status         text        NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'won', 'lost', 'refunded', 'voided')),
  payout_amount  integer,
  voided_reason  text,
  placed_at      timestamptz NOT NULL DEFAULT now(),
  settled_at     timestamptz
);

CREATE INDEX ON public.match_bets (match_id);
CREATE INDEX ON public.match_bets (player_id);

ALTER TABLE public.match_bets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Players view own bets" ON public.match_bets
  FOR SELECT USING (auth.uid() = player_id);
```

- [ ] **Step 2: Apply the migration**

Run: `npx supabase db push` (or the project's existing migration-apply command — check `docs/superpowers/plans/2026-07-13-player-wallet-system.md` for the exact command this repo uses if `db push` fails).
Expected: migration `042_match_betting` applied with no errors; `match_bets` visible via `npx supabase gen types typescript ...` or the Supabase dashboard.

- [ ] **Step 3: Extend `WalletTxnType`**

In `lib/wallet/service.ts`, change:

```ts
export type WalletTxnType =
  | 'prize'
  | 'referral'
  | 'friendly_stake'
  | 'admin_credit'
  | 'withdrawal_request'
  | 'withdrawal_reversal'
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
```

Also check whether `wallet_transactions.type` has a Postgres `CHECK` constraint (search `supabase/migrations/024_wallet_system.sql`) — if so, add a migration statement in `042_match_betting.sql` (Step 1) dropping and recreating that constraint to include the three new values, the same way `032_tournament_cancellation.sql` did for `tournaments_status_check`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/042_match_betting.sql lib/wallet/service.ts
git commit -m "feat(betting): add match_bets table and betting wallet transaction types"
```

---

### Task 2: Pure market logic — `bettingOpen` and implied payout multiplier

**Files:**
- Create: `lib/betting/market.ts`
- Test: `lib/betting/market.test.ts`

**Interfaces:**
- Produces: `RAKE_RATE = 0.10`, `bettingOpen(match, now?): boolean`, `impliedPayoutMultiplier(pools, side): number | null` — used by Task 3 (`settle.ts` imports `RAKE_RATE`), Task 5 (`actions.ts` imports `bettingOpen`), Task 8/10 (UI imports both).

- [ ] **Step 1: Write the failing tests**

```ts
// lib/betting/market.test.ts
import { describe, it, expect } from 'vitest'
import { bettingOpen, impliedPayoutMultiplier, RAKE_RATE } from './market'

describe('bettingOpen', () => {
  const base = { status: 'scheduled', scheduled_at: '2026-08-10T18:00:00Z', betting_locked: false }

  it('is open before scheduled_at', () => {
    expect(bettingOpen(base, new Date('2026-08-10T17:00:00Z'))).toBe(true)
  })

  it('is closed at or after scheduled_at', () => {
    expect(bettingOpen(base, new Date('2026-08-10T18:00:00Z'))).toBe(false)
    expect(bettingOpen(base, new Date('2026-08-10T19:00:00Z'))).toBe(false)
  })

  it('is closed when betting_locked is true, even before scheduled_at', () => {
    expect(bettingOpen({ ...base, betting_locked: true }, new Date('2026-08-10T17:00:00Z'))).toBe(false)
  })

  it('is closed when match status is not scheduled', () => {
    expect(bettingOpen({ ...base, status: 'live' }, new Date('2026-08-10T17:00:00Z'))).toBe(false)
    expect(bettingOpen({ ...base, status: 'completed' }, new Date('2026-08-10T17:00:00Z'))).toBe(false)
  })

  it('is open when scheduled_at is not yet set', () => {
    expect(bettingOpen({ ...base, scheduled_at: null }, new Date())).toBe(true)
  })
})

describe('impliedPayoutMultiplier', () => {
  it('returns null when this side has no pool yet', () => {
    expect(impliedPayoutMultiplier({ playerA: 0, playerB: 500 }, 'player_a')).toBeNull()
  })

  it('returns 1 (stake-back only) when the other side has no pool', () => {
    expect(impliedPayoutMultiplier({ playerA: 500, playerB: 0 }, 'player_a')).toBe(1)
  })

  it('computes the rake-adjusted multiplier for an even pool split', () => {
    // otherPool 1000, thisPool 1000: 1 + (1000 * 0.9) / 1000 = 1.9
    expect(impliedPayoutMultiplier({ playerA: 1000, playerB: 1000 }, 'player_a')).toBeCloseTo(1.9)
  })

  it('gives the smaller side a higher multiplier (underdog pays more)', () => {
    const pools = { playerA: 200, playerB: 800 }
    const underdog = impliedPayoutMultiplier(pools, 'player_a')!
    const favorite = impliedPayoutMultiplier(pools, 'player_b')!
    expect(underdog).toBeGreaterThan(favorite)
  })
})

describe('RAKE_RATE', () => {
  it('is 10%', () => {
    expect(RAKE_RATE).toBe(0.10)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/betting/market.test.ts`
Expected: FAIL — `Cannot find module './market'`

- [ ] **Step 3: Write the implementation**

```ts
// lib/betting/market.ts
export const RAKE_RATE = 0.10

export type MatchForBetting = {
  status: string
  scheduled_at: string | null
  betting_locked: boolean
}

// Betting opens the moment a match is scheduled and closes automatically at
// its scheduled start time, or earlier if admin manually locks it. Once
// closed by either path there is no reopening — see the design spec's
// "Betting window" discussion of why re-opening after players may have
// watched the outcome live recreates the exact insider-betting risk this
// avoids.
export function bettingOpen(match: MatchForBetting, now: Date = new Date()): boolean {
  if (match.betting_locked) return false
  if (match.status !== 'scheduled') return false
  if (!match.scheduled_at) return true
  return now < new Date(match.scheduled_at)
}

export type SidePools = { playerA: number; playerB: number }
export type Side = 'player_a' | 'player_b'

// "What would a ₦1 stake on this side return right now if the pool closed
// this instant" — informational only, never used for settlement math (that's
// computePariMutuelPayouts in settle.ts, applied to the pool at lock time).
export function impliedPayoutMultiplier(pools: SidePools, side: Side): number | null {
  const thisPool = side === 'player_a' ? pools.playerA : pools.playerB
  const otherPool = side === 'player_a' ? pools.playerB : pools.playerA
  if (thisPool <= 0) return null
  if (otherPool <= 0) return 1
  return 1 + (otherPool * (1 - RAKE_RATE)) / thisPool
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/betting/market.test.ts`
Expected: PASS, all 9 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/betting/market.ts lib/betting/market.test.ts
git commit -m "feat(betting): add bettingOpen and implied payout multiplier"
```

---

### Task 3: Pari-mutuel settlement math

**Files:**
- Create: `lib/betting/settle.ts` (pure function only in this task — DB-touching functions added in Task 4)
- Test: `lib/betting/settle.test.ts`

**Interfaces:**
- Consumes: `RAKE_RATE` from `lib/betting/market.ts` (Task 2).
- Produces: `computePariMutuelPayouts(bets, winningSide): Map<string, number>` — consumed by Task 4's `settleMatchBets`.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/betting/settle.test.ts
import { describe, it, expect } from 'vitest'
import { computePariMutuelPayouts } from './settle'

describe('computePariMutuelPayouts', () => {
  it('splits the rake-adjusted losing pool proportionally among winners', () => {
    const bets = [
      { id: 'w1', side: 'player_a' as const, stakeAmount: 100 },
      { id: 'w2', side: 'player_a' as const, stakeAmount: 300 },
      { id: 'l1', side: 'player_b' as const, stakeAmount: 400 },
    ]
    const payouts = computePariMutuelPayouts(bets, 'player_a')
    // losingPool 400, distributable = 400 * 0.9 = 360
    // w1: 100 + 360 * (100/400) = 100 + 90 = 190
    // w2: 300 + 360 * (300/400) = 300 + 270 = 570
    expect(payouts.get('w1')).toBe(190)
    expect(payouts.get('w2')).toBe(570)
    expect(payouts.get('l1')).toBe(0)
  })

  it('returns stake-back with no rake when nobody backed the losing side', () => {
    const bets = [{ id: 'w1', side: 'player_a' as const, stakeAmount: 500 }]
    const payouts = computePariMutuelPayouts(bets, 'player_a')
    expect(payouts.get('w1')).toBe(500)
  })

  it('pays nothing when nobody backed the winning side', () => {
    const bets = [{ id: 'l1', side: 'player_b' as const, stakeAmount: 500 }]
    const payouts = computePariMutuelPayouts(bets, 'player_a')
    expect(payouts.get('l1')).toBe(0)
  })

  it('handles multiple bets from the same player on the same side', () => {
    const bets = [
      { id: 'w1', side: 'player_a' as const, stakeAmount: 100 },
      { id: 'w2', side: 'player_a' as const, stakeAmount: 100 },
      { id: 'l1', side: 'player_b' as const, stakeAmount: 200 },
    ]
    const payouts = computePariMutuelPayouts(bets, 'player_a')
    // losingPool 200, distributable 180, each winner gets 100 + 180*(100/200) = 190
    expect(payouts.get('w1')).toBe(190)
    expect(payouts.get('w2')).toBe(190)
  })

  it('returns an empty map for no bets', () => {
    expect(computePariMutuelPayouts([], 'player_a').size).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/betting/settle.test.ts`
Expected: FAIL — `Cannot find module './settle'`

- [ ] **Step 3: Write the implementation**

```ts
// lib/betting/settle.ts
import { RAKE_RATE, type Side } from './market'

export type SettleBet = { id: string; side: Side; stakeAmount: number }

// Pure pari-mutuel split: the losing side's pool, minus the platform rake,
// is redistributed to winners proportional to their stake. Payouts are
// rounded down (Math.floor) to whole naira — wallets deal in integers, and
// under-paying by a fraction of a naira across many winners is preferable
// to a rounding-driven over-payment that could push the pool negative.
export function computePariMutuelPayouts(bets: SettleBet[], winningSide: Side): Map<string, number> {
  const payouts = new Map<string, number>()
  const winners = bets.filter((b) => b.side === winningSide)
  const losers = bets.filter((b) => b.side !== winningSide)
  const winningPool = winners.reduce((sum, b) => sum + b.stakeAmount, 0)
  const losingPool = losers.reduce((sum, b) => sum + b.stakeAmount, 0)

  for (const bet of losers) payouts.set(bet.id, 0)

  if (winningPool === 0) {
    // Nobody backed the actual winner — no payouts, losing pool isn't
    // redistributed since there's no one to redistribute it to.
    return payouts
  }

  const distributable = losingPool === 0 ? 0 : losingPool * (1 - RAKE_RATE)
  for (const bet of winners) {
    const payout = bet.stakeAmount + Math.floor(distributable * (bet.stakeAmount / winningPool))
    payouts.set(bet.id, payout)
  }
  return payouts
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/betting/settle.test.ts`
Expected: PASS, all 5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/betting/settle.ts lib/betting/settle.test.ts
git commit -m "feat(betting): add pari-mutuel payout settlement math"
```

---

### Task 4: Settlement and refund DB functions

**Files:**
- Modify: `lib/betting/settle.ts` (add to the file created in Task 3)

**Interfaces:**
- Consumes: `creditWallet` from `lib/wallet/service.ts`, `computePariMutuelPayouts` from Task 3.
- Produces: `settleMatchBets(admin, matchId, winningSide): Promise<void>`, `refundMatchBets(admin, matchId): Promise<void>` — consumed by Task 6 (`verify-actions.ts`, `admin-actions.ts`) and Task 7 (`voidBet`, which only refunds a single bet — see Task 7 for why it doesn't reuse `refundMatchBets`).

- [ ] **Step 1: Add the DB-touching functions**

Append to `lib/betting/settle.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { creditWallet } from '@/lib/wallet/service'

type Admin = SupabaseClient<Database>

// Called only from admin-confirmed outcomes (confirmResult, declareNoShowWinner,
// markBothNoShow) — never from a player's own submission.
export async function settleMatchBets(admin: Admin, matchId: string, winningSide: Side): Promise<void> {
  const { data: bets } = await admin
    .from('match_bets')
    .select('id, player_id, side, stake_amount')
    .eq('match_id', matchId)
    .eq('status', 'active')
  const active = bets ?? []
  if (active.length === 0) return

  const payouts = computePariMutuelPayouts(
    active.map((b) => ({ id: b.id, side: b.side as Side, stakeAmount: b.stake_amount })),
    winningSide,
  )
  const now = new Date().toISOString()

  for (const bet of active) {
    const payout = payouts.get(bet.id) ?? 0
    if (payout > 0) {
      await creditWallet(admin, bet.player_id, payout, 'bet_payout', bet.id)
      await admin.from('match_bets').update({ status: 'won', payout_amount: payout, settled_at: now }).eq('id', bet.id)
    } else {
      await admin.from('match_bets').update({ status: 'lost', payout_amount: 0, settled_at: now }).eq('id', bet.id)
    }
  }
}

// No real contest happened (no-show, forfeit, or a group-stage draw) — every
// active bet's stake is returned, no rake taken.
export async function refundMatchBets(admin: Admin, matchId: string): Promise<void> {
  const { data: bets } = await admin
    .from('match_bets')
    .select('id, player_id, stake_amount')
    .eq('match_id', matchId)
    .eq('status', 'active')
  const now = new Date().toISOString()
  for (const bet of bets ?? []) {
    await creditWallet(admin, bet.player_id, bet.stake_amount, 'bet_refund', bet.id)
    await admin.from('match_bets').update({ status: 'refunded', payout_amount: bet.stake_amount, settled_at: now }).eq('id', bet.id)
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors from `lib/betting/settle.ts`. If `Database['public']['Tables']['match_bets']` isn't recognized, regenerate types first: `npx supabase gen types typescript --project-id <project-id> > lib/supabase/types.ts` (per the command already documented in `CLAUDE.md`).

- [ ] **Step 3: Commit**

```bash
git add lib/betting/settle.ts
git commit -m "feat(betting): add settleMatchBets and refundMatchBets"
```

---

### Task 5: `placeBet` server action

**Files:**
- Create: `lib/betting/schema.ts`
- Create: `lib/betting/actions.ts`

**Interfaces:**
- Consumes: `bettingOpen` from Task 2, `debitWallet` from `lib/wallet/service.ts`.
- Produces: `placeBetSchema`, `BetState`, `placeBet(_prev, formData): Promise<BetState>` — consumed by Task 8 (`BettingPanel.tsx`).

- [ ] **Step 1: Write the schema**

```ts
// lib/betting/schema.ts
import { z } from 'zod'

export const placeBetSchema = z.object({
  matchId: z.string().uuid('Invalid match.'),
  side: z.enum(['player_a', 'player_b'], { errorMap: () => ({ message: 'Pick a side.' }) }),
  stakeAmount: z.coerce
    .number()
    .int('Stake must be a whole number of naira')
    .min(100, 'Minimum stake is ₦100')
    .max(50_000, 'Maximum stake is ₦50,000'),
})

export type PlaceBetInput = z.infer<typeof placeBetSchema>
```

- [ ] **Step 2: Write the server action**

```ts
// lib/betting/actions.ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { debitWallet, creditWallet } from '@/lib/wallet/service'
import { placeBetSchema } from './schema'
import { bettingOpen } from './market'

export type BetState = { error?: string; success?: boolean } | undefined

export async function placeBet(_prev: BetState, formData: FormData): Promise<BetState> {
  const parsed = placeBetSchema.safeParse({
    matchId: formData.get('matchId'),
    side: formData.get('side'),
    stakeAmount: formData.get('stakeAmount'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const { matchId, side, stakeAmount } = parsed.data

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in to place a bet.' }

  const admin = createAdminClient()
  const { data: match } = await admin
    .from('matches')
    .select('id, status, scheduled_at, betting_locked, player_a_id, player_b_id')
    .eq('id', matchId)
    .maybeSingle()
  if (!match) return { error: 'Match not found.' }
  if (user.id === match.player_a_id || user.id === match.player_b_id) {
    return { error: 'You cannot bet on your own match.' }
  }
  if (!bettingOpen(match)) return { error: 'Betting is closed for this match.' }

  const debit = await debitWallet(admin, user.id, stakeAmount, 'bet_stake', matchId)
  if (!debit.ok) return { error: debit.error }

  const { error: insertErr } = await admin
    .from('match_bets')
    .insert({ match_id: matchId, player_id: user.id, side, stake_amount: stakeAmount })
  if (insertErr) {
    // Undo the debit — the player must never lose money for a bet that
    // wasn't actually recorded. Mirrors the withdrawal-request rollback
    // pattern in lib/wallet/actions.ts.
    await creditWallet(admin, user.id, stakeAmount, 'bet_refund', matchId, 'Bet insert failed — auto-reversed')
    return { error: 'Could not place your bet. Please try again.' }
  }

  revalidatePath(`/matches/${matchId}`)
  revalidatePath('/betting')
  return { success: true }
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add lib/betting/schema.ts lib/betting/actions.ts
git commit -m "feat(betting): add placeBet server action"
```

---

### Task 6: Wire settlement into the existing admin result actions

**Files:**
- Modify: `lib/matches/verify-actions.ts:254-268` (inside `confirmResult`)
- Modify: `lib/matches/admin-actions.ts:200-211` (inside `declareNoShowWinner`)
- Modify: `lib/matches/admin-actions.ts:278-291` (inside `markBothNoShow`)

**Interfaces:**
- Consumes: `settleMatchBets`, `refundMatchBets` from `lib/betting/settle.ts` (Task 4).

- [ ] **Step 1: Wire `confirmResult`**

In `lib/matches/verify-actions.ts`, add the import:

```ts
import { settleMatchBets, refundMatchBets } from '@/lib/betting/settle'
```

Immediately after the existing score/status update block (right after the `if (upErr) return { ... }` check, before the `match_results` update that follows it), add:

```ts
  if (scoreA === scoreB) {
    // Knockout matches can't reach this point in a draw (rejected earlier
    // in this function) — this only fires for a group-stage draw, a push
    // with no side to redistribute the pool to.
    await refundMatchBets(admin, id)
  } else {
    const winningSide = scoreA > scoreB ? 'player_a' : 'player_b'
    await settleMatchBets(admin, id, winningSide)
  }
```

- [ ] **Step 2: Wire `declareNoShowWinner`**

In `lib/matches/admin-actions.ts`, add the import:

```ts
import { refundMatchBets } from '@/lib/betting/settle'
```

After the existing score/status update block in `declareNoShowWinner` (right after `if (upErr) return { ... }`), add:

```ts
  // A walkover isn't a real contest — refund rather than settle, so nobody
  // can profit from betting on the declared winner after the fact.
  await refundMatchBets(admin, id)
```

- [ ] **Step 3: Wire `markBothNoShow`**

In the same file, in `markBothNoShow`, after both branches of the `if (m.round === 'group') { ... } else { ... }` block (i.e. after `await syncMatchEvents(admin, id)` in that function), add:

```ts
  await refundMatchBets(admin, id)
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Manual verification**

Since these are DB-touching server actions with no existing unit-test pattern (consistent with the rest of `lib/matches/*-actions.ts`), verify manually against a test tournament once the UI (Task 8) exists: place bets on both sides of a scheduled match, confirm the result as admin, check both bettors' wallet balances changed correctly, and check a group-stage draw refunds instead of settling.

- [ ] **Step 6: Commit**

```bash
git add lib/matches/verify-actions.ts lib/matches/admin-actions.ts
git commit -m "feat(betting): settle or refund bets when admin resolves a match"
```

---

### Task 7: Admin actions — void a bet, lock betting early

**Files:**
- Create: `lib/betting/admin-actions.ts`

**Interfaces:**
- Consumes: `creditWallet` from `lib/wallet/service.ts`, `requireAdmin` from `lib/admin/auth.ts`.
- Produces: `VoidBetState`, `voidBet(_prev, formData)`, `LockBettingState`, `toggleBettingLocked(_prev, formData)` — consumed by Task 9 (`VoidBetsList.tsx`, `BettingLockToggle.tsx`).

- [ ] **Step 1: Write the actions**

```ts
// lib/betting/admin-actions.ts
'use server'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/admin/auth'
import { creditWallet } from '@/lib/wallet/service'

export type VoidBetState = { error?: string; success?: boolean } | undefined

// Voiding is per-bet, not per-match — unlike refundMatchBets (lib/betting/settle.ts),
// which refunds every active bet on a match because the whole contest didn't
// happen. This unwinds a single bet an admin judges to have been placed with
// insider knowledge, leaving everyone else's bets on the match untouched.
export async function voidBet(_prev: VoidBetState, formData: FormData): Promise<VoidBetState> {
  await requireAdmin()
  const betId = String(formData.get('betId') ?? '')
  const reason = String(formData.get('reason') ?? '').trim()
  if (!betId) return { error: 'Missing bet.' }
  if (!reason) return { error: 'Enter a reason for voiding this bet.' }

  const admin = createAdminClient()
  const { data: bet } = await admin
    .from('match_bets')
    .select('id, player_id, stake_amount, status')
    .eq('id', betId)
    .maybeSingle()
  if (!bet) return { error: 'Bet not found.' }
  if (bet.status !== 'active') return { error: 'This bet has already been settled and can no longer be voided.' }

  await creditWallet(admin, bet.player_id, bet.stake_amount, 'bet_refund', bet.id, reason)
  await admin.from('match_bets').update({ status: 'voided', voided_reason: reason }).eq('id', betId)

  revalidatePath('/admin/matches')
  return { success: true }
}

export type LockBettingState = { error?: string; success?: boolean } | undefined

export async function toggleBettingLocked(_prev: LockBettingState, formData: FormData): Promise<LockBettingState> {
  await requireAdmin()
  const matchId = String(formData.get('matchId') ?? '')
  if (!matchId) return { error: 'Missing match.' }

  const admin = createAdminClient()
  // One-way: this only ever sets betting_locked to true. There is no
  // "unlock" action — see the "Betting window" design discussion for why
  // reopening betting once it's closed recreates an insider-betting risk.
  const { error } = await admin.from('matches').update({ betting_locked: true }).eq('id', matchId)
  if (error) return { error: 'Could not lock betting. Please try again.' }

  revalidatePath(`/admin/matches/${matchId}/review`)
  revalidatePath(`/matches/${matchId}`)
  return { success: true }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add lib/betting/admin-actions.ts
git commit -m "feat(betting): add admin void-bet and lock-betting actions"
```

---

### Task 8: Betting panel on the Match Centre page

**Files:**
- Create: `components/match/BettingPanel.tsx`
- Modify: `app/(public)/matches/[id]/page.tsx`

**Interfaces:**
- Consumes: `placeBet`, `BetState` from Task 5; `bettingOpen`, `impliedPayoutMultiplier` from Task 2.

- [ ] **Step 1: Write the panel component**

```tsx
// components/match/BettingPanel.tsx
'use client'
import { useFormState } from 'react-dom'
import { placeBet, type BetState } from '@/lib/betting/actions'
import { impliedPayoutMultiplier, type SidePools } from '@/lib/betting/market'

export function BettingPanel({
  matchId,
  playerAName,
  playerBName,
  pools,
  myBets,
  disabledReason,
}: {
  matchId: string
  playerAName: string
  playerBName: string
  pools: SidePools
  myBets: { side: 'player_a' | 'player_b'; stakeAmount: number; status: string }[]
  disabledReason: string | null
}) {
  const [state, action] = useFormState<BetState, FormData>(placeBet, undefined)

  const multiplierA = impliedPayoutMultiplier(pools, 'player_a')
  const multiplierB = impliedPayoutMultiplier(pools, 'player_b')

  return (
    <div className="mb-6 rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <h3 className="mb-3 text-sm font-bold text-white">Place a bet</h3>

      {myBets.length > 0 && (
        <ul className="mb-4 space-y-1 text-xs text-slate-400">
          {myBets.map((b, i) => (
            <li key={i}>
              ₦{b.stakeAmount.toLocaleString()} on {b.side === 'player_a' ? playerAName : playerBName} — {b.status}
            </li>
          ))}
        </ul>
      )}

      {disabledReason ? (
        <p className="rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs text-slate-500">{disabledReason}</p>
      ) : (
        <form action={action} className="space-y-3">
          <input type="hidden" name="matchId" value={matchId} />
          <div className="grid grid-cols-2 gap-2">
            <label className="flex items-center gap-2 rounded-lg border border-slate-700 p-2 text-sm text-slate-300">
              <input type="radio" name="side" value="player_a" defaultChecked />
              {playerAName} · {multiplierA ? `${multiplierA.toFixed(2)}x` : '—'}
            </label>
            <label className="flex items-center gap-2 rounded-lg border border-slate-700 p-2 text-sm text-slate-300">
              <input type="radio" name="side" value="player_b" />
              {playerBName} · {multiplierB ? `${multiplierB.toFixed(2)}x` : '—'}
            </label>
          </div>
          <input
            type="number"
            name="stakeAmount"
            min={100}
            max={50000}
            placeholder="Stake (₦100 – ₦50,000)"
            required
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
          />
          {state?.error && <p className="text-xs text-red-400">{state.error}</p>}
          {state?.success && <p className="text-xs text-emerald-400">Bet placed.</p>}
          <button
            type="submit"
            className="w-full rounded-lg border border-violet-500/40 px-4 py-2 text-xs font-bold text-violet-400 hover:bg-violet-500/10"
          >
            Place bet
          </button>
        </form>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Wire it into the Match Centre page**

In `app/(public)/matches/[id]/page.tsx`, add imports:

```ts
import { BettingPanel } from '@/components/match/BettingPanel'
import { bettingOpen } from '@/lib/betting/market'
```

After fetching `m` (the match row), add a block that loads pool totals and the current user's bets, and computes whether the panel should render disabled:

```ts
  const { data: betRows } = await supabase
    .from('match_bets')
    .select('side, stake_amount, status, player_id')
    .eq('match_id', m.id)
  const bets = (betRows ?? []) as { side: 'player_a' | 'player_b'; stake_amount: number; status: string; player_id: string }[]
  const pools = {
    playerA: bets.filter((b) => b.side === 'player_a' && b.status !== 'voided' && b.status !== 'refunded').reduce((s, b) => s + b.stake_amount, 0),
    playerB: bets.filter((b) => b.side === 'player_b' && b.status !== 'voided' && b.status !== 'refunded').reduce((s, b) => s + b.stake_amount, 0),
  }
  const myBets = user ? bets.filter((b) => b.player_id === user.id).map((b) => ({ side: b.side, stakeAmount: b.stake_amount, status: b.status })) : []
  const bettingDisabledReason = isParticipant
    ? 'You cannot bet on your own match.'
    : !bettingOpen({ status: m.status, scheduled_at: m.scheduled_at, betting_locked: (m as { betting_locked?: boolean }).betting_locked ?? false })
      ? 'Betting is closed for this match.'
      : null
```

Add `betting_locked` to `MATCH_SELECT` and the `MatchRow` type at the top of the file (`betting_locked: boolean`). Then render the panel — placed after the "Result confirmed banner" block and before the check-in panel:

```tsx
      <BettingPanel
        matchId={m.id}
        playerAName={nameOf(m.player_a)}
        playerBName={nameOf(m.player_b)}
        pools={pools}
        myBets={myBets}
        disabledReason={bettingDisabledReason}
      />
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Manual verification**

Run `npm run dev`, open a scheduled match's Match Centre page as a logged-in non-participant, place a ₦100 bet, confirm the wallet balance drops and the bet shows in "myBets". Log in as one of the two match participants and confirm the panel shows the disabled reason instead of the form.

- [ ] **Step 5: Commit**

```bash
git add components/match/BettingPanel.tsx "app/(public)/matches/[id]/page.tsx"
git commit -m "feat(betting): add betting panel to the Match Centre page"
```

---

### Task 9: Admin — void bets and lock-betting toggle on the review page

**Files:**
- Create: `components/admin/VoidBetsList.tsx`
- Create: `components/admin/BettingLockToggle.tsx`
- Modify: `app/admin/matches/[id]/review/page.tsx`

**Interfaces:**
- Consumes: `voidBet`, `VoidBetState`, `toggleBettingLocked`, `LockBettingState` from Task 7.

- [ ] **Step 1: Write `VoidBetsList`**

```tsx
// components/admin/VoidBetsList.tsx
'use client'
import { useFormState } from 'react-dom'
import { voidBet, type VoidBetState } from '@/lib/betting/admin-actions'

function VoidBetRow({ bet }: { bet: { id: string; playerName: string; side: 'player_a' | 'player_b'; stakeAmount: number }; playerAName: string; playerBName: string }) {
  const [state, action] = useFormState<VoidBetState, FormData>(voidBet, undefined)
  if (state?.success) {
    return <p className="text-xs text-emerald-400">✓ Voided and refunded.</p>
  }
  return (
    <form action={action} className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950 p-2 text-xs">
      <input type="hidden" name="betId" value={bet.id} />
      <span className="flex-1 text-slate-300">
        {bet.playerName} — ₦{bet.stakeAmount.toLocaleString()} on {bet.side}
      </span>
      <input
        name="reason"
        placeholder="Reason"
        required
        className="w-32 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200 placeholder:text-slate-600"
      />
      <button type="submit" className="rounded border border-red-500/40 px-2 py-1 font-bold text-red-400 hover:bg-red-500/10">
        Void
      </button>
      {state?.error && <span className="text-red-400">{state.error}</span>}
    </form>
  )
}

export function VoidBetsList({
  bets,
}: {
  bets: { id: string; playerName: string; side: 'player_a' | 'player_b'; stakeAmount: number }[]
}) {
  if (bets.length === 0) return null
  return (
    <div className="mt-4 space-y-2">
      <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Active bets</h3>
      {bets.map((bet) => (
        <VoidBetRow key={bet.id} bet={bet} playerAName="" playerBName="" />
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Write `BettingLockToggle`**

```tsx
// components/admin/BettingLockToggle.tsx
'use client'
import { useFormState } from 'react-dom'
import { toggleBettingLocked, type LockBettingState } from '@/lib/betting/admin-actions'

export function BettingLockToggle({ matchId, alreadyLocked }: { matchId: string; alreadyLocked: boolean }) {
  const [state, action] = useFormState<LockBettingState, FormData>(toggleBettingLocked, undefined)
  if (alreadyLocked || state?.success) {
    return <p className="text-xs text-slate-500">Betting locked.</p>
  }
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="matchId" value={matchId} />
      <button type="submit" className="rounded-lg border border-amber-500/40 px-3 py-1.5 text-xs font-bold text-amber-400 hover:bg-amber-500/10">
        Lock betting now
      </button>
      {state?.error && <span className="text-xs text-red-400">{state.error}</span>}
    </form>
  )
}
```

- [ ] **Step 3: Wire both into the review page**

In `app/admin/matches/[id]/review/page.tsx`, add imports:

```ts
import { VoidBetsList } from '@/components/admin/VoidBetsList'
import { BettingLockToggle } from '@/components/admin/BettingLockToggle'
```

Extend the match query's select to include `betting_locked`, and add a separate query for active bets (after the existing `subs` query):

```ts
  const { data: betRows } = await supabase
    .from('match_bets')
    .select('id, stake_amount, side, player:profiles!match_bets_player_id_fkey(username, display_name)')
    .eq('match_id', params.id)
    .eq('status', 'active')
  const activeBets = ((betRows ?? []) as { id: string; stake_amount: number; side: 'player_a' | 'player_b'; player: ProfileRef }[]).map((b) => ({
    id: b.id,
    playerName: nameOf(b.player),
    side: b.side,
    stakeAmount: b.stake_amount,
  }))
```

Render near the top of the returned JSX, after the status line:

```tsx
      <BettingLockToggle matchId={m.id} alreadyLocked={(m as { betting_locked?: boolean }).betting_locked ?? false} />
      <VoidBetsList bets={activeBets} />
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Manual verification**

Open `/admin/matches/[id]/review` for a match with active bets, void one, confirm the bettor's wallet is credited back and the bet disappears from the list. Click "Lock betting now" on a scheduled match, confirm its Match Centre betting panel now shows the disabled state.

- [ ] **Step 6: Commit**

```bash
git add components/admin/VoidBetsList.tsx components/admin/BettingLockToggle.tsx "app/admin/matches/[id]/review/page.tsx"
git commit -m "feat(betting): add admin void-bet and lock-betting UI"
```

---

### Task 10: `/betting` hub page

**Files:**
- Create: `app/(public)/betting/page.tsx`

**Interfaces:**
- Consumes: `bettingOpen` from Task 2.

- [ ] **Step 1: Write the hub page**

```tsx
// app/(public)/betting/page.tsx
import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { bettingOpen } from '@/lib/betting/market'
import { buildMetadata } from '@/lib/seo/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Betting — Sentinel X',
  description: 'Bet on open Sentinel X matches.',
  path: '/betting',
})

type ProfileRef = { username: string | null; display_name: string | null } | null
function nameOf(p: ProfileRef): string {
  return p?.display_name ?? p?.username ?? 'TBD'
}

export default async function BettingHubPage() {
  const supabase = createClient()
  const { data } = await supabase
    .from('matches')
    .select(
      'id, scheduled_at, betting_locked, status, ' +
        'tournaments(title), ' +
        'player_a:profiles!matches_player_a_id_fkey(username, display_name), ' +
        'player_b:profiles!matches_player_b_id_fkey(username, display_name)',
    )
    .eq('status', 'scheduled')
    .not('player_a_id', 'is', null)
    .not('player_b_id', 'is', null)
    .order('scheduled_at')

  type Row = {
    id: string
    scheduled_at: string | null
    betting_locked: boolean
    status: string
    tournaments: { title: string } | null
    player_a: ProfileRef
    player_b: ProfileRef
  }
  const open = ((data ?? []) as Row[]).filter((m) => bettingOpen(m))

  return (
    <div className="mx-auto max-w-3xl px-4 pb-20 pt-6">
      <h1 className="mb-4 text-xl font-black text-white">Open for betting</h1>
      {open.length === 0 ? (
        <p className="text-sm text-slate-500">No matches open for betting right now.</p>
      ) : (
        <ul className="space-y-2">
          {open.map((m) => (
            <li key={m.id}>
              <Link
                href={`/matches/${m.id}`}
                className="block rounded-xl border border-slate-800 bg-slate-900 p-4 hover:border-slate-600"
              >
                <p className="text-xs text-slate-500">{m.tournaments?.title ?? 'Sentinel X'}</p>
                <p className="text-sm font-bold text-white">
                  {nameOf(m.player_a)} vs {nameOf(m.player_b)}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Manual verification**

Run `npm run dev`, visit `/betting`, confirm it lists only matches that are currently scheduled and not locked/past their scheduled time.

- [ ] **Step 4: Commit**

```bash
git add "app/(public)/betting/page.tsx"
git commit -m "feat(betting): add /betting hub page"
```

---

## Self-Review Notes

- **Spec coverage:** data model (Task 1), betting window incl. manual lock (Tasks 2, 7), pari-mutuel settlement incl. rake/one-sided-pool/no-show-refund/draw-refund (Tasks 3, 4, 6), stake limits + self-bet block (Task 5), void action (Task 7, 9), hub + Match Centre panel (Tasks 8, 10) — all covered.
- **Placeholder scan:** none — every step has runnable code.
- **Type consistency:** `Side = 'player_a' | 'player_b'` defined once in `lib/betting/market.ts` and imported everywhere else that needs it (`settle.ts`, `actions.ts` implicitly via the schema enum, UI components) rather than redefined per file.
