# SX Coin Economy Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the three Phase 3 coin economy features — entry-fee discount, community wagering, post boost — on top of the existing Phase 2 SX Coins system, plus the shared `lib/coins/value.ts` constants and cash-disclaimer tooltip they all depend on.

**Architecture:** Every new coin movement goes through one renamed ledger function, `recordCoinTransaction()` (renamed from the existing `awardCoins()`, same signature/behavior — the codebase's one and only writer of `sx_coins` + `sx_coin_transactions`). Entry discount extends the existing `registerForTournament` Server Action with a pre-Paystack coin-deduction branch. Community wagering is a new `match_wagers`/`platform_coin_reserve` pair modeled directly on the existing naira `match_bets`/`lib/betting/` system (same pari-mutuel shape, coins instead of naira, 5% fee instead of 10%), wired into `confirmResult`/`disputeResult`/`declareNoShowWinner`/`markBothNoShow` exactly where those functions already settle/refund `match_bets`. Post boost is a single new column plus a feed-ordering tweak.

**Tech Stack:** Next.js 14 App Router Server Actions, Supabase (Postgres + RLS + service-role admin client), Zod, vitest.

**Spec:** `docs/superpowers/specs/2026-08-15-coin-economy-extension.md` — this plan implements §2 (value system), §4 (entry discount), §5 (wagering), §6 (post boost), §7 (disclaimer). Read both together; this plan resolves every gap between the spec's prose and the real schema (documented inline per task below).

## Global Constraints

- **Coins never convert to Naira anywhere in this codebase** (spec §1) — no UI, no Server Action, no admin tool may show or compute a coins→cash payout.
- Every coin price shown in the UI must display its naira equivalent derived from `lib/coins/value.ts` constants — never a hardcoded naira figure next to a coin amount.
- All coin ledger writes go through `recordCoinTransaction()` (`lib/coins/service.ts`) — never a hand-rolled `sx_coins`/`sx_coin_transactions` write (per user instruction; the sole existing exception, `purchaseStoreItem` in `lib/coins/actions.ts`, predates this rule and is left untouched — out of scope for this plan).
- `recordCoinTransaction()` clamps at 0 and does **not** reject an over-large deduction — callers that spend coins must check `getCoinBalance()` first and return a user-facing error before calling it (mirrors the existing `decidePurchase` pattern in `lib/coins/actions.ts`).
- All Paystack payment amount calculation happens server-side — never trust a client-submitted fee or discount value (CLAUDE.md rule #4).
- Bracket/group-table updates only ever happen after admin confirms a result — wagering must never write to `matches`/`group_memberships` itself (CLAUDE.md rule #5).
- Wager settlement (`settleMatchWagers`) is called non-blocking (try/catch, logged, never rolls back the match result) — same pattern as the existing `onMatchConfirmed` feed-hook call in `confirmResult` (`lib/matches/verify-actions.ts:404-409`). Wager *refunds* (dispute/no-show/draw) are called the same way the existing `refundMatchBets` calls are today — plain, unwrapped — for parity with the naira system.
- Apply every migration in this plan via the Supabase MCP tool (`mcp__claude_ai_Supabase__apply_migration`, project id `itxubrkbropttfdackmi`), not the local CLI — the CLI has a known intermittent Windows TLS connectivity gap (see project memory). Regenerate `lib/supabase/types.ts` via `mcp__claude_ai_Supabase__generate_typescript_types` after each migration and commit the diff in the same task.
- Mobile-first, Server Components by default, `'use client'` only where interactivity is needed (CLAUDE.md rules #1, #8).

---

### Task 1: `lib/coins/value.ts` — coin/naira constants

**Files:**
- Create: `lib/coins/value.ts`
- Test: `lib/coins/value.test.ts`

**Interfaces:**
- Produces: `COINS_PER_NAIRA`, `NAIRA_PER_COIN`, `COINS_PER_ENTRY`, `COINS_HALF_ENTRY` (numbers), `coinsToNaira(coins: number): number`, `formatCoins(coins: number): string` — every later task imports these instead of hardcoding a rate.

- [ ] **Step 1: Write the failing test**

```ts
// lib/coins/value.test.ts
import { describe, it, expect } from 'vitest'
import { COINS_PER_NAIRA, NAIRA_PER_COIN, COINS_PER_ENTRY, COINS_HALF_ENTRY, coinsToNaira, formatCoins } from './value'

describe('coin value constants', () => {
  it('are internally consistent (1 coin = ₦0.50, 2 coins = ₦1)', () => {
    expect(NAIRA_PER_COIN).toBe(0.5)
    expect(COINS_PER_NAIRA).toBe(2)
    expect(COINS_PER_NAIRA * NAIRA_PER_COIN).toBe(1)
  })

  it('anchors full/half tournament entry to ₦500/₦250', () => {
    expect(coinsToNaira(COINS_PER_ENTRY)).toBe(500)
    expect(coinsToNaira(COINS_HALF_ENTRY)).toBe(250)
  })
})

describe('formatCoins', () => {
  it('shows the coin amount with its naira equivalent', () => {
    expect(formatCoins(500)).toBe('500 coins (₦250)')
    expect(formatCoins(200)).toBe('200 coins (₦100)')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/coins/value.test.ts`
Expected: FAIL — `Cannot find module './value'`

- [ ] **Step 3: Write the implementation**

```ts
// lib/coins/value.ts
// Anchor rate for the entire SX Coin economy (spec §2,
// docs/superpowers/specs/2026-08-15-coin-economy-extension.md). Every coin
// price or earn amount shown anywhere in the UI must derive from these
// constants — never hardcode a naira figure next to a coin amount. Fixed at
// the platform level, not adjustable per-player or per-tournament.
export const COINS_PER_NAIRA = 2 // 2 coins = ₦1
export const NAIRA_PER_COIN = 0.5 // 1 coin = ₦0.50
export const COINS_PER_ENTRY = 1000 // full tournament entry (1,000 coins = ₦500)
export const COINS_HALF_ENTRY = 500 // half-price entry (500 coins = ₦250)

// Every coin amount this platform actually offers is a multiple of 2, so the
// naira equivalent is always a whole naira — Math.round is a no-op safety
// net, not a source of drift.
export function coinsToNaira(coins: number): number {
  return Math.round(coins * NAIRA_PER_COIN)
}

// "500 coins (₦250)" — the one place this string is built, so every coin
// price in the UI reads identically (store, entry discount, wager, boost).
export function formatCoins(coins: number): string {
  return `${coins.toLocaleString()} coins (₦${coinsToNaira(coins).toLocaleString('en-NG')})`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/coins/value.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/coins/value.ts lib/coins/value.test.ts
git commit -m "feat(coins): add coin/naira value constants" -m "$(printf 'Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>')"
```

---

### Task 2: Rename `awardCoins` → `recordCoinTransaction`; fix the `sx_coin_transactions.source` CHECK constraint

**Context:** `lib/community/challenges.ts:81` and `lib/community/admin-actions.ts:105,159` already call `awardCoins(..., 'weekly_challenge' | 'best_play_winner' | 'best_play_runner_up', ...)` — none of those three source strings are in the live `sx_coin_transactions_source_check` constraint (verified directly against the production DB: `CHECK (source = ANY (ARRAY['match_played','match_won','tournament_placation','daily_login','login_streak','achievement_unlocked','store_purchase','community_activity','admin_grant','admin_deduct']))`). Those calls are silently failing today. This task fixes that bug in the same migration that adds the new Phase 3 sources this extension needs.

**Files:**
- Create: `supabase/migrations/057_coin_transaction_sources.sql`
- Modify: `lib/coins/service.ts` (rename `awardCoins` → `recordCoinTransaction`)
- Modify: `lib/coins/service.test.ts`
- Modify: `lib/matches/economy-hooks.ts`
- Modify: `lib/community/admin-actions.ts`
- Modify: `lib/community/challenges.ts`
- Modify: `lib/matches/season-points.ts`
- Modify: `lib/login/actions.ts`
- Modify: `lib/admin/player-economy-actions.ts`
- Modify: `lib/achievements/unlock.ts`

**Interfaces:**
- Produces: `recordCoinTransaction(admin: Admin, playerId: string, amount: number, source: string, referenceId: string | null, description?: string): Promise<number>` — identical signature/behavior to the old `awardCoins`, just renamed. Every later task in this plan calls this, never `awardCoins`.

- [ ] **Step 1: Apply the migration (via Supabase MCP, not the CLI)**

```sql
-- supabase/migrations/057_coin_transaction_sources.sql
-- Extends sx_coin_transactions.source to cover sources already written by
-- merged Phase 3 social-feed code with no matching CHECK value
-- (weekly_challenge, best_play_winner, best_play_runner_up — those inserts
-- have been failing this constraint since that feature merged), plus every
-- new source this coin-economy extension adds.
ALTER TABLE public.sx_coin_transactions
  DROP CONSTRAINT sx_coin_transactions_source_check;

ALTER TABLE public.sx_coin_transactions
  ADD CONSTRAINT sx_coin_transactions_source_check CHECK (source IN (
    'match_played', 'match_won', 'tournament_placement',
    'daily_login', 'login_streak', 'achievement_unlocked',
    'store_purchase', 'community_activity',
    'admin_grant', 'admin_deduct',
    'weekly_challenge', 'best_play_winner', 'best_play_runner_up',
    'entry_discount', 'entry_discount_refund',
    'wager_stake', 'wager_won', 'wager_refund',
    'post_boost'
  ));
```

Apply with `mcp__claude_ai_Supabase__apply_migration` (project id `itxubrkbropttfdackmi`, name `coin_transaction_sources`), then regenerate types with `mcp__claude_ai_Supabase__generate_typescript_types` and overwrite `lib/supabase/types.ts`.

- [ ] **Step 2: Rename the function in `lib/coins/service.ts`**

```ts
// lib/coins/service.ts — only the export name changes; body is unchanged.
export async function recordCoinTransaction(
  admin: Admin,
  playerId: string,
  amount: number,
  source: string,
  referenceId: string | null,
  description?: string,
): Promise<number> {
  // ...unchanged body...
}
```

- [ ] **Step 3: Update every call site's import + call name**

In each of these files, change `import { awardCoins } from '@/lib/coins/service'` → `import { recordCoinTransaction } from '@/lib/coins/service'` and every `awardCoins(` call → `recordCoinTransaction(`:
- `lib/matches/economy-hooks.ts` (2 call sites, lines 37 and 43)
- `lib/community/admin-actions.ts` (2 call sites, lines 105 and 159)
- `lib/community/challenges.ts` (1 call site, line 81)
- `lib/matches/season-points.ts` (1 call site, line 108)
- `lib/login/actions.ts` (2 call sites, lines 38 and 42/45)
- `lib/admin/player-economy-actions.ts` (2 call sites, lines 28 and 50)
- `lib/achievements/unlock.ts` (1 call site, line 58)

- [ ] **Step 4: Update `lib/coins/service.test.ts`**

```ts
// lib/coins/service.test.ts — rename the import and every call; test bodies,
// assertions, and the fakeAdmin() helper are otherwise unchanged.
import { describe, it, expect } from 'vitest'
import { recordCoinTransaction, getCoinBalance } from './service'

// ...fakeAdmin() helper unchanged...

describe('getCoinBalance', () => {
  it('returns 0 for a player with no wallet row yet', async () => {
    const { client } = fakeAdmin(null)
    expect(await getCoinBalance(client as never, 'p1')).toBe(0)
  })
})

describe('recordCoinTransaction', () => {
  it('creates a wallet row lazily and logs the ledger row', async () => {
    const { client, upserts, inserts } = fakeAdmin(null)
    const newBalance = await recordCoinTransaction(client as never, 'p1', 20, 'match_played', 'm1')
    expect(newBalance).toBe(20)
    expect(upserts[0]).toMatchObject({ player_id: 'p1', balance: 20, total_earned: 20, total_spent: 0 })
    expect(inserts[0]).toMatchObject({ player_id: 'p1', amount: 20, balance_after: 20, source: 'match_played', reference_id: 'm1' })
  })

  it('adds to an existing balance', async () => {
    const { client } = fakeAdmin({ balance: 100, total_earned: 100, total_spent: 0 })
    const newBalance = await recordCoinTransaction(client as never, 'p1', 30, 'match_won', 'm1')
    expect(newBalance).toBe(130)
  })

  it('supports negative amounts for admin deductions without going below 0', async () => {
    const { client } = fakeAdmin({ balance: 40, total_earned: 100, total_spent: 60 })
    const newBalance = await recordCoinTransaction(client as never, 'p1', -100, 'admin_deduct', null)
    expect(newBalance).toBe(0)
  })
})
```

- [ ] **Step 5: Run the full test suite to confirm nothing else references `awardCoins`**

Run: `npx vitest run` then `grep -rn "awardCoins" lib/ app/ --include=*.ts --include=*.tsx`
Expected: all tests PASS; the grep returns no results.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/057_coin_transaction_sources.sql lib/supabase/types.ts lib/coins/service.ts lib/coins/service.test.ts lib/matches/economy-hooks.ts lib/community/admin-actions.ts lib/community/challenges.ts lib/matches/season-points.ts lib/login/actions.ts lib/admin/player-economy-actions.ts lib/achievements/unlock.ts
git commit -m "fix(coins): rename awardCoins to recordCoinTransaction; extend source CHECK constraint" -m "$(printf 'Fixes weekly_challenge/best_play_* coin awards that were silently failing the old CHECK constraint.\n\nCo-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>')"
```

---

### Task 3: `tournament_registrations` coin-discount columns + registration schema

**Files:**
- Create: `supabase/migrations/058_tournament_registration_coin_discount.sql`
- Modify: `lib/tournaments/registration-schema.ts`

**Interfaces:**
- Produces: `tournament_registrations.coins_used`, `tournament_registrations.coin_discount_naira` columns (both `integer NOT NULL DEFAULT 0`). `coinDiscountTierSchema` — zod schema validating the radio value as `0 | 500 | 1000`.

- [ ] **Step 1: Apply the migration**

```sql
-- supabase/migrations/058_tournament_registration_coin_discount.sql
-- Spec §4 — a player may apply an SX Coin discount at registration. Coins
-- deducted, never a naira value trusted from the client: coin_discount_naira
-- is always server-computed as coins_used * NAIRA_PER_COIN and stored here
-- so confirmRegistration's Paystack-amount check (lib/tournaments/confirm.ts)
-- can verify the discounted amount instead of the full registration_fee.
ALTER TABLE public.tournament_registrations
  ADD COLUMN coins_used integer NOT NULL DEFAULT 0,
  ADD COLUMN coin_discount_naira integer NOT NULL DEFAULT 0;
```

Apply via `mcp__claude_ai_Supabase__apply_migration` (name `tournament_registration_coin_discount`), then regenerate `lib/supabase/types.ts`.

- [ ] **Step 2: Extend the registration schema**

```ts
// lib/tournaments/registration-schema.ts
import { z } from 'zod'
import { COINS_HALF_ENTRY, COINS_PER_ENTRY } from '@/lib/coins/value'

export const registrationDetailsSchema = z.object({
  displayName: z.string().trim().min(1, 'Display name is required').max(60, 'Display name is too long'),
  whatsapp: z
    .string()
    .trim()
    .min(1, 'WhatsApp number is required')
    .regex(/^\+?[0-9]{10,15}$/, 'Enter a valid WhatsApp number'),
  clubName: z.string().trim().min(1, 'Club name is required').max(60, 'Club name is too long'),
  ignTag: z.union([z.literal(''), z.string().trim().max(60, 'In-game player ID / tag is too long')]),
})

export type RegistrationDetailsInput = z.infer<typeof registrationDetailsSchema>

// The three radio positions on the entry-fee discount widget (spec §4). '0'
// means no discount applied — the default, pre-existing behavior.
export const coinsUsedSchema = z
  .union([z.literal('0'), z.literal(String(COINS_HALF_ENTRY)), z.literal(String(COINS_PER_ENTRY))])
  .default('0')
  .transform(Number)
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/058_tournament_registration_coin_discount.sql lib/supabase/types.ts lib/tournaments/registration-schema.ts
git commit -m "feat(tournaments): add coin-discount columns and schema for entry-fee registration" -m "$(printf 'Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>')"
```

---

### Task 4: Entry-fee discount — `registerForTournament` logic + Paystack amount fix

**Context:** `registerForTournament` (`lib/tournaments/actions.ts`) already has three paths before the Paystack branch: a fee-waiver redemption, a ₦0-tournament free path, and the paid Paystack path. The coin discount sits as a fourth branch, applicable only when the fee is ≥ ₦500, there is no active waiver, and the tournament isn't ₦0 — matching spec §4's "Discount applies to any tournament with an entry fee of ₦500 or more" / "Free tournaments (₦0 entry): discount not applicable" rules exactly. **Critical fix bundled in:** `confirmRegistration` (`lib/tournaments/confirm.ts`) currently computes `expectedKobo = tournament.registration_fee * 100` with no knowledge of a discount — a half-price registration's Paystack payment would fail its own underpayment check without this fix.

**Files:**
- Modify: `lib/tournaments/actions.ts`
- Modify: `lib/tournaments/confirm.ts`
- Test: `lib/tournaments/confirm.test.ts` (extend existing)

**Interfaces:**
- Consumes: `recordCoinTransaction`, `getCoinBalance` (`lib/coins/service.ts`); `coinsUsedSchema` (Task 3); `COINS_HALF_ENTRY`, `COINS_PER_ENTRY`, `NAIRA_PER_COIN` (`lib/coins/value.ts`).
- Produces: `registerForTournament` now reads a `coinsUsed` form field (`'0' | '500' | '1000'`); `decideConfirmation`'s `expectedKobo` argument is now computed by the caller as `(registration_fee - coin_discount_naira) * 100`.

- [ ] **Step 1: Write the failing test for the Paystack amount fix**

```ts
// lib/tournaments/confirm.test.ts — add to the existing describe('decideConfirmation', ...) block
it('accepts a half-price payment when expectedKobo already reflects the coin discount', () => {
  const result = decideConfirmation({
    existing: { payment_status: 'pending' },
    verify: { status: 'success', amountKobo: 25000 }, // ₦250
    expectedKobo: 25000, // registration_fee ₦500 - coin_discount_naira ₦250, computed by the caller
  })
  expect(result).toBe('confirmed')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/tournaments/confirm.test.ts`
Expected: PASS already — `decideConfirmation` is a pure function of its arguments and already handles this correctly. This step exists to lock in the contract before the caller change in Step 4; confirm it passes, then proceed.

- [ ] **Step 3: Fix `confirmRegistration`'s `expectedKobo` computation**

```ts
// lib/tournaments/confirm.ts
export async function confirmRegistration(reference: string): Promise<ConfirmResult> {
  const db = createAdminClient()

  const { data: existing } = await db
    .from('tournament_registrations')
    .select('id, payment_status, player_id, fee_waived, coin_discount_naira, tournament:tournaments(title, registration_fee)')
    .eq('paystack_reference', reference)
    .maybeSingle()

  if (!existing) return 'not_found'
  if (existing.payment_status === 'paid') return 'already_paid'

  const tv = existing.tournament as
    | { title: string; registration_fee: number }
    | { title: string; registration_fee: number }[]
    | null
  const tournamentInfo = Array.isArray(tv) ? tv[0] : tv
  // A discounted registration's Paystack checkout was opened for
  // registration_fee - coin_discount_naira (see registerForTournament) — the
  // underpayment check below must expect that same reduced amount, or a
  // legitimately discounted half-price payment fails verification.
  const expectedKobo = ((tournamentInfo?.registration_fee ?? 0) - (existing.coin_discount_naira ?? 0)) * 100

  // ...rest of the function is unchanged from here...
```

- [ ] **Step 4: Add the coin-discount branch to `registerForTournament`**

```ts
// lib/tournaments/actions.ts
'use server'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { initializeTransaction, buildReference } from '@/lib/paystack/server'
import { checkCanRegister } from './guard'
import { registrationDetailsSchema, coinsUsedSchema } from './registration-schema'
import { getCoinBalance, recordCoinTransaction } from '@/lib/coins/service'
import { NAIRA_PER_COIN } from '@/lib/coins/value'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sentinelx.gg'

export type RegisterState = { error?: string } | undefined

export async function registerForTournament(
  _prev: RegisterState,
  formData: FormData,
): Promise<RegisterState> {
  const tournamentId = String(formData.get('tournamentId') ?? '')
  if (!tournamentId) return { error: 'Missing tournament.' }

  const parsed = registrationDetailsSchema.safeParse({
    displayName: formData.get('displayName') ?? '',
    whatsapp: formData.get('whatsapp') ?? '',
    clubName: formData.get('clubName') ?? '',
    ignTag: formData.get('ignTag') ?? '',
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const coinsUsedParsed = coinsUsedSchema.safeParse(formData.get('coinsUsed') ?? '0')
  const coinsUsed = coinsUsedParsed.success ? coinsUsedParsed.data : 0

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in to register.' }

  // Re-fetch server-side; never trust the client for status, capacity, or rules.
  const { data: tournament } = await supabase
    .from('tournaments')
    .select('id, slug, status, max_players, rules, registration_fee, invitation_only')
    .eq('id', tournamentId)
    .maybeSingle()
  if (!tournament) return { error: 'Tournament not found.' }

  // Only proves the checkbox was ticked at submit time — there is no way to
  // verify a player actually read the rules, and this deliberately doesn't try.
  if (tournament.rules && formData.get('agreedToRules') !== 'true') {
    return { error: 'Please confirm you have read and agree to the rules.' }
  }

  const { count: paidCount } = await supabase
    .from('tournament_registrations')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
    .eq('payment_status', 'paid')

  const { data: existing } = await supabase
    .from('tournament_registrations')
    .select('id, payment_status')
    .eq('tournament_id', tournamentId)
    .eq('player_id', user.id)
    .maybeSingle()

  const guard = checkCanRegister({
    status: tournament.status,
    paidCount: paidCount ?? 0,
    maxPlayers: tournament.max_players,
    existingStatus: existing?.payment_status ?? null,
    invitationOnly: tournament.invitation_only,
  })
  if (!guard.ok) {
    return {
      error:
        guard.reason === 'already_registered'
          ? "You're already registered for this tournament."
          : guard.reason === 'full'
            ? 'This tournament is full.'
            : guard.reason === 'invitation_only'
              ? 'This tournament is invitation-only. Check your dashboard for an invite.'
              : 'Registration is closed for this tournament.',
    }
  }

  const regFields = {
    reg_display_name: parsed.data.displayName,
    reg_whatsapp: parsed.data.whatsapp,
    reg_club_name: parsed.data.clubName,
    reg_ign_tag: parsed.data.ignTag || null,
  }

  const admin = createAdminClient()

  // A live (unredeemed) waiver skips Paystack entirely — takes priority over
  // any coin discount the player may also have selected (waiver already
  // means ₦0 due; spending coins on top would be pointless, so coinsUsed is
  // simply ignored on this path, matching spec §4's "maximum one discount
  // tier" intent).
  const { data: waiver } = await admin
    .from('tournament_fee_waivers')
    .select('id')
    .eq('tournament_id', tournamentId)
    .eq('player_id', user.id)
    .is('redeemed_at', null)
    .maybeSingle()

  if (waiver) {
    const { data: redeemed } = await admin
      .from('tournament_fee_waivers')
      .update({ redeemed_at: new Date().toISOString() })
      .eq('id', waiver.id)
      .is('redeemed_at', null)
      .select('id')
    if (!redeemed || redeemed.length === 0) {
      return { error: 'This free-entry grant is no longer available. Please try again or contact an admin.' }
    }

    const freeRegRow = {
      tournament_id: tournamentId,
      player_id: user.id,
      payment_status: 'paid',
      fee_waived: true,
      paystack_reference: null,
      ...regFields,
    }
    if (!existing) {
      const { error: insertErr } = await admin.from('tournament_registrations').insert(freeRegRow)
      if (insertErr) return { error: 'Could not complete registration. Please try again.' }
    } else {
      await admin
        .from('tournament_registrations')
        .update({ payment_status: 'paid', fee_waived: true, paystack_reference: null, ...regFields })
        .eq('id', existing.id)
    }

    redirect(`/tournaments/${tournament.slug}?paid=1`)
  }

  // A zero-fee tournament needs no payment and no discount — spec §4: "Free
  // tournaments (₦0 entry): discount not applicable."
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

  // Coin discount — spec §4. Only reachable once fee > 0 and there was no
  // waiver. Discount only applies at ₦500+; a malformed/forged coinsUsed on
  // a cheaper tournament is simply ignored rather than erroring, since the
  // UI never offers the radio below ₦500 in the first place.
  let coinDiscountNaira = 0
  if (coinsUsed > 0 && tournament.registration_fee >= 500) {
    const balance = await getCoinBalance(admin, user.id)
    if (balance < coinsUsed) return { error: 'Not enough SX Coins for this discount.' }
    coinDiscountNaira = Math.round(coinsUsed * NAIRA_PER_COIN)
    await recordCoinTransaction(admin, user.id, -coinsUsed, 'entry_discount', tournamentId, `Tournament entry discount — ${tournament.slug}`)
  }
  const netFee = tournament.registration_fee - coinDiscountNaira

  // Free entry (1,000 coins): the discount already brought the fee to ₦0 —
  // confirm registration immediately, skip Paystack entirely (spec §4).
  if (netFee <= 0) {
    const freeRegRow = {
      tournament_id: tournamentId,
      player_id: user.id,
      payment_status: 'paid',
      fee_waived: false,
      paystack_reference: null,
      coins_used: coinsUsed,
      coin_discount_naira: coinDiscountNaira,
      ...regFields,
    }
    if (!existing) {
      const { error: insertErr } = await admin.from('tournament_registrations').insert(freeRegRow)
      if (insertErr) return { error: 'Could not complete registration. Please try again.' }
    } else {
      await admin
        .from('tournament_registrations')
        .update({ payment_status: 'paid', fee_waived: false, paystack_reference: null, coins_used: coinsUsed, coin_discount_naira: coinDiscountNaira, ...regFields })
        .eq('id', existing.id)
    }

    redirect(`/tournaments/${tournament.slug}?paid=1`)
  }

  // Always mint a fresh reference for this attempt — Paystack rejects a
  // reference it has already seen, even from an abandoned prior attempt.
  const reference = buildReference(tournamentId, user.id)
  if (!existing) {
    const { error: insertErr } = await admin.from('tournament_registrations').insert({
      tournament_id: tournamentId,
      player_id: user.id,
      payment_status: 'pending',
      paystack_reference: reference,
      coins_used: coinsUsed,
      coin_discount_naira: coinDiscountNaira,
      ...regFields,
    })
    if (insertErr) return { error: 'Could not start registration. Please try again.' }
  } else {
    await admin
      .from('tournament_registrations')
      .update({ paystack_reference: reference, coins_used: coinsUsed, coin_discount_naira: coinDiscountNaira, ...regFields })
      .eq('id', existing.id)
  }

  let authorizationUrl: string
  try {
    authorizationUrl = await initializeTransaction({
      email: user.email!,
      amountKobo: netFee * 100,
      reference,
      callbackUrl: `${SITE_URL}/api/paystack/callback`,
      metadata: { tournament_id: tournamentId, player_id: user.id, slug: tournament.slug },
    })
  } catch (err) {
    console.error('[registerForTournament] Paystack initialize failed', {
      tournamentId,
      reference,
      message: err instanceof Error ? err.message : String(err),
    })
    return { error: 'Payment could not be started. Please try again.' }
  }

  redirect(authorizationUrl)
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run lib/tournaments/`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/tournaments/actions.ts lib/tournaments/confirm.ts lib/tournaments/confirm.test.ts
git commit -m "feat(tournaments): entry-fee coin discount — half price and free entry" -m "$(printf 'Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>')"
```

---

### Task 5: Abandoned coin-discount refund sweep (cron)

**Context:** The half-price path (Task 4) deducts 500 coins, then opens Paystack — if the player abandons that checkout, the registration row stays `payment_status: 'pending'` with `coins_used = 500` forever and the coins are never returned. Spec §4: "If player abandons checkout after coins are deducted: coins are refunded automatically." There is no webhook event for an abandoned (never-attempted) checkout, so this needs a sweep, following the same cron pattern already used for no-show detection (`lib/matches/noshow-actions.ts` + `app/api/cron/resolve-noshow-matches/route.ts`, run hourly via `pg_cron`).

**Files:**
- Create: `lib/tournaments/coin-discount-refund.ts`
- Create: `lib/tournaments/coin-discount-refund.test.ts`
- Create: `app/api/cron/refund-abandoned-coin-discounts/route.ts`

**Interfaces:**
- Consumes: `recordCoinTransaction` (`lib/coins/service.ts`).
- Produces: `refundAbandonedCoinDiscounts(admin: Admin, now?: Date): Promise<{ refunded: number }>`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/tournaments/coin-discount-refund.test.ts
import { describe, it, expect, vi } from 'vitest'
import { refundAbandonedCoinDiscounts } from './coin-discount-refund'

function fakeAdmin(rows: { id: string; player_id: string; coins_used: number }[]) {
  const updates: Record<string, unknown>[] = []
  const coinInserts: Record<string, unknown>[] = []
  return {
    client: {
      from(table: string) {
        if (table === 'tournament_registrations') {
          return {
            select: () => ({
              eq: () => ({
                gt: () => ({
                  lt: async () => ({ data: rows }),
                }),
              }),
            }),
            update: (vals: Record<string, unknown>) => ({
              eq: async (_col: string, id: string) => {
                updates.push({ id, ...vals })
                return { data: null, error: null }
              },
            }),
          }
        }
        if (table === 'sx_coins') {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { balance: 0, total_earned: 0, total_spent: 500 } }) }) }), upsert: async () => ({ data: null, error: null }) }
        }
        if (table === 'sx_coin_transactions') {
          return { insert: async (v: Record<string, unknown>) => { coinInserts.push(v); return { data: null, error: null } } }
        }
        throw new Error(`unexpected table ${table}`)
      },
    },
    updates,
    coinInserts,
  }
}

describe('refundAbandonedCoinDiscounts', () => {
  it('refunds coins and zeroes the discount fields for stale pending registrations', async () => {
    const { client, updates, coinInserts } = fakeAdmin([{ id: 'reg1', player_id: 'p1', coins_used: 500 }])
    const result = await refundAbandonedCoinDiscounts(client as never, new Date('2026-08-16T12:00:00Z'))
    expect(result.refunded).toBe(1)
    expect(coinInserts[0]).toMatchObject({ player_id: 'p1', amount: 500, source: 'entry_discount_refund', reference_id: 'reg1' })
    expect(updates[0]).toMatchObject({ id: 'reg1', coins_used: 0, coin_discount_naira: 0 })
  })

  it('does nothing when there are no stale rows', async () => {
    const { client } = fakeAdmin([])
    const result = await refundAbandonedCoinDiscounts(client as never, new Date())
    expect(result.refunded).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/tournaments/coin-discount-refund.test.ts`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Implement**

```ts
// lib/tournaments/coin-discount-refund.ts
import { recordCoinTransaction } from '@/lib/coins/service'
import type { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

// A half-price registration (coins_used = 500) that never completed its
// Paystack checkout leaves a `pending` row holding a coin debit forever.
// Free-entry registrations (coins_used = 1,000) never reach `pending` — they
// confirm synchronously (see registerForTournament) — so this sweep only
// ever matches abandoned half-price checkouts. One hour mirrors the noshow
// sweep's cadence; a genuinely slow checkout can simply be retried, which
// mints a fresh reference at the (now undiscounted) full fee.
const ABANDON_WINDOW_MS = 60 * 60 * 1000

export async function refundAbandonedCoinDiscounts(admin: Admin, now: Date = new Date()): Promise<{ refunded: number }> {
  const cutoff = new Date(now.getTime() - ABANDON_WINDOW_MS).toISOString()
  const { data: stale } = await admin
    .from('tournament_registrations')
    .select('id, player_id, coins_used')
    .eq('payment_status', 'pending')
    .gt('coins_used', 0)
    .lt('registered_at', cutoff)
  const rows = stale ?? []

  for (const row of rows) {
    await recordCoinTransaction(admin, row.player_id, row.coins_used, 'entry_discount_refund', row.id, 'Abandoned checkout — coin discount refunded')
    await admin.from('tournament_registrations').update({ coins_used: 0, coin_discount_naira: 0 }).eq('id', row.id)
  }
  return { refunded: rows.length }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/tournaments/coin-discount-refund.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Add the cron route**

```ts
// app/api/cron/refund-abandoned-coin-discounts/route.ts
import { createAdminClient } from '@/lib/supabase/admin'
import { refundAbandonedCoinDiscounts } from '@/lib/tournaments/coin-discount-refund'

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 })
  }
  const admin = createAdminClient()
  const result = await refundAbandonedCoinDiscounts(admin)
  return Response.json(result)
}
```

- [ ] **Step 6: Register the hourly `pg_cron` schedule**

Not a migration — this project's existing crons (e.g. the noshow sweep) are registered directly against the live DB, not through a migration file. Run via `mcp__claude_ai_Supabase__execute_sql` (project id `itxubrkbropttfdackmi`) once `NEXT_PUBLIC_SITE_URL` and `CRON_SECRET` are confirmed set in the Vercel env:

```sql
select cron.schedule(
  'refund-abandoned-coin-discounts',
  '0 * * * *', -- hourly, same cadence as resolve-noshow-matches
  $$
  select net.http_post(
    url := '<SITE_URL>/api/cron/refund-abandoned-coin-discounts',
    headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>')
  );
  $$
);
```

This step needs the real `CRON_SECRET` value, which isn't available to this plan — flag it to the user as a manual post-deploy follow-up rather than executing it blind.

- [ ] **Step 7: Commit**

```bash
git add lib/tournaments/coin-discount-refund.ts lib/tournaments/coin-discount-refund.test.ts app/api/cron/refund-abandoned-coin-discounts/route.ts
git commit -m "feat(tournaments): hourly sweep refunds coins for abandoned discounted checkouts" -m "$(printf 'Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>')"
```

---

### Task 6: Registration UI — coin discount radio selector

**Files:**
- Modify: `app/(public)/tournaments/[slug]/page.tsx`
- Modify: `components/tournament/RegistrationPanel.tsx`

**Interfaces:**
- Consumes: `getCoinBalance` (`lib/coins/service.ts`); `COINS_HALF_ENTRY`, `COINS_PER_ENTRY`, `NAIRA_PER_COIN`, `formatCoins` (`lib/coins/value.ts`).

- [ ] **Step 1: Fetch and thread the player's coin balance**

```ts
// app/(public)/tournaments/[slug]/page.tsx
// Add to the existing imports:
import { getCoinBalance } from '@/lib/coins/service'

// Inside TournamentDetailPage, alongside the existing `if (user) { ... }` block:
let prefill = { displayName: '', whatsapp: '' }
let coinBalance = 0
if (user) {
  const [{ data: reg }, { data: profile }, balance] = await Promise.all([
    supabase
      .from('tournament_registrations')
      .select('payment_status, status')
      .eq('tournament_id', t.id)
      .eq('player_id', user.id)
      .maybeSingle(),
    supabase.from('profiles').select('display_name, whatsapp_number').eq('id', user.id).maybeSingle(),
    getCoinBalance(admin, user.id),
  ])
  existingStatus = reg?.payment_status ?? null
  registrationStatus = reg?.status ?? null
  prefill = { displayName: profile?.display_name ?? '', whatsapp: profile?.whatsapp_number ?? '' }
  coinBalance = balance
}
```

(`existingStatus`/`registrationStatus` declarations above this block stay as `let ... = null` — only the `if (user)` body and the new `coinBalance` variable change.)

```tsx
// Further down, in the JSX — add coinBalance to the existing RegistrationPanel call:
<RegistrationPanel
  view={view}
  tournamentId={t.id}
  slug={t.slug}
  fee={t.registration_fee}
  loginHref={`/login?next=/tournaments/${t.slug}`}
  prefill={prefill}
  hasRules={!!t.rules}
  loggedIn={!!user}
  coinBalance={coinBalance}
/>
```

- [ ] **Step 2: Thread `coinBalance` through `RegistrationPanel` into `RegisterForm`, and build the discount selector**

```tsx
// components/tournament/RegistrationPanel.tsx
'use client'
import Link from 'next/link'
import { useFormState, useFormStatus } from 'react-dom'
import { useState } from 'react'
import { registerForTournament, type RegisterState } from '@/lib/tournaments/actions'
import { joinWaitlist, type JoinWaitlistState } from '@/lib/tournaments/waitlist-actions'
import type { RegView } from '@/lib/tournaments/view'
import { formatNaira } from '@/lib/format'
import { Field } from '@/components/dashboard/FormField'
import { COINS_HALF_ENTRY, COINS_PER_ENTRY, NAIRA_PER_COIN } from '@/lib/coins/value'

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-xl bg-violet-600 px-7 py-3.5 text-sm font-bold text-white transition-colors hover:bg-violet-500 disabled:opacity-60"
    >
      {pending ? pendingLabel : label}
    </button>
  )
}

const box = 'rounded-2xl border border-slate-800 bg-slate-900 p-5'

export function RegistrationPanel({
  view,
  tournamentId,
  slug,
  fee,
  loginHref,
  prefill,
  hasRules,
  loggedIn,
  coinBalance,
}: {
  view: RegView
  tournamentId: string
  slug: string
  fee: number
  loginHref: string
  prefill: { displayName: string; whatsapp: string }
  hasRules: boolean
  loggedIn: boolean
  coinBalance: number
}) {
  const bracketHref = `/tournaments/${slug}/bracket`

  if (view === 'guest') {
    return (
      <div className={box}>
        <Link
          href={loginHref}
          className="block w-full rounded-xl bg-violet-600 px-7 py-3.5 text-center text-sm font-bold text-white transition-colors hover:bg-violet-500"
        >
          {fee === 0 ? 'Register — Free' : `Register — ${formatNaira(fee)}`}
        </Link>
        <p className="mt-2 text-center text-xs text-slate-500">Log in to register and pay.</p>
      </div>
    )
  }

  if (view === 'can_register' || view === 'complete_payment') {
    return (
      <div className={box}>
        <RegisterForm
          tournamentId={tournamentId}
          fee={fee}
          prefill={prefill}
          hasRules={hasRules}
          coinBalance={coinBalance}
          isCompletingPayment={view === 'complete_payment'}
        />
      </div>
    )
  }

  if (view === 'waitlisted') {
    return (
      <div className={box}>
        <p className="text-center text-sm font-bold text-amber-400">✓ You&apos;re on the waitlist</p>
        <p className="mt-2 text-center text-xs text-slate-500">
          We&apos;ll reach out on WhatsApp if a spot opens up.
        </p>
      </div>
    )
  }

  if (view === 'registered') {
    return (
      <div className={box}>
        <p className="text-center text-sm font-bold text-emerald-400">✓ You&apos;re registered</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Link
            href="/dashboard"
            className="flex-1 rounded-xl border border-slate-700 px-5 py-2.5 text-center text-sm font-bold text-white hover:border-slate-500"
          >
            My Dashboard
          </Link>
          <Link
            href={bracketHref}
            className="flex-1 rounded-xl border border-slate-700 px-5 py-2.5 text-center text-sm font-bold text-white hover:border-slate-500"
          >
            View Bracket
          </Link>
        </div>
      </div>
    )
  }

  const message =
    view === 'full'
      ? 'This tournament is full.'
      : view === 'ended'
        ? 'This tournament has ended.'
        : view === 'invitation_only'
          ? "This tournament is by invitation only. Check your dashboard if you've been invited."
          : 'Registration is closed.'

  const canOfferWaitlist = view === 'closed'

  return (
    <div className={box}>
      <p className="text-center text-sm font-semibold text-slate-400">{message}</p>
      {view !== 'full' && (
        <Link
          href={bracketHref}
          className="mt-3 block rounded-xl border border-slate-700 px-5 py-2.5 text-center text-sm font-bold text-white hover:border-slate-500"
        >
          View Bracket
        </Link>
      )}
      {canOfferWaitlist &&
        (loggedIn ? (
          <div className="mt-4 border-t border-slate-800 pt-4">
            <p className="mb-3 text-center text-xs text-slate-500">
              A registered player drops out sometimes — join the waitlist to be considered as a substitute.
            </p>
            <WaitlistForm tournamentId={tournamentId} prefill={prefill} hasRules={hasRules} />
          </div>
        ) : (
          <Link
            href={loginHref}
            className="mt-3 block rounded-xl border border-slate-700 px-5 py-2.5 text-center text-sm font-bold text-white hover:border-slate-500"
          >
            Log in to join the waitlist
          </Link>
        ))}
    </div>
  )
}

function WaitlistForm({
  tournamentId,
  prefill,
  hasRules,
}: {
  tournamentId: string
  prefill: { displayName: string; whatsapp: string }
  hasRules: boolean
}) {
  const [state, formAction] = useFormState<JoinWaitlistState, FormData>(joinWaitlist, undefined)

  if (state?.success) {
    return <p className="text-center text-sm font-bold text-amber-400">✓ You&apos;re on the waitlist</p>
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="tournamentId" value={tournamentId} />
      <Field name="displayName" label="Display name" defaultValue={prefill.displayName} />
      <Field
        name="whatsapp"
        label="WhatsApp number"
        type="tel"
        defaultValue={prefill.whatsapp}
        placeholder="+234…"
      />
      <Field name="clubName" label="Club name" placeholder="Your in-game club/team" />
      <Field
        name="ignTag"
        label="In-game player ID / tag (optional)"
        placeholder="Your IGN or player tag"
        required={false}
      />
      {hasRules && (
        <label className="flex items-start gap-2 text-xs text-slate-400">
          <input type="checkbox" name="agreedToRules" value="true" required className="mt-0.5 accent-violet-600" />
          <span>I have read and agree to the tournament rules.</span>
        </label>
      )}
      {state?.error && <p className="text-center text-sm text-red-400">{state.error}</p>}
      <button
        type="submit"
        className="w-full rounded-xl border border-amber-500/40 px-7 py-3 text-sm font-bold text-amber-400 transition-colors hover:bg-amber-500/10"
      >
        Join waitlist
      </button>
    </form>
  )
}

type CoinTier = '0' | '500' | '1000'

function RegisterForm({
  tournamentId,
  fee,
  prefill,
  hasRules,
  coinBalance,
  isCompletingPayment,
}: {
  tournamentId: string
  fee: number
  prefill: { displayName: string; whatsapp: string }
  hasRules: boolean
  coinBalance: number
  isCompletingPayment: boolean
}) {
  const [state, formAction] = useFormState<RegisterState, FormData>(registerForTournament, undefined)
  const [tier, setTier] = useState<CoinTier>('0')

  // Spec §4: discount only offered at ₦500+ fee, and only once resuming an
  // already-pending (unpaid) registration doesn't apply — a fresh coin
  // deduction on top of an existing pending Paystack attempt would double-charge coins.
  const discountEligible = fee >= 500 && !isCompletingPayment
  const canHalf = discountEligible && coinBalance >= COINS_HALF_ENTRY
  const canFree = discountEligible && coinBalance >= COINS_PER_ENTRY

  const discountNaira = tier === '500' ? Math.round(COINS_HALF_ENTRY * NAIRA_PER_COIN) : tier === '1000' ? Math.round(COINS_PER_ENTRY * NAIRA_PER_COIN) : 0
  const youPay = Math.max(0, fee - discountNaira)
  const label = isCompletingPayment
    ? 'Complete payment →'
    : youPay === 0
      ? 'Pay ₦0 — Confirm Registration'
      : `Register — ${formatNaira(youPay)}`
  const pendingLabel = youPay === 0 ? 'Registering…' : 'Redirecting to payment…'

  return (
    <>
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="tournamentId" value={tournamentId} />
        <Field name="displayName" label="Display name" defaultValue={prefill.displayName} />
        <Field
          name="whatsapp"
          label="WhatsApp number"
          type="tel"
          defaultValue={prefill.whatsapp}
          placeholder="+234…"
        />
        <Field name="clubName" label="Club name" placeholder="Your in-game club/team" />
        <Field
          name="ignTag"
          label="In-game player ID / tag (optional)"
          placeholder="Your IGN or player tag"
          required={false}
        />
        {(canHalf || canFree) && (
          <div className="rounded-xl border border-slate-700 bg-slate-950 p-3">
            <p className="mb-2 flex items-center justify-between text-xs font-bold text-white">
              <span>🪙 Use SX Coins?</span>
              <span className="font-normal text-slate-500">Your balance: {coinBalance.toLocaleString()} coins</span>
            </p>
            <div className="space-y-1.5 text-sm text-slate-300">
              <label className="flex items-center gap-2">
                <input type="radio" name="coinsUsed" value="0" checked={tier === '0'} onChange={() => setTier('0')} className="accent-violet-600" />
                No discount
              </label>
              {canHalf && (
                <label className="flex items-center gap-2">
                  <input type="radio" name="coinsUsed" value="500" checked={tier === '500'} onChange={() => setTier('500')} className="accent-violet-600" />
                  {COINS_HALF_ENTRY.toLocaleString()} coins — Pay {formatNaira(Math.max(0, fee - Math.round(COINS_HALF_ENTRY * NAIRA_PER_COIN)))} (save {formatNaira(Math.round(COINS_HALF_ENTRY * NAIRA_PER_COIN))})
                </label>
              )}
              {canFree && (
                <label className="flex items-center gap-2">
                  <input type="radio" name="coinsUsed" value="1000" checked={tier === '1000'} onChange={() => setTier('1000')} className="accent-violet-600" />
                  {COINS_PER_ENTRY.toLocaleString()} coins — Free entry (save {formatNaira(Math.round(COINS_PER_ENTRY * NAIRA_PER_COIN))})
                </label>
              )}
            </div>
            <p className="mt-2 text-right text-xs font-bold text-white">You pay: {formatNaira(youPay)}</p>
          </div>
        )}
        {hasRules && (
          <label className="flex items-start gap-2 text-xs text-slate-400">
            <input type="checkbox" name="agreedToRules" value="true" required className="mt-0.5 accent-violet-600" />
            <span>I have read and agree to the tournament rules.</span>
          </label>
        )}
        {state?.error && <p className="text-center text-sm text-red-400">{state.error}</p>}
        <SubmitButton label={label} pendingLabel={pendingLabel} />
      </form>
      <p className="mt-2 text-center text-xs text-slate-500">
        {youPay === 0 && tier !== '0'
          ? 'Free entry — coins cover the full fee.'
          : `Secure payment via Paystack. Entry fee ${formatNaira(youPay)}${tier === '500' ? ' after coin discount' : ''}.`}
      </p>
    </>
  )
}
```

- [ ] **Step 3: Manual verification**

Run `npm run dev`, log in as a player with ≥500 SX Coins (or grant some via the admin economy actions), open a ₦500 tournament's registration page, confirm both radio tiers appear only at the right balance thresholds and "You pay" updates live when switching tiers.

- [ ] **Step 4: Commit**

```bash
git add app/\(public\)/tournaments/\[slug\]/page.tsx components/tournament/RegistrationPanel.tsx
git commit -m "feat(tournaments): coin discount radio selector on the registration form" -m "$(printf 'Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>')"
```

---

### Task 7: `match_wagers` + `platform_coin_reserve` migration, and the wager math/eligibility/settlement libs

**Files:**
- Create: `supabase/migrations/059_match_wagers.sql`
- Create: `lib/wagers/market.ts`
- Create: `lib/wagers/market.test.ts`
- Create: `lib/wagers/settle.ts`
- Create: `lib/wagers/settle.test.ts`

**Interfaces:**
- Produces: `WAGER_FEE_RATE`, `MIN_WAGER_STAKE`, `MAX_WAGER_STAKE`, `WAGER_WINDOW_CLOSE_MINUTES` (`lib/wagers/market.ts`); `wagerWindowOpen(match, now?): boolean`; `estimateWagerPayout(pools, side, stake): number`; `type WagerPools = { playerA: number; playerB: number }`. `computeWagerPayouts(wagers, winnerId): { payouts: Map<string, number>; platformFee: number }`; `settleMatchWagers(admin, matchId, winnerId): Promise<void>`; `refundMatchWagers(admin, matchId): Promise<void>` (`lib/wagers/settle.ts`).

- [ ] **Step 1: Apply the migration**

```sql
-- supabase/migrations/059_match_wagers.sql
-- Spec §5 — coin-denominated community wagering on SentinelX matches. A
-- structural mirror of match_bets/lib/betting (042_match_betting.sql) but
-- entirely coin-denominated: no naira anywhere in this table or its
-- settlement path.
CREATE TABLE public.match_wagers (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id       uuid        NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  bettor_id      uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  pick_player_id uuid        NOT NULL REFERENCES public.profiles(id),
  stake_coins    integer     NOT NULL CHECK (stake_coins >= 50 AND stake_coins <= 2000),
  payout_coins   integer,
  status         text        NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','won','lost','refunded')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id, bettor_id)
);

CREATE INDEX ON public.match_wagers (match_id);

ALTER TABLE public.match_wagers ENABLE ROW LEVEL SECURITY;

-- Public odds visibility — anyone can read aggregate/individual wagers.
CREATE POLICY "match_wagers_read" ON public.match_wagers FOR SELECT USING (true);

-- Payout + status transitions are service-role only (admin result
-- confirmation drives settlement) — players never write those columns
-- directly, so there is no player-facing UPDATE/INSERT policy here. Writes
-- from placeWager/settleMatchWagers/refundMatchWagers all go through
-- createAdminClient(), same as tournament_registrations (see
-- lib/tournaments/actions.ts's comment on why).

-- Platform coin reserve — 5% wager fee pool (spec §5), future giveaways/Best
-- Play prizes. No RLS write policy for players; read is admin-only for now
-- (no UI surfaces this table in this extension).
CREATE TABLE public.platform_coin_reserve (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id   uuid        REFERENCES public.matches(id),
  coins      integer     NOT NULL,
  source     text        NOT NULL DEFAULT 'wager_fee',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_coin_reserve ENABLE ROW LEVEL SECURITY;
CREATE POLICY "platform_coin_reserve_staff_read" ON public.platform_coin_reserve
  FOR SELECT USING (public.is_staff());
```

Apply via `mcp__claude_ai_Supabase__apply_migration` (name `match_wagers`), then regenerate `lib/supabase/types.ts`.

- [ ] **Step 2: Write the failing tests for `lib/wagers/market.ts`**

```ts
// lib/wagers/market.test.ts
import { describe, it, expect } from 'vitest'
import { wagerWindowOpen, estimateWagerPayout, WAGER_FEE_RATE } from './market'

describe('wagerWindowOpen', () => {
  const base = { status: 'scheduled', scheduled_at: '2026-08-10T18:00:00Z', player_a_id: 'a', player_b_id: 'b' }

  it('is open more than 15 minutes before scheduled_at', () => {
    expect(wagerWindowOpen(base, new Date('2026-08-10T17:00:00Z'))).toBe(true)
  })

  it('closes exactly 15 minutes before scheduled_at', () => {
    expect(wagerWindowOpen(base, new Date('2026-08-10T17:45:00Z'))).toBe(false)
    expect(wagerWindowOpen(base, new Date('2026-08-10T17:44:00Z'))).toBe(true)
  })

  it('is closed once the match is no longer scheduled', () => {
    expect(wagerWindowOpen({ ...base, status: 'live' }, new Date('2026-08-10T17:00:00Z'))).toBe(false)
  })

  it('is closed when either player slot is unassigned (bye/TBD)', () => {
    expect(wagerWindowOpen({ ...base, player_b_id: null }, new Date('2026-08-10T17:00:00Z'))).toBe(false)
  })

  it('is closed when no scheduled_at is set yet', () => {
    expect(wagerWindowOpen({ ...base, scheduled_at: null }, new Date())).toBe(false)
  })
})

describe('estimateWagerPayout', () => {
  it('returns stake-back only when the other side has no pool', () => {
    expect(estimateWagerPayout({ playerA: 0, playerB: 0 }, 'player_a', 100)).toBe(100)
  })

  it('estimates a fee-adjusted payout against the current opposing pool', () => {
    // otherPool 200, thisPool after adding stake = 0 + 100 = 100
    // 100 + floor(200 * 0.95 * (100/100)) = 100 + 190 = 290
    expect(estimateWagerPayout({ playerA: 0, playerB: 200 }, 'player_a', 100)).toBe(290)
  })
})

describe('WAGER_FEE_RATE', () => {
  it('is 5%', () => {
    expect(WAGER_FEE_RATE).toBe(0.05)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run lib/wagers/market.test.ts`
Expected: FAIL — module doesn't exist

- [ ] **Step 4: Implement `lib/wagers/market.ts`**

```ts
// lib/wagers/market.ts
export const WAGER_FEE_RATE = 0.05 // spec §5 — 5% platform fee on the losing pool
export const MIN_WAGER_STAKE = 50
export const MAX_WAGER_STAKE = 2000
export const WAGER_WINDOW_CLOSE_MINUTES = 15

export type WagerMatch = {
  status: string
  scheduled_at: string | null
  player_a_id: string | null
  player_b_id: string | null
}

// Wagering opens the moment both players are confirmed into a scheduled
// match and closes a fixed 15 minutes before scheduled_at (spec §5). Unlike
// the naira betting window (lib/betting/market.ts's bettingOpen), there is
// no full-day-match carve-out here — the coin wagering spec states the
// 15-minute rule with no exception, so this stays literal to it rather than
// inventing an undocumented extension.
export function wagerWindowOpen(match: WagerMatch, now: Date = new Date()): boolean {
  if (match.status !== 'scheduled') return false
  if (!match.player_a_id || !match.player_b_id) return false
  if (!match.scheduled_at) return false
  const closesAt = new Date(match.scheduled_at).getTime() - WAGER_WINDOW_CLOSE_MINUTES * 60_000
  return now.getTime() < closesAt
}

export type WagerPools = { playerA: number; playerB: number }
export type WagerSide = 'player_a' | 'player_b'

// "What would this stake return right now if the window closed this
// instant" — informational only for the widget's live "Potential win"
// figure; real settlement math is computeWagerPayouts in settle.ts, applied
// to the actual pool at result-confirmation time.
export function estimateWagerPayout(pools: WagerPools, side: WagerSide, stake: number): number {
  const thisPool = (side === 'player_a' ? pools.playerA : pools.playerB) + stake
  const otherPool = side === 'player_a' ? pools.playerB : pools.playerA
  if (otherPool <= 0) return stake
  return stake + Math.floor(otherPool * (1 - WAGER_FEE_RATE) * (stake / thisPool))
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/wagers/market.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 6: Write the failing tests for `lib/wagers/settle.ts`**

```ts
// lib/wagers/settle.test.ts
import { describe, it, expect } from 'vitest'
import { computeWagerPayouts } from './settle'

describe('computeWagerPayouts', () => {
  it('splits the fee-adjusted losing pool pro-rata among winners, and takes the 5% platform fee', () => {
    // Spec §5 worked example: 3 bettors x100 on methio (winner), 1 bettor x200 on Arole.
    const wagers = [
      { id: 'w1', bettorId: 'p1', pickPlayerId: 'methio', stakeCoins: 100 },
      { id: 'w2', bettorId: 'p2', pickPlayerId: 'methio', stakeCoins: 100 },
      { id: 'w3', bettorId: 'p3', pickPlayerId: 'methio', stakeCoins: 100 },
      { id: 'l1', bettorId: 'p4', pickPlayerId: 'arole', stakeCoins: 200 },
    ]
    const { payouts, platformFee } = computeWagerPayouts(wagers, 'methio')
    expect(platformFee).toBe(10) // 5% of 200
    // distributable 190, each of 3 winners: 100 + floor(190 * 100/300) = 100 + 63 = 163
    expect(payouts.get('w1')).toBe(163)
    expect(payouts.get('w2')).toBe(163)
    expect(payouts.get('w3')).toBe(163)
    expect(payouts.get('l1')).toBe(0)
  })

  it('takes no fee and pays nothing when nobody backed the winner', () => {
    const wagers = [{ id: 'l1', bettorId: 'p1', pickPlayerId: 'arole', stakeCoins: 200 }]
    const { payouts, platformFee } = computeWagerPayouts(wagers, 'methio')
    expect(platformFee).toBe(0)
    expect(payouts.get('l1')).toBe(0)
  })

  it('returns stake-back with no fee when nobody backed the loser', () => {
    const wagers = [{ id: 'w1', bettorId: 'p1', pickPlayerId: 'methio', stakeCoins: 500 }]
    const { payouts, platformFee } = computeWagerPayouts(wagers, 'methio')
    expect(platformFee).toBe(0)
    expect(payouts.get('w1')).toBe(500)
  })
})
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run lib/wagers/settle.test.ts`
Expected: FAIL — module doesn't exist

- [ ] **Step 8: Implement `lib/wagers/settle.ts`**

```ts
// lib/wagers/settle.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { recordCoinTransaction } from '@/lib/coins/service'
import { WAGER_FEE_RATE } from './market'

type Admin = SupabaseClient<Database>

export type SettleWager = { id: string; bettorId: string; pickPlayerId: string; stakeCoins: number }

// Pure pro-rata split, the coin-wagering twin of
// lib/betting/settle.ts's computePariMutuelPayouts — same shape, 5%
// platform fee (WAGER_FEE_RATE) instead of the naira system's 10% RAKE_RATE,
// and also returns the fee cut so the caller can log it to
// platform_coin_reserve.
export function computeWagerPayouts(
  wagers: SettleWager[],
  winnerId: string,
): { payouts: Map<string, number>; platformFee: number } {
  const payouts = new Map<string, number>()
  const winners = wagers.filter((w) => w.pickPlayerId === winnerId)
  const losers = wagers.filter((w) => w.pickPlayerId !== winnerId)
  const winningPool = winners.reduce((s, w) => s + w.stakeCoins, 0)
  const losingPool = losers.reduce((s, w) => s + w.stakeCoins, 0)

  for (const w of losers) payouts.set(w.id, 0)

  if (winningPool === 0) {
    // Nobody backed the actual winner — no payouts, and no fee is taken
    // since there's no winning side to distribute the losing pool to.
    return { payouts, platformFee: 0 }
  }

  const platformFee = losingPool === 0 ? 0 : Math.floor(losingPool * WAGER_FEE_RATE)
  const distributable = losingPool - platformFee
  for (const w of winners) {
    const payout = w.stakeCoins + Math.floor(distributable * (w.stakeCoins / winningPool))
    payouts.set(w.id, payout)
  }
  return { payouts, platformFee }
}

// Called only from admin-confirmed outcomes (confirmResult) — never from a
// player's own submission. The caller wraps this in try/catch and never
// rolls back the match result on failure (see verify-actions.ts).
export async function settleMatchWagers(admin: Admin, matchId: string, winnerId: string): Promise<void> {
  const { data: rows } = await admin
    .from('match_wagers')
    .select('id, bettor_id, pick_player_id, stake_coins')
    .eq('match_id', matchId)
    .eq('status', 'pending')
  const wagers = (rows ?? []).map((w) => ({ id: w.id, bettorId: w.bettor_id, pickPlayerId: w.pick_player_id, stakeCoins: w.stake_coins }))
  if (wagers.length === 0) return

  const { payouts, platformFee } = computeWagerPayouts(wagers, winnerId)
  const now = new Date().toISOString()

  for (const w of wagers) {
    const payout = payouts.get(w.id) ?? 0
    if (payout > 0) {
      await recordCoinTransaction(admin, w.bettorId, payout, 'wager_won', w.id, `Wager won — match ${matchId}`)
      await admin.from('match_wagers').update({ status: 'won', payout_coins: payout, updated_at: now }).eq('id', w.id)
    } else {
      // A loser's stake was already deducted when the wager was placed
      // (placeWager) — no further coin movement, only the status update.
      await admin.from('match_wagers').update({ status: 'lost', payout_coins: 0, updated_at: now }).eq('id', w.id)
    }
  }

  if (platformFee > 0) {
    await admin.from('platform_coin_reserve').insert({ match_id: matchId, coins: platformFee, source: 'wager_fee' })
  }
}

// No real contest happened (draw, dispute, walkover, mutual no-show) — every
// pending wager's stake is returned in full, no fee taken. Scoped to
// status = 'pending' so it's safe to call even when there's nothing to
// refund.
export async function refundMatchWagers(admin: Admin, matchId: string): Promise<void> {
  const { data: rows } = await admin
    .from('match_wagers')
    .select('id, bettor_id, stake_coins')
    .eq('match_id', matchId)
    .eq('status', 'pending')
  const now = new Date().toISOString()
  for (const w of rows ?? []) {
    await recordCoinTransaction(admin, w.bettor_id, w.stake_coins, 'wager_refund', w.id, `Wager refunded — match ${matchId}`)
    await admin.from('match_wagers').update({ status: 'refunded', payout_coins: w.stake_coins, updated_at: now }).eq('id', w.id)
  }
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npx vitest run lib/wagers/`
Expected: PASS (all tests)

- [ ] **Step 10: Commit**

```bash
git add supabase/migrations/059_match_wagers.sql lib/supabase/types.ts lib/wagers/market.ts lib/wagers/market.test.ts lib/wagers/settle.ts lib/wagers/settle.test.ts
git commit -m "feat(wagers): match_wagers/platform_coin_reserve schema, eligibility window, and pro-rata settlement" -m "$(printf 'Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>')"
```

---

### Task 8: `placeWager` Server Action

**Files:**
- Create: `lib/wagers/schema.ts`
- Create: `lib/wagers/actions.ts`

**Interfaces:**
- Consumes: `getCoinBalance`, `recordCoinTransaction` (`lib/coins/service.ts`); `wagerWindowOpen`, `MIN_WAGER_STAKE`, `MAX_WAGER_STAKE` (Task 7).
- Produces: `placeWager(_prev: WagerState, formData: FormData): Promise<WagerState>`, `type WagerState = { error?: string; success?: boolean } | undefined`.

- [ ] **Step 1: Schema**

```ts
// lib/wagers/schema.ts
import { z } from 'zod'
import { MIN_WAGER_STAKE, MAX_WAGER_STAKE } from './market'

export const placeWagerSchema = z.object({
  matchId: z.string().uuid('Invalid match.'),
  pickPlayerId: z.string().uuid('Invalid pick.'),
  stakeCoins: z.coerce
    .number()
    .int('Stake must be a whole number of coins.')
    .min(MIN_WAGER_STAKE, `Minimum stake is ${MIN_WAGER_STAKE} coins.`)
    .max(MAX_WAGER_STAKE, `Maximum stake is ${MAX_WAGER_STAKE.toLocaleString()} coins.`),
})
export type PlaceWagerInput = z.infer<typeof placeWagerSchema>
```

- [ ] **Step 2: Server Action**

```ts
// lib/wagers/actions.ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCoinBalance, recordCoinTransaction } from '@/lib/coins/service'
import { placeWagerSchema } from './schema'
import { wagerWindowOpen } from './market'

export type WagerState = { error?: string; success?: boolean } | undefined

export async function placeWager(_prev: WagerState, formData: FormData): Promise<WagerState> {
  const parsed = placeWagerSchema.safeParse({
    matchId: formData.get('matchId'),
    pickPlayerId: formData.get('pickPlayerId'),
    stakeCoins: formData.get('stakeCoins'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const { matchId, pickPlayerId, stakeCoins } = parsed.data

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in to place a wager.' }

  const admin = createAdminClient()
  const { data: match } = await admin
    .from('matches')
    .select('id, status, scheduled_at, player_a_id, player_b_id')
    .eq('id', matchId)
    .maybeSingle()
  if (!match) return { error: 'Match not found.' }
  if (user.id === match.player_a_id || user.id === match.player_b_id) {
    return { error: 'You cannot wager on your own match.' }
  }
  if (pickPlayerId !== match.player_a_id && pickPlayerId !== match.player_b_id) {
    return { error: 'Pick must be one of the two players in this match.' }
  }
  if (!wagerWindowOpen(match)) return { error: 'Wagering is closed for this match.' }

  const { data: existing } = await admin
    .from('match_wagers')
    .select('id, stake_coins')
    .eq('match_id', matchId)
    .eq('bettor_id', user.id)
    .maybeSingle()

  // Changing an existing wager (spec §5: "can change stake up until window
  // closes") refunds the old stake before checking/deducting the new one —
  // never double-charges for the same wager. Both coin movements reference
  // matchId, not the wager row's id — mirrors placeBet's debitWallet call
  // (lib/betting/actions.ts), which references matchId for the same reason:
  // at debit time there's no settled row id to point to yet.
  const previousStake = existing?.stake_coins ?? 0
  const balance = await getCoinBalance(admin, user.id)
  if (balance + previousStake < stakeCoins) return { error: 'Not enough SX Coins for this stake.' }

  if (previousStake > 0) {
    await recordCoinTransaction(admin, user.id, previousStake, 'wager_refund', matchId, 'Wager changed — previous stake refunded')
  }
  await recordCoinTransaction(admin, user.id, -stakeCoins, 'wager_stake', matchId, `Wager — match ${matchId}`)

  const { error: upsertErr } = await admin.from('match_wagers').upsert(
    {
      match_id: matchId,
      bettor_id: user.id,
      pick_player_id: pickPlayerId,
      stake_coins: stakeCoins,
      status: 'pending',
      payout_coins: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'match_id,bettor_id' },
  )
  if (upsertErr) {
    // Undo the debit — mirrors placeBet's rollback-on-insert-failure pattern
    // (lib/betting/actions.ts). A player must never lose coins for a wager
    // that wasn't actually recorded.
    await recordCoinTransaction(admin, user.id, stakeCoins, 'wager_refund', matchId, 'Wager save failed — auto-reversed')
    return { error: 'Could not place your wager. Please try again.' }
  }

  revalidatePath(`/matches/${matchId}`)
  return { success: true }
}
```

- [ ] **Step 3: Manual verification**

Run `npm run dev`, as a non-participant player with ≥50 coins on a scheduled match with `scheduled_at` more than 15 minutes out, place a wager via the widget added in Task 9, confirm `match_wagers` gets the row and `sx_coin_transactions` gets the `wager_stake` debit.

- [ ] **Step 4: Commit**

```bash
git add lib/wagers/schema.ts lib/wagers/actions.ts
git commit -m "feat(wagers): placeWager Server Action" -m "$(printf 'Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>')"
```

---

### Task 9: Wire wager settlement/refunds into the admin match-result flow

**Context:** Exact insertion points confirmed against the live code: `confirmResult`'s draw branch (`lib/matches/verify-actions.ts:359-367`) currently calls `refundMatchBets`/`settleMatchBets`; the non-blocking feed-hook block sits at lines 401-409. `disputeResult` (line 468) always fires on a still-`scheduled`/`live` match (never on an already-`completed` one — confirmed via `lib/matches/review-queue.ts`'s bucketing, which routes `status: 'disputed'` and `status: 'completed'` into mutually exclusive states), so any pending wagers on it have never been settled — a plain refund is correct and sufficient. `declareNoShowWinner` and `markBothNoShow` (`lib/matches/noshow-actions.ts`) both already call `refundMatchBets` right after `syncMatchEvents`/`awardMatchEconomy`.

**Files:**
- Modify: `lib/matches/verify-actions.ts`
- Modify: `lib/matches/noshow-actions.ts`

**Interfaces:**
- Consumes: `settleMatchWagers`, `refundMatchWagers` (Task 7).

- [ ] **Step 1: `confirmResult` — settle or refund wagers alongside the existing bet handling, then wire the non-blocking settlement call**

```ts
// lib/matches/verify-actions.ts — add the import:
import { settleMatchWagers, refundMatchWagers } from '@/lib/wagers/settle'

// Replace the existing draw/settle branch (lines 359-367):
  if (scoreA === scoreB) {
    // Knockout matches can't reach this point in a draw (rejected above) —
    // this only fires for a group-stage draw, a push with no side to
    // redistribute the bet/wager pool to.
    await refundMatchBets(admin, id)
    await refundMatchWagers(admin, id)
  } else {
    const winningSide = scoreA > scoreB ? 'player_a' : 'player_b'
    await settleMatchBets(admin, id, winningSide)
  }
```

The wager settlement itself needs the winning **player id**, not the naira system's `Side` enum — it goes inside the existing non-blocking feed-hook block, since coin wagers (unlike the naira system) are new in this extension and the spec explicitly calls for non-blocking settlement here (§5 step 3):

```ts
// lib/matches/verify-actions.ts — replace the existing feed-hook block (lines 401-409):
  // Feed §10: match_result auto-post + weekly challenge progress. Coin
  // wagering §5 step 3: settle wagers pro-rata. Both explicitly
  // non-blocking — the result confirmation above has already committed, and
  // a feed/challenge/wager hiccup must never surface as a failed result confirm.
  try {
    await onMatchConfirmed(admin, id)
    revalidatePath('/community')
  } catch (err) {
    console.error('[confirmResult] onMatchConfirmed failed (non-blocking)', { matchId: id, err })
  }
  if (scoreA !== scoreB) {
    try {
      const winnerId = scoreA > scoreB ? m.player_a_id : m.player_b_id
      if (winnerId) await settleMatchWagers(admin, id, winnerId)
    } catch (err) {
      console.error('[confirmResult] settleMatchWagers failed (non-blocking)', { matchId: id, err })
    }
  }
```

- [ ] **Step 2: `disputeResult` — refund any pending wagers**

```ts
// lib/matches/verify-actions.ts — add the import (same import line as Step 1 covers this):
// import { settleMatchWagers, refundMatchWagers } from '@/lib/wagers/settle'

export async function disputeResult(_prev: VerifyState, formData: FormData): Promise<VerifyState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  const note = String(formData.get('note') ?? '').trim()
  if (!id) return { error: 'Missing match.' }
  if (!note) return { error: 'Enter a reason for the dispute.' }

  const admin = createAdminClient()
  const { data: m } = await admin
    .from('matches')
    .select('id, tournament_id, tournament:tournaments(slug)')
    .eq('id', id)
    .maybeSingle()
  if (!m) return { error: 'Match not found.' }

  const { error } = await admin
    .from('matches')
    .update({ status: 'disputed', admin_note: note })
    .eq('id', id)
  if (error) return { error: 'Could not save the dispute.' }
  await admin.from('match_results').update({ status: 'disputed' }).eq('match_id', id)

  // Spec §5: "If match result is disputed ... wagers refunded to all
  // bettors." disputeResult only ever runs on a still-scheduled/live match
  // (never on an already-completed one — see review-queue.ts's mutually
  // exclusive bucketing), so any wagers here are still 'pending'; refund is
  // always correct, never a reversal of an already-settled payout.
  await refundMatchWagers(admin, id)

  await syncMatchEvents(admin, id)

  const t = firstStr(m.tournament as { slug: string } | { slug: string }[] | null)
  revalidateAll(m.tournament_id, t?.slug ?? '', id)
  return { success: true }
}
```

- [ ] **Step 3: `declareNoShowWinner` and `markBothNoShow` — refund alongside the existing bet refund**

```ts
// lib/matches/noshow-actions.ts — add the import:
import { refundMatchWagers } from '@/lib/wagers/settle'

// In declareNoShowWinner, right after the existing refundMatchBets call:
  // A walkover isn't a real contest — refund rather than settle, so nobody
  // can profit from betting/wagering on the declared winner after the fact.
  await refundMatchBets(admin, id)
  await refundMatchWagers(admin, id)

// In markBothNoShow, right after the existing refundMatchBets call:
  await syncMatchEvents(admin, id)
  await refundMatchBets(admin, id)
  await refundMatchWagers(admin, id)
```

- [ ] **Step 4: Run the existing verify/noshow test suites to confirm nothing broke**

Run: `npx vitest run lib/matches/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/matches/verify-actions.ts lib/matches/noshow-actions.ts
git commit -m "feat(wagers): settle or refund coin wagers wherever match_bets already does" -m "$(printf 'Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>')"
```

---

### Task 10: `WagerWidget` on `/matches/[id]` + coin balance/activity panel on `/dashboard/wallet`

**Files:**
- Create: `components/match/WagerWidget.tsx`
- Modify: `app/(public)/matches/[id]/page.tsx`
- Modify: `app/dashboard/wallet/page.tsx`

**Interfaces:**
- Consumes: `placeWager`, `type WagerState` (Task 8); `estimateWagerPayout`, `wagerWindowOpen`, `MIN_WAGER_STAKE`, `MAX_WAGER_STAKE`, `type WagerPools` (Task 7); `getCoinBalance` (`lib/coins/service.ts`); `coinsToNaira` (Task 1).

- [ ] **Step 1: `WagerWidget` component**

```tsx
// components/match/WagerWidget.tsx
'use client'
import { useFormState, useFormStatus } from 'react-dom'
import { useState } from 'react'
import { HexAvatar } from '@/components/shared/HexAvatar'
import { placeWager, type WagerState } from '@/lib/wagers/actions'
import { estimateWagerPayout, MIN_WAGER_STAKE, MAX_WAGER_STAKE, type WagerPools } from '@/lib/wagers/market'
import { coinsToNaira } from '@/lib/coins/value'
import type { MembershipTier } from '@/lib/membership/tiers'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-lg border border-amber-500/40 px-4 py-2 text-xs font-bold text-amber-400 hover:bg-amber-500/10 disabled:opacity-50"
    >
      {pending ? 'Placing wager…' : 'Place Wager'}
    </button>
  )
}

export function WagerWidget({
  matchId,
  playerAId,
  playerBId,
  playerAName,
  playerBName,
  playerAAvatar,
  playerBAvatar,
  playerATier,
  playerBTier,
  pools,
  myWager,
  coinBalance,
  disabledReason,
  outcome,
}: {
  matchId: string
  playerAId: string
  playerBId: string
  playerAName: string
  playerBName: string
  playerAAvatar: string | null
  playerBAvatar: string | null
  playerATier: MembershipTier
  playerBTier: MembershipTier
  pools: WagerPools
  myWager: { pickPlayerId: string; stakeCoins: number } | null
  coinBalance: number
  disabledReason: string | null
  outcome: { won: boolean; payoutCoins: number; stakeCoins: number } | null
}) {
  const [state, formAction] = useFormState<WagerState, FormData>(placeWager, undefined)
  const [pick, setPick] = useState(myWager?.pickPlayerId ?? playerAId)
  const [stake, setStake] = useState(myWager?.stakeCoins ?? MIN_WAGER_STAKE)

  const total = pools.playerA + pools.playerB
  const pctA = total > 0 ? Math.round((pools.playerA / total) * 100) : 50
  const pctB = 100 - pctA
  const potentialWin = estimateWagerPayout(pools, pick === playerAId ? 'player_a' : 'player_b', stake)

  return (
    <div className="mb-6 rounded-2xl border border-amber-500/20 bg-slate-900 p-5">
      <h3 className="mb-3 text-sm font-bold text-white">🪙 Community Wager</h3>

      <div className="mb-4 grid grid-cols-2 gap-3 text-center text-xs text-slate-400">
        <div className="flex flex-col items-center gap-1">
          <HexAvatar src={playerAAvatar} username={playerAName} tier={playerATier} size="sm" />
          <span className="font-semibold text-white">{playerAName}</span>
          <span>{pools.playerA.toLocaleString()} coins ({pctA}% backing)</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <HexAvatar src={playerBAvatar} username={playerBName} tier={playerBTier} size="sm" />
          <span className="font-semibold text-white">{playerBName}</span>
          <span>{pools.playerB.toLocaleString()} coins ({pctB}% backing)</span>
        </div>
      </div>

      {outcome ? (
        <p
          className={`rounded-lg border p-3 text-center text-sm font-bold ${
            outcome.won ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : 'border-slate-800 bg-slate-950 text-slate-400'
          }`}
        >
          {outcome.won ? `You won +${outcome.payoutCoins.toLocaleString()} coins 🎉` : `You lost ${outcome.stakeCoins.toLocaleString()} coins.`}
        </p>
      ) : disabledReason ? (
        <p className="rounded-lg border border-slate-800 bg-slate-950 p-3 text-center text-xs text-slate-500">{disabledReason}</p>
      ) : (
        <form action={formAction} className="space-y-3">
          <input type="hidden" name="matchId" value={matchId} />
          <p className="text-center text-xs text-slate-500">Your balance: {coinBalance.toLocaleString()} coins</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex items-center gap-2 rounded-lg border border-slate-700 p-2 text-sm text-slate-300">
              <input type="radio" name="pickPlayerId" value={playerAId} checked={pick === playerAId} onChange={() => setPick(playerAId)} />
              {playerAName}
            </label>
            <label className="flex items-center gap-2 rounded-lg border border-slate-700 p-2 text-sm text-slate-300">
              <input type="radio" name="pickPlayerId" value={playerBId} checked={pick === playerBId} onChange={() => setPick(playerBId)} />
              {playerBName}
            </label>
          </div>
          <input
            type="number"
            name="stakeCoins"
            min={MIN_WAGER_STAKE}
            max={MAX_WAGER_STAKE}
            value={stake}
            onChange={(e) => setStake(Number(e.target.value))}
            placeholder={`Stake (${MIN_WAGER_STAKE} – ${MAX_WAGER_STAKE.toLocaleString()} coins)`}
            required
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-amber-500 focus:outline-none"
          />
          <p className="text-center text-xs text-slate-400">
            Potential win: +{potentialWin.toLocaleString()} coins (₦{coinsToNaira(potentialWin).toLocaleString('en-NG')})
          </p>
          {state?.error && <p className="text-center text-xs text-red-400">{state.error}</p>}
          {state?.success && <p className="text-center text-xs text-emerald-400">Wager placed.</p>}
          <SubmitButton />
          <p className="text-center text-[11px] text-slate-600">
            {myWager
              ? `Your wager: ${myWager.stakeCoins.toLocaleString()} coins on ${myWager.pickPlayerId === playerAId ? playerAName : playerBName}`
              : 'Your wager: none yet'}
          </p>
        </form>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Wire it into the Match Centre page**

```tsx
// app/(public)/matches/[id]/page.tsx — add imports:
import { WagerWidget } from '@/components/match/WagerWidget'
import { wagerWindowOpen } from '@/lib/wagers/market'
import { getCoinBalance } from '@/lib/coins/service'
import type { MembershipTier } from '@/lib/membership/tiers'
```

Replace the single `const admin = createAdminClient()` inside the existing `if (myResult?.screenshot_url)` block with a top-level admin client created once, right after `getMatch`, so it's available for the new coin-balance lookup too:

```tsx
// Directly after: const m = await getMatch(params.id); if (!m) notFound()
const admin = createAdminClient()
```

```tsx
// Update the existing screenshot block to reuse it instead of re-declaring:
  let screenshotUrl: string | null = null
  if (myResult?.screenshot_url) {
    const { data } = await admin.storage.from('match-evidence').createSignedUrl(myResult.screenshot_url, 3600)
    screenshotUrl = data?.signedUrl ?? null
  }
```

```tsx
// Add right after the existing bettingDisabledReason computation, before the shareText line:
  const { data: wagerRows } = await supabase
    .from('match_wagers')
    .select('bettor_id, pick_player_id, stake_coins, status, payout_coins')
    .eq('match_id', m.id)
  const wagers = (wagerRows ?? []) as { bettor_id: string; pick_player_id: string; stake_coins: number; status: string; payout_coins: number | null }[]
  const wagerPools = {
    playerA: wagers.filter((w) => w.pick_player_id === m.player_a_id && w.status !== 'refunded').reduce((s, w) => s + w.stake_coins, 0),
    playerB: wagers.filter((w) => w.pick_player_id === m.player_b_id && w.status !== 'refunded').reduce((s, w) => s + w.stake_coins, 0),
  }
  const myWagerRow = user ? wagers.find((w) => w.bettor_id === user.id) ?? null : null
  const myWager = myWagerRow ? { pickPlayerId: myWagerRow.pick_player_id, stakeCoins: myWagerRow.stake_coins } : null
  const wagerOutcome =
    myWagerRow && (myWagerRow.status === 'won' || myWagerRow.status === 'lost')
      ? { won: myWagerRow.status === 'won', payoutCoins: myWagerRow.payout_coins ?? 0, stakeCoins: myWagerRow.stake_coins }
      : null
  const wagerDisabledReason = isParticipant
    ? 'You cannot wager on your own match.'
    : !wagerWindowOpen({ status: m.status, scheduled_at: m.scheduled_at, player_a_id: m.player_a_id, player_b_id: m.player_b_id })
      ? 'Wagering is closed. Results pending.'
      : null
  const wagerCoinBalance = user ? await getCoinBalance(admin, user.id) : 0
```

```tsx
// In the JSX, right after the existing <BettingPanel .../> render:
      {!isParticipant && (
        <WagerWidget
          matchId={m.id}
          playerAId={m.player_a_id ?? ''}
          playerBId={m.player_b_id ?? ''}
          playerAName={nameOf(m.player_a)}
          playerBName={nameOf(m.player_b)}
          playerAAvatar={m.player_a?.avatar_url ?? null}
          playerBAvatar={m.player_b?.avatar_url ?? null}
          playerATier={(m.player_a?.membership_tier ?? 'recruit') as MembershipTier}
          playerBTier={(m.player_b?.membership_tier ?? 'recruit') as MembershipTier}
          pools={wagerPools}
          myWager={myWager}
          coinBalance={wagerCoinBalance}
          disabledReason={wagerDisabledReason}
          outcome={wagerOutcome}
        />
      )}
```

(Widget is gated on `!isParticipant` at the render site — the spec's "If player is one of the match participants: widget not shown" — rather than inside the component, matching how `showCheckIn`/`canSubmit` are already gated on the page, not inside `CheckInPanel`/`ResultSubmissionForm`.)

- [ ] **Step 3: Coin balance + recent activity panel on the wallet page**

The page (`app/dashboard/wallet/page.tsx`) already fetches its Naira data with `Promise.all` and renders `<BalanceHeroCard />`, `<QuickActionsRow />`, `<EarningsOverview ... />`, then a two-column grid — `<RecentTransactionsList />` on the left, a `space-y-4` sidebar with `<RewardsProgressWidget />` + `<WalletSecurityBadges />` on the right. The new SX Coins card is a natural third item in that sidebar; `getCoinBalance` joins the existing `Promise.all`.

```tsx
// app/dashboard/wallet/page.tsx — add imports:
import { getCoinBalance } from '@/lib/coins/service'
```

```tsx
// Extend the existing Promise.all with a 5th entry:
  const [walletRes, allTxnRes, pendingWithdrawalsRes, profileRes, coinBalance] = await Promise.all([
    admin.from('wallets').select('balance').eq('player_id', user.id).maybeSingle(),
    admin
      .from('wallet_transactions')
      .select('id, type, category, amount, reference_id, note, created_at')
      .eq('player_id', user.id)
      .order('created_at', { ascending: false }),
    admin.from('withdrawal_requests').select('id, amount, status').eq('player_id', user.id).eq('status', 'pending'),
    admin.from('profiles').select('xp, kyc_verified').eq('id', user.id).maybeSingle(),
    getCoinBalance(admin, user.id),
  ])
```

```tsx
// Separate query for the last 10 coin transactions, alongside the existing
// recentRaw/withdrawalStatusById block:
  const { data: coinTxRows } = await admin
    .from('sx_coin_transactions')
    .select('id, amount, source, description, created_at')
    .eq('player_id', user.id)
    .order('created_at', { ascending: false })
    .limit(10)
```

```tsx
// Return JSX — add the new card into the existing sidebar div:
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <RecentTransactionsList transactions={recentTransactions} />
        </div>
        <div className="space-y-4">
          <RewardsProgressWidget xp={profileRes.data?.xp ?? 0} />
          <WalletSecurityBadges kycVerified={profileRes.data?.kyc_verified ?? false} />
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">SX Coins</p>
              <p className="font-display text-xl font-black text-white">🪙 {coinBalance.toLocaleString()}</p>
            </div>
            {(coinTxRows ?? []).length === 0 ? (
              <p className="text-xs text-slate-500">No coin activity yet.</p>
            ) : (
              <ul className="space-y-1.5 text-xs text-slate-400">
                {(coinTxRows ?? []).map((tx) => (
                  <li key={tx.id} className="flex items-center justify-between gap-2">
                    <span className="truncate">{tx.description ?? tx.source.replace(/_/g, ' ')}</span>
                    <span className={tx.amount >= 0 ? 'font-semibold text-emerald-400' : 'font-semibold text-red-400'}>
                      {tx.amount >= 0 ? '+' : ''}
                      {tx.amount.toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
```

- [ ] **Step 4: Manual verification**

Run `npm run dev`, place a wager as a non-participant on a scheduled match, confirm the widget shows updated pool percentages after a refresh, confirm `/dashboard/wallet` shows the coin balance card and the `wager_stake` transaction in the activity list.

- [ ] **Step 5: Commit**

```bash
git add components/match/WagerWidget.tsx app/\(public\)/matches/\[id\]/page.tsx app/dashboard/wallet/page.tsx
git commit -m "feat(wagers): wager widget on Match Centre; coin balance/activity on wallet page" -m "$(printf 'Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>')"
```

---

### Task 11: Post boost — migration, `boostPost` action, feed ordering, `PostCard` UI, and the cash-disclaimer tooltip

**Context:** `community_posts`'s only player-facing UPDATE policy (`community_posts_player_delete`) has a `WITH CHECK (is_deleted = true)` that would reject a player-initiated `boosted_until` write — so `boostPost`, like `purchaseStoreItem`, must go through `createAdminClient()` throughout. The feed's non-pinned query (`lib/community/feed-query.ts`) already runs as a separate query from the pinned-announcements one — boost ordering only needs to change that second query's `.order()`, matching spec §6's "pinned to top of the feed (below announcements)".

**Files:**
- Create: `supabase/migrations/060_community_posts_boost.sql`
- Modify: `lib/community/post-actions.ts`
- Modify: `lib/community/feed-query.ts`
- Modify: `components/community/PostCard.tsx`
- Create: `components/coins/CoinDisclaimerTooltip.tsx`
- Modify: `app/store/page.tsx`
- Modify: `app/dashboard/wallet/page.tsx`

**Interfaces:**
- Consumes: `recordCoinTransaction`, `getCoinBalance` (`lib/coins/service.ts`).
- Produces: `boostPost(_prev: BoostState, formData: FormData): Promise<BoostState>`; `PostView.boostedUntil: string | null`; `<CoinDisclaimerTooltip />`.

- [ ] **Step 1: Apply the migration**

```sql
-- supabase/migrations/060_community_posts_boost.sql
-- Spec §6 — 200 coins pins a manual post to the top of the feed (below
-- announcements) for 24h.
ALTER TABLE public.community_posts
  ADD COLUMN boosted_until timestamptz;
```

Apply via `mcp__claude_ai_Supabase__apply_migration` (name `community_posts_boost`), then regenerate `lib/supabase/types.ts`.

- [ ] **Step 2: `boostPost` Server Action**

```ts
// lib/community/post-actions.ts — add to the existing file, alongside createPost/deletePost:
import { createAdminClient } from '@/lib/supabase/admin'
import { getCoinBalance, recordCoinTransaction } from '@/lib/coins/service'

export type BoostState = { error?: string; success?: boolean } | undefined

const BOOST_COST_COINS = 200
const BOOST_DURATION_MS = 24 * 60 * 60 * 1000

// Spec §6: 200 coins pins one manual post the player authored to the top of
// the feed for 24h; only one active boost per player at a time. Goes
// through createAdminClient() throughout — community_posts has no
// player-facing UPDATE policy that would permit writing boosted_until
// directly (community_posts_player_delete's WITH CHECK requires
// is_deleted = true on the new row), same reason purchaseStoreItem
// (lib/coins/actions.ts) uses the admin client for its writes.
export async function boostPost(_prev: BoostState, formData: FormData): Promise<BoostState> {
  const postId = String(formData.get('id') ?? '')
  if (!postId) return { error: 'Missing post.' }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const admin = createAdminClient()
  const { data: post } = await admin
    .from('community_posts')
    .select('id, author_id, post_type, boosted_until')
    .eq('id', postId)
    .maybeSingle()
  if (!post || post.author_id !== user.id || post.post_type !== 'manual') {
    return { error: 'You can only boost your own post.' }
  }

  const now = new Date()
  if (post.boosted_until && new Date(post.boosted_until) > now) {
    return { error: 'This post is already boosted.' }
  }
  const { count: activeBoostCount } = await admin
    .from('community_posts')
    .select('id', { count: 'exact', head: true })
    .eq('author_id', user.id)
    .gt('boosted_until', now.toISOString())
  if (activeBoostCount && activeBoostCount > 0) {
    return { error: 'You already have an active boost on another post.' }
  }

  const balance = await getCoinBalance(admin, user.id)
  if (balance < BOOST_COST_COINS) return { error: 'Not enough SX Coins to boost.' }

  await recordCoinTransaction(admin, user.id, -BOOST_COST_COINS, 'post_boost', postId, 'Boosted a community post')
  const boostedUntil = new Date(now.getTime() + BOOST_DURATION_MS).toISOString()
  const { error } = await admin.from('community_posts').update({ boosted_until: boostedUntil }).eq('id', postId)
  if (error) {
    // Refund — mirrors purchaseStoreItem's already-owned rollback pattern.
    await recordCoinTransaction(admin, user.id, BOOST_COST_COINS, 'post_boost', postId, 'Boost failed — auto-reversed')
    return { error: 'Could not boost this post. Please try again.' }
  }

  revalidatePath('/community')
  return { success: true }
}
```

- [ ] **Step 3: Feed ordering + `PostView.boostedUntil`**

```ts
// lib/community/feed-query.ts
// Add to PostView:
export interface PostView {
  id: string
  postType: PostType
  content: string
  imageUrl: string | null
  referenceId: string | null
  isPinned: boolean
  boostedUntil: string | null
  createdAt: string
  author: PlayerRef
  canDelete: boolean
  canBoost: boolean
  reactionCounts: Record<ReactionType, number>
  myReaction: ReactionType | null
  commentCount: number
  matchResult: MatchResultDetail | null
}

// Add boosted_until to RawPost and POST_SELECT:
type RawPost = {
  id: string
  author_id: string | null
  content: string
  image_url: string | null
  post_type: PostType
  reference_id: string | null
  is_pinned: boolean
  boosted_until: string | null
  created_at: string
  author: ProfileRef
}

const POST_SELECT =
  'id, author_id, content, image_url, post_type, reference_id, is_pinned, boosted_until, created_at, ' +
  `author:profiles!community_posts_author_id_fkey(${PROFILE_FIELDS})`

// In hydratePosts's final map, add:
  return rows.map((r) => ({
    id: r.id,
    postType: r.post_type,
    content: r.content,
    imageUrl: r.image_url,
    referenceId: r.reference_id,
    isPinned: r.is_pinned,
    boostedUntil: r.boosted_until,
    createdAt: r.created_at,
    author: toPlayerRef(firstProfile(r.author)),
    canDelete: r.post_type === 'manual' && viewerId != null && viewerId === r.author_id,
    canBoost:
      r.post_type === 'manual' &&
      viewerId != null &&
      viewerId === r.author_id &&
      (!r.boosted_until || new Date(r.boosted_until) <= new Date()),
    reactionCounts: reactionCountsByPost.get(r.id) ?? { fire: 0, crown: 0, strong: 0, wow: 0 },
    myReaction: myReactionByPost.get(r.id) ?? null,
    commentCount: commentCountByPost.get(r.id) ?? 0,
    matchResult: r.reference_id ? (matchDetailById.get(r.reference_id) ?? null) : null,
  }))

// In fetchFeedPage, change the non-pinned query's ordering (spec §6: "ORDER
// BY boosted_until DESC NULLS LAST, is_pinned DESC, created_at DESC" — the
// is_pinned term is already handled by this query being pre-filtered to
// is_pinned = false and run separately from the pinned-announcements query
// above it, so only the boosted_until/created_at ordering needs to change):
    supabase
      .from('community_posts')
      .select(POST_SELECT)
      .eq('is_deleted', false)
      .eq('is_pinned', false)
      .order('boosted_until', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .range(opts.offset, opts.offset + opts.limit),
```

- [ ] **Step 4: `PostCard` — boost button + boosted badge**

```tsx
// components/community/PostCard.tsx
'use client'
import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { HexAvatar } from '@/components/shared/HexAvatar'
import { TierBadge } from '@/components/player/TierBadge'
import { formatRelativeTime } from '@/lib/format'
import type { MembershipTier } from '@/lib/membership/tiers'
import type { PostView } from '@/lib/community/feed-query'
import { deletePost, boostPost } from '@/lib/community/post-actions'
import { MatchResultCard } from './MatchResultCard'
import { AnnouncementCard } from './AnnouncementCard'
import { ReactionBar } from './ReactionBar'
import { ShareButton } from './ShareButton'
import { ImageLightbox } from './ImageLightbox'

export function PostCard({ post, loggedIn }: { post: PostView; loggedIn: boolean }) {
  if (post.postType === 'match_result') return <MatchResultCard post={post} loggedIn={loggedIn} />
  if (post.postType === 'announcement') return <AnnouncementCard post={post} />
  return <ManualOrAchievementCard post={post} loggedIn={loggedIn} />
}

function ManualOrAchievementCard({ post, loggedIn }: { post: PostView; loggedIn: boolean }) {
  const router = useRouter()
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const isAchievement = post.postType === 'achievement'
  const isBoosted = !!post.boostedUntil && new Date(post.boostedUntil) > new Date()
  const name = post.author.displayName ?? post.author.username ?? 'Player'

  function onDelete() {
    startTransition(async () => {
      const fd = new FormData()
      fd.set('id', post.id)
      const res = await deletePost(undefined, fd)
      if (res?.error) setError(res.error)
      else router.refresh()
    })
  }

  function onBoost() {
    startTransition(async () => {
      const fd = new FormData()
      fd.set('id', post.id)
      const res = await boostPost(undefined, fd)
      if (res?.error) setError(res.error)
      else router.refresh()
    })
  }

  return (
    <div className={`rounded-2xl border bg-sx-surface p-4 ${isAchievement ? 'border-amber-500/30' : isBoosted ? 'border-amber-400/50' : 'border-sx-border'}`}>
      {isAchievement && <p className="mb-2 text-xs font-black uppercase tracking-widest text-amber-400">🏅 Achievement Unlocked</p>}
      {isBoosted && <p className="mb-2 text-xs font-black uppercase tracking-widest text-amber-400">🚀 Boosted</p>}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <HexAvatar src={post.author.avatarUrl} username={name} tier={post.author.membershipTier as MembershipTier} size="xs" />
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-sx-white">
              {post.author.username ? (
                <Link href={`/players/${post.author.username}`} className="hover:text-sx-purple-text">
                  {name}
                </Link>
              ) : (
                name
              )}
            </p>
            <div className="flex items-center gap-1.5">
              <TierBadge tier={post.author.sentinelTier} />
              <span className="text-[11px] text-sx-gray">· {formatRelativeTime(post.createdAt)}</span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {post.canBoost && (
            <button type="button" onClick={onBoost} disabled={pending} className="text-xs font-semibold text-amber-400 hover:text-amber-300 disabled:opacity-50">
              🚀 Boost (200 coins)
            </button>
          )}
          {post.canDelete && (
            <button type="button" onClick={onDelete} disabled={pending} className="text-xs font-semibold text-red-400 hover:text-red-300 disabled:opacity-50">
              Delete
            </button>
          )}
        </div>
      </div>

      <p className="mt-3 whitespace-pre-line text-sm text-sx-white/90">{post.content}</p>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

      {post.imageUrl && (
        <>
          <button type="button" onClick={() => setLightboxOpen(true)} className="mt-3 block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={post.imageUrl} alt="" className="max-h-80 w-full rounded-lg object-cover" />
          </button>
          {lightboxOpen && (
            <ImageLightbox urls={[post.imageUrl]} index={0} onClose={() => setLightboxOpen(false)} onIndexChange={() => {}} />
          )}
        </>
      )}

      <div className="mt-3 flex items-center justify-between gap-3">
        <ReactionBar postId={post.id} counts={post.reactionCounts} myReaction={post.myReaction} loggedIn={loggedIn} />
        <div className="flex items-center gap-3">
          <Link href={`/community/${post.id}`} className="text-xs font-semibold text-sx-gray hover:text-sx-white">
            💬 {post.commentCount}
          </Link>
          <ShareButton post={post} />
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: `CoinDisclaimerTooltip` — dismissible cash disclaimer**

```tsx
// components/coins/CoinDisclaimerTooltip.tsx
'use client'
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

// Spec §7 — shown once on first visit to the store/wallet page, then never
// again. Same dismiss-flag-in-localStorage shape as SentinelBubble
// (components/ui/SentinelBubble.tsx), simplified to a single fixed message
// with no CTA — this is a disclosure, not a guided-tour prompt.
const DISMISS_KEY = 'sx-coin-disclaimer-dismissed'

export function CoinDisclaimerTooltip() {
  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    setDismissed(localStorage.getItem(DISMISS_KEY) === '1')
  }, [])

  if (dismissed) return null

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, '1')
    setDismissed(true)
  }

  return (
    <div className="relative mb-4 rounded-xl border border-sx-purple/30 bg-sx-surface p-4">
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute right-3 top-3 text-slate-400 transition-colors hover:text-white"
      >
        <X className="h-4 w-4" />
      </button>
      <p className="pr-6 text-sm leading-snug text-sx-gray">
        🪙 SX Coins are earned by competing and spent on the platform. <strong className="text-white">They cannot be exchanged for cash.</strong>
      </p>
    </div>
  )
}
```

- [ ] **Step 6: Mount it on the store and wallet pages**

```tsx
// app/store/page.tsx — add the import and render it inside the page body,
// directly under the <header> block, above <StoreGrid ...>:
import { CoinDisclaimerTooltip } from '@/components/coins/CoinDisclaimerTooltip'
// ...
      {user && <CoinDisclaimerTooltip />}
      <StoreGrid items={items ?? []} ownedItemIds={ownedItemIds} equippedItemIds={equippedItemIds} isLoggedIn={!!user} />
```

```tsx
// app/dashboard/wallet/page.tsx — add the import and render it as the first
// child of the page's returned fragment, above <BalanceHeroCard ... />:
import { CoinDisclaimerTooltip } from '@/components/coins/CoinDisclaimerTooltip'
// ...
  return (
    <>
      <CoinDisclaimerTooltip />
      <BalanceHeroCard balance={walletRes.data?.balance ?? 0} pendingWithdrawal={pendingWithdrawalTotal} />
      {/* ...rest of the page unchanged... */}
```

- [ ] **Step 7: Manual verification**

Run `npm run dev`. As the author of a manual post with ≥200 coins, boost it and confirm it jumps above other non-pinned posts and shows the "🚀 Boosted" badge; confirm boosting a second post while one is still active returns "You already have an active boost." Visit `/store` and `/dashboard/wallet`, confirm the disclaimer shows once and stays dismissed after a reload.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/060_community_posts_boost.sql lib/supabase/types.ts lib/community/post-actions.ts lib/community/feed-query.ts components/community/PostCard.tsx components/coins/CoinDisclaimerTooltip.tsx app/store/page.tsx app/dashboard/wallet/page.tsx
git commit -m "feat(community): post boost (200 coins, 24h pin) and the cash-disclaimer tooltip" -m "$(printf 'Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>')"
```
