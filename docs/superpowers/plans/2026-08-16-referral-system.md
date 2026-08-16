# Referral System (Coin Economy Redesign) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the existing shipped ₦100-flat referral system (#22) into a coin-based system that rewards referrers when their recruit actually competes (first paid tournament entry), with milestone bonuses (5/10/25/50 conversions) and matching achievements, without dropping or losing any existing referral data.

**Architecture:** `referrals` (existing table, ALTERed not recreated) becomes a state machine: a row is inserted `pending` at signup (by `handle_new_user()`), then flipped to `converted` when the referred player's first paid tournament registration confirms. Conversion awards `+250 SX Coins` via the existing `sx_coin_transactions` ledger; milestone bonuses reuse the same ledger plus the existing `player_achievements`/`achievements` unlock pattern. The naira `wallet_transactions` history from the old system is left untouched as a historical record — no new naira referral credits are written.

**Tech Stack:** Next.js 14 App Router Server Components, Supabase (Postgres + RLS), TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-16-referral-system-design.md` (as adapted below — see Global Constraints for the required deviations from its literal text, all confirmed with the user).

## Global Constraints

- **Do NOT `CREATE TABLE referrals`.** It already exists (migration `019_referral_program.sql`) with real data. This plan `ALTER`s it.
- Existing `referrals` rows (created only at the moment of the old ₦100 credit) are backfilled `status = 'converted', converted_at = created_at`. Their historical ₦100 naira credit stays in `wallet_transactions` untouched — never touch/recompute that history.
- Going forward, referral rewards are SX Coins via `sx_coin_transactions` only. No new naira `wallet_transactions` rows are ever written for referrals again.
- Base reward: **+250 SX Coins**, `source = 'referral_reward'`, on first confirmed paid tournament entry.
- Milestones (exact converted-referral count, not cumulative >=): 1 → `referral_first`, 5 → `referral_squad`, 10 → `referral_champion`, 25 → `referral_sentinel`, 50 → `referral_legend`. Bonus coin amount for each comes from that achievement's own `coin_reward` column (250/500/1000/2500/5000) — there is exactly one coin award per milestone (the achievement unlock), not two.
- Idempotency for milestones is `player_achievements`' existing `UNIQUE(player_id, achievement_id)` constraint — the same mechanism `lib/achievements/unlock.ts` already relies on. Do not invent a second idempotency check.
- `sx_coin_transactions` has no `category` column — the real column is `source`, with an enumerated `CHECK` constraint (see migration `057_coin_transaction_sources.sql` for the pattern to extend). Add `'referral_reward'` and `'referral_milestone'`.
- `achievements.category` CHECK (migration `053_achievements.sql`) does not include `'social'` — extend it. `achievements` has no `icon` column — use the existing `icon_url` text column for the emoji.
- The `?ref=` capture at signup is **already implemented** via the `handle_new_user()` Postgres trigger (`supabase/migrations/019_referral_program.sql`), consuming `raw_user_meta_data->>'ref'` set by `lib/auth/actions.ts`'s `signup()`. Do not add a second capture path in the Server Action — extend the trigger instead, so referral capture stays atomic with profile creation.
- `/dashboard/referrals`, `ReferralPanel`, `ReferralEarningsCard`, and the dashboard nav entry all already exist and are live — this plan modifies them in place, it does not scaffold new stub pages.
- Self-referral is structurally prevented by the trigger (the referrer lookup only sees existing `profiles` rows; the new user's own row doesn't exist yet at that point) — no extra application-level guard needed.
- Every coin award goes through `recordCoinTransaction()` (`lib/coins/service.ts`) — never write `sx_coins.balance` directly.
- All referral settlement logic must be non-blocking: wrap in try/catch, log, never throw into a payment-confirmation caller.
- Migration number: **`063`** (last existing migration is `062_profile_settings.sql`).

---

### Task 1: Migration — schema, trigger, constraints, achievement seeds

**Files:**
- Create: `supabase/migrations/063_referral_coin_economy.sql`

**Interfaces:**
- Produces: `referrals.status` (`'pending' | 'converted' | 'invalid'`), `referrals.converted_at`, `referrals.coins_awarded`; a `referrals_referred_read` RLS policy; an extended `handle_new_user()` trigger that inserts a `pending` `referrals` row at signup; `sx_coin_transactions.source` CHECK extended with `'referral_reward'`, `'referral_milestone'`; `achievements.category` CHECK extended with `'social'`; 5 new `achievements` rows with slugs `referral_first`, `referral_squad`, `referral_champion`, `referral_sentinel`, `referral_legend`.

- [ ] **Step 1: Write the migration file**

```sql
-- 063_referral_coin_economy.sql
-- Referral system redesign (Phase 3): converts the existing flat ₦100-per-
-- referral naira credit (#22, migration 019) into a coin-based system with
-- milestone bonuses + achievements, tied into the SX Coins economy (Phase 2).
-- See docs/superpowers/specs/2026-08-16-referral-system-design.md.
--
-- Do NOT drop/recreate `referrals` — it already has production history.
-- Existing rows (previously inserted only at the moment of conversion, under
-- the old ₦100-at-paid-entry flow) are backfilled as already-converted;
-- their historical ₦100 credit lives on unchanged in wallet_transactions.
-- Going forward, a referrals row is created 'pending' at signup (via
-- handle_new_user()) and flipped to 'converted' + coin-rewarded when the
-- referred player's first paid tournament entry confirms.

ALTER TABLE public.referrals
  ADD COLUMN status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'converted', 'invalid')),
  ADD COLUMN converted_at timestamptz,
  ADD COLUMN coins_awarded integer;

-- Backfill: every existing row was only ever inserted at the old ₦100
-- credit moment, so it was already a completed conversion. coins_awarded
-- stays NULL for these — they were paid in naira, not coins.
UPDATE public.referrals SET status = 'converted', converted_at = created_at;

-- Spec §4 RLS: the referred player can now also read their own row (019
-- only let the referrer or an admin see it).
CREATE POLICY "referrals_referred_read" ON public.referrals
  FOR SELECT USING (referred_id = auth.uid());

-- Extend the signup trigger to also create the pending referrals row
-- atomically with the profile itself, so the referrals dashboard can show
-- "signed up, hasn't converted yet" players immediately. Self-referral is
-- structurally impossible here: v_referrer_id is resolved from EXISTING
-- profiles rows, and NEW's own row doesn't exist yet at this point.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_referrer_id uuid;
BEGIN
  v_referrer_id := (SELECT id FROM public.profiles WHERE username = NEW.raw_user_meta_data->>'ref');

  INSERT INTO public.profiles (id, username, display_name, referred_by)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'username',
    NEW.raw_user_meta_data->>'username',
    v_referrer_id
  )
  ON CONFLICT (id) DO NOTHING;

  IF v_referrer_id IS NOT NULL THEN
    INSERT INTO public.referrals (referrer_id, referred_id, status)
    VALUES (v_referrer_id, NEW.id, 'pending')
    ON CONFLICT (referred_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- Extend sx_coin_transactions.source for the two new referral sources.
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
    'post_boost',
    'referral_reward', 'referral_milestone'
  ));

-- Extend achievements.category for the new 'social' bucket.
ALTER TABLE public.achievements
  DROP CONSTRAINT achievements_category_check;
ALTER TABLE public.achievements
  ADD CONSTRAINT achievements_category_check CHECK (category IN (
    'matches', 'tournaments', 'score', 'season', 'profile', 'community', 'social'
  ));

INSERT INTO public.achievements (slug, name, description, icon_url, category, xp_reward, coin_reward, phase, share_to_feed, sort_order)
VALUES
  ('referral_first',    'First Recruit',       'Refer your first player who competes', '🤝', 'social', 100,   250, 'phase3', true, 31),
  ('referral_squad',    'Squad Builder',       'Refer 5 players who compete',          '👥', 'social', 300,   500, 'phase3', true, 32),
  ('referral_champion', 'Community Champion',  'Refer 10 players who compete',         '🌍', 'social', 500,  1000, 'phase3', true, 33),
  ('referral_sentinel', 'Sentinel Recruiter',  'Refer 25 players who compete',         '⚔️', 'social', 1000, 2500, 'phase3', true, 34),
  ('referral_legend',   'Legend Recruiter',    'Refer 50 players who compete',         '🏆', 'social', 2000, 5000, 'phase3', true, 35)
ON CONFLICT (slug) DO NOTHING;
```

- [ ] **Step 2: Apply the migration**

Use the Supabase MCP tool (`mcp__claude_ai_Supabase__apply_migration`) with this file's contents, name `063_referral_coin_economy`. If the CLI is reachable instead, `supabase db push` works too — MCP is the documented fallback when the CLI has connectivity issues.

If either `DROP CONSTRAINT` statement errors with "constraint does not exist", the constraint name differs from the assumed Postgres default. Look it up first:

```sql
SELECT conname FROM pg_constraint WHERE conrelid = 'public.sx_coin_transactions'::regclass AND contype = 'c';
SELECT conname FROM pg_constraint WHERE conrelid = 'public.achievements'::regclass AND contype = 'c';
```

and substitute the real name.

- [ ] **Step 3: Verify**

Run (via the Supabase MCP `execute_sql` tool):

```sql
SELECT status, converted_at IS NOT NULL AS has_converted_at, coins_awarded FROM public.referrals LIMIT 5;
SELECT slug, category, coin_reward, xp_reward FROM public.achievements WHERE slug LIKE 'referral_%' ORDER BY sort_order;
```

Expected: existing rows show `status = 'converted'` with `has_converted_at = true`; the 5 new achievement rows exist with `category = 'social'`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/063_referral_coin_economy.sql
git commit -m "feat(db): referral coin economy schema — status/converted_at/coins_awarded, pending-at-signup trigger, referral coin sources, social achievements"
```

---

### Task 2: Pure milestone lookup (`lib/referrals/constants.ts`)

**Files:**
- Modify: `lib/referrals/constants.ts`
- Test: `lib/referrals/constants.test.ts` (create)

**Interfaces:**
- Produces: `REFERRAL_BASE_REWARD_COINS: number`, `REFERRAL_MILESTONES: ReferralMilestone[]`, `pickMilestone(convertedCount: number): ReferralMilestone | null` — consumed by Task 3.

- [ ] **Step 1: Write the failing test**

```ts
// lib/referrals/constants.test.ts
import { describe, it, expect } from 'vitest'
import { pickMilestone } from './constants'

describe('pickMilestone', () => {
  it('returns the matching milestone at an exact threshold', () => {
    expect(pickMilestone(1)).toEqual({ count: 1, achievementSlug: 'referral_first' })
    expect(pickMilestone(5)).toEqual({ count: 5, achievementSlug: 'referral_squad' })
    expect(pickMilestone(10)).toEqual({ count: 10, achievementSlug: 'referral_champion' })
    expect(pickMilestone(25)).toEqual({ count: 25, achievementSlug: 'referral_sentinel' })
    expect(pickMilestone(50)).toEqual({ count: 50, achievementSlug: 'referral_legend' })
  })

  it('returns null between thresholds', () => {
    expect(pickMilestone(2)).toBeNull()
    expect(pickMilestone(6)).toBeNull()
    expect(pickMilestone(49)).toBeNull()
  })

  it('returns null past the highest threshold', () => {
    expect(pickMilestone(51)).toBeNull()
    expect(pickMilestone(1000)).toBeNull()
  })

  it('returns null at zero', () => {
    expect(pickMilestone(0)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/referrals/constants.test.ts`
Expected: FAIL — `pickMilestone` is not exported / module has no such export.

- [ ] **Step 3: Write the implementation**

```ts
// lib/referrals/constants.ts
// Legacy naira rate — no longer awarded for new referrals. Kept only
// because historical wallet_transactions rows predate this redesign.
export const REFERRAL_CREDIT_NGN = 100

// New coin economy (Phase 3 redesign) — see
// docs/superpowers/specs/2026-08-16-referral-system-design.md §5.
export const REFERRAL_BASE_REWARD_COINS = 250

export interface ReferralMilestone {
  count: number
  achievementSlug: string
}

export const REFERRAL_MILESTONES: ReferralMilestone[] = [
  { count: 1, achievementSlug: 'referral_first' },
  { count: 5, achievementSlug: 'referral_squad' },
  { count: 10, achievementSlug: 'referral_champion' },
  { count: 25, achievementSlug: 'referral_sentinel' },
  { count: 50, achievementSlug: 'referral_legend' },
]

// Pure — which milestone (if any) does this converted-referral count exactly
// hit? Called once per settlement, right after the count increments by one,
// so an exact-match lookup (not >=) is correct and never re-fires a
// milestone already passed.
export function pickMilestone(convertedCount: number): ReferralMilestone | null {
  return REFERRAL_MILESTONES.find((m) => m.count === convertedCount) ?? null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/referrals/constants.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/referrals/constants.ts lib/referrals/constants.test.ts
git commit -m "feat(referrals): milestone lookup table + pure pickMilestone"
```

---

### Task 3: Settlement orchestration (`lib/referrals/actions.ts`)

**Files:**
- Create: `lib/referrals/actions.ts`

**Interfaces:**
- Consumes: `pickMilestone`, `REFERRAL_BASE_REWARD_COINS` (Task 2); `recordCoinTransaction(admin, playerId, amount, source, referenceId, description?)` from `lib/coins/service.ts`; `awardXP(admin, playerId, xp, source, referenceId)` from `lib/membership/xp.ts`; `notifyInApp(...)` from `lib/notifications/inbox.ts`; `createAchievementPost(admin, playerId, achievement)` from `lib/community/feed-hooks.ts`.
- Produces: `settleReferral(admin, referralId, referrerId, referredPlayerId): Promise<void>` — consumed by Task 4.

This is IO orchestration against the database (matching the codebase's own convention — e.g. `confirmRegistration` in `lib/tournaments/confirm.ts` and `unlock()` in `lib/achievements/unlock.ts` are not unit tested either; only their pure helpers are). No unit test for this step; Task 1's schema plus Task 7's manual end-to-end verification cover it.

- [ ] **Step 1: Write the implementation**

```ts
// lib/referrals/actions.ts
import type { createAdminClient } from '@/lib/supabase/admin'
import { recordCoinTransaction } from '@/lib/coins/service'
import { awardXP } from '@/lib/membership/xp'
import { notifyInApp } from '@/lib/notifications/inbox'
import { createAchievementPost } from '@/lib/community/feed-hooks'
import { REFERRAL_BASE_REWARD_COINS, pickMilestone } from './constants'

type Admin = ReturnType<typeof createAdminClient>

interface MilestoneAchievement {
  id: string
  slug: string
  name: string
  description: string
  category: string
  xp_reward: number
  coin_reward: number
  share_to_feed: boolean
}

// Idempotency: player_achievements' UNIQUE(player_id, achievement_id)
// constraint is the real guard here — same pattern as
// lib/achievements/unlock.ts's unlock(). A race between two concurrent
// settleReferral calls hitting the same milestone results in one insert
// succeeding and one failing; only the winner awards coins/XP.
async function awardMilestone(admin: Admin, referrerId: string, achievementSlug: string): Promise<void> {
  const { data: achievement } = await admin
    .from('achievements')
    .select('id, slug, name, description, category, xp_reward, coin_reward, share_to_feed')
    .eq('slug', achievementSlug)
    .maybeSingle()
  if (!achievement) {
    console.error('[referrals] milestone achievement not seeded', { achievementSlug })
    return
  }
  const a = achievement as MilestoneAchievement

  const { error: insertErr } = await admin
    .from('player_achievements')
    .insert({ player_id: referrerId, achievement_id: a.id })
  if (insertErr) return // already unlocked (unique violation) — skip silently, do not double-award

  if (a.coin_reward > 0) {
    await recordCoinTransaction(admin, referrerId, a.coin_reward, 'referral_milestone', a.id, `${a.name} — referral milestone bonus`)
  }
  if (a.xp_reward > 0) {
    await awardXP(admin, referrerId, a.xp_reward, 'achievement_unlocked', a.id)
  }
  if (a.share_to_feed) {
    // Non-blocking — the milestone is unlocked and awarded above regardless
    // of whether the feed post succeeds (same contract as unlock.ts).
    try {
      await createAchievementPost(admin, referrerId, a)
    } catch (err) {
      console.error('[referrals] createAchievementPost failed (non-blocking)', { referrerId, achievementId: a.id, err })
    }
  }
  await notifyInApp({
    playerId: referrerId,
    type: 'achievement_unlocked',
    title: 'Referral milestone!',
    body: `${a.name} — +${a.xp_reward} XP, +${a.coin_reward} SX Coins.`,
    link: '/dashboard/referrals',
  })
}

// Settles a referral that just converted: awards the base coin reward to the
// referrer, then checks whether their new converted-referral count hits a
// milestone. Never throws — callers run this inside payment confirmation and
// a bookkeeping failure here must not fail a registration already charged.
export async function settleReferral(
  admin: Admin,
  referralId: string,
  referrerId: string,
  referredPlayerId: string,
): Promise<void> {
  try {
    const { data: referredProfile } = await admin
      .from('profiles')
      .select('display_name, username')
      .eq('id', referredPlayerId)
      .maybeSingle()
    const referredName = referredProfile?.display_name ?? referredProfile?.username ?? 'a player you referred'

    await recordCoinTransaction(
      admin,
      referrerId,
      REFERRAL_BASE_REWARD_COINS,
      'referral_reward',
      referralId,
      `Referral reward — ${referredName} completed first registration`,
    )
    await admin.from('referrals').update({ coins_awarded: REFERRAL_BASE_REWARD_COINS }).eq('id', referralId)

    await notifyInApp({
      playerId: referrerId,
      type: 'referral_credited',
      title: 'Referral credited',
      body: `${referredName} just competed for the first time — +${REFERRAL_BASE_REWARD_COINS} SX Coins added.`,
      link: '/dashboard/referrals',
    })

    const { count: convertedCount } = await admin
      .from('referrals')
      .select('id', { count: 'exact', head: true })
      .eq('referrer_id', referrerId)
      .eq('status', 'converted')

    const milestone = pickMilestone(convertedCount ?? 0)
    if (milestone) await awardMilestone(admin, referrerId, milestone.achievementSlug)
  } catch (err) {
    console.error('[referrals] settleReferral threw', {
      referralId,
      referrerId,
      referredPlayerId,
      message: err instanceof Error ? err.message : String(err),
    })
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors from this file (existing unrelated errors, if any, are out of scope).

- [ ] **Step 3: Commit**

```bash
git add lib/referrals/actions.ts
git commit -m "feat(referrals): settleReferral — base coin reward + milestone achievement unlock"
```

---

### Task 4: Rewrite the conversion trigger (`lib/referrals/credit.ts`)

**Files:**
- Modify: `lib/referrals/credit.ts`
- Test: `lib/referrals/credit.test.ts` (existing — unchanged, must still pass)

**Interfaces:**
- Consumes: `settleReferral` (Task 3).
- Produces: `qualifiesForReferralCredit(args): boolean` (unchanged signature — existing tests keep passing), `settleReferralForPaidEntry(admin, playerId, args): Promise<void>` (renamed from `creditReferralForPaidEntry` — consumed by Task 5).

- [ ] **Step 1: Confirm the existing pure-function tests still pass unmodified**

Run: `npm test -- lib/referrals/credit.test.ts`
Expected (before any edit): PASS — these test `qualifiesForReferralCredit`, which this task does not change.

- [ ] **Step 2: Rewrite the implementation**

```ts
// lib/referrals/credit.ts
import type { createAdminClient } from '@/lib/supabase/admin'
import { settleReferral } from './actions'

type Admin = ReturnType<typeof createAdminClient>

// A referral is earned by bringing in a player who actually pays to compete —
// not by bringing in an email address. A comped entry (fee_waived) doesn't
// qualify either: no money changed hands, so there's nothing for the
// referral to be a share of.
export function qualifiesForReferralCredit(args: {
  registrationFee: number
  feeWaived: boolean
}): boolean {
  return args.registrationFee > 0 && !args.feeWaived
}

// Best-effort: NEVER throws into the caller. This runs inside payment
// confirmation, and a referral bookkeeping failure must not fail a
// registration the player has already been charged for.
//
// Converts the referred player's existing 'pending' referrals row (created
// at signup by handle_new_user()) to 'converted'. Falls back to inserting a
// fresh 'converted' row for players who signed up before this pending-row
// migration landed (profiles.referred_by set, no referrals row yet) —
// mirrors the pre-redesign insert-at-conversion behaviour for that legacy
// population. Idempotent either way: the pending->converted UPDATE only
// ever affects a 'pending' row (0 rows the second time), and the fallback
// INSERT relies on referrals.referred_id's UNIQUE constraint (a 23505 means
// this player already converted, and is silently ignored).
export async function settleReferralForPaidEntry(
  admin: Admin,
  playerId: string,
  args: { registrationFee: number; feeWaived: boolean },
): Promise<void> {
  try {
    if (!qualifiesForReferralCredit(args)) return

    const { data: converted } = await admin
      .from('referrals')
      .update({ status: 'converted', converted_at: new Date().toISOString() })
      .eq('referred_id', playerId)
      .eq('status', 'pending')
      .select('id, referrer_id')

    let referral = converted?.[0] ?? null

    if (!referral) {
      const { data: profile } = await admin
        .from('profiles')
        .select('referred_by')
        .eq('id', playerId)
        .maybeSingle()
      if (!profile?.referred_by) return

      const { data: inserted, error } = await admin
        .from('referrals')
        .insert({
          referrer_id: profile.referred_by,
          referred_id: playerId,
          status: 'converted',
          converted_at: new Date().toISOString(),
        })
        .select('id, referrer_id')
        .single()
      if (error || !inserted) {
        if ((error as { code?: string })?.code !== '23505') {
          console.error('[referrals] legacy conversion insert failed', {
            playerId,
            code: (error as { code?: string })?.code,
            message: error?.message,
          })
        }
        return
      }
      referral = inserted
    }

    await settleReferral(admin, referral.id, referral.referrer_id, playerId)
  } catch (err) {
    console.error('[referrals] settleReferralForPaidEntry threw', {
      playerId,
      message: err instanceof Error ? err.message : String(err),
    })
  }
}
```

- [ ] **Step 3: Run the existing test again to confirm nothing broke**

Run: `npm test -- lib/referrals/credit.test.ts`
Expected: PASS (4 tests, unchanged — `qualifiesForReferralCredit`'s behavior didn't change)

- [ ] **Step 4: Commit**

```bash
git add lib/referrals/credit.ts
git commit -m "feat(referrals): settleReferralForPaidEntry — coin settlement replaces the naira credit"
```

---

### Task 5: Wire the conversion trigger into both confirmation paths

**Files:**
- Modify: `lib/tournaments/confirm.ts:5,90` (import + call site)
- Modify: `lib/tournaments/actions.ts` (add import + call in the coin-discount-to-zero branch, ~line 182-204)

**Interfaces:**
- Consumes: `settleReferralForPaidEntry` (Task 4).

- [ ] **Step 1: Update `lib/tournaments/confirm.ts`**

Change the import:

```ts
import { settleReferralForPaidEntry } from '@/lib/referrals/credit'
```

Change the call site (was `creditReferralForPaidEntry`):

```ts
  if (claimed && claimed.length > 0) {
    await settleReferralForPaidEntry(db, existing.player_id, {
      registrationFee: tournamentInfo?.registration_fee ?? 0,
      feeWaived: existing.fee_waived ?? false,
    })
  }
```

- [ ] **Step 2: Update `lib/tournaments/actions.ts`**

Add the import near the top, alongside the other `@/lib/coins/service` import:

```ts
import { settleReferralForPaidEntry } from '@/lib/referrals/credit'
```

In the coin-discount-to-zero branch (`if (netFee <= 0) { ... }`), call it right after the insert/update, before the `redirect`:

```ts
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

    await settleReferralForPaidEntry(admin, user.id, {
      registrationFee: tournament.registration_fee,
      feeWaived: false,
    })

    redirect(`/tournaments/${tournament.slug}?paid=1`)
  }
```

This is the only inline "free" branch that needs the call — the waiver branch (`feeWaived: true`) and the ₦0-tournament branch (`registrationFee === 0`) both fail `qualifiesForReferralCredit` unconditionally, so calling it there would be a guaranteed no-op; skip them to keep the diff minimal.

- [ ] **Step 3: Typecheck and run the tournaments test suite**

Run: `npx tsc --noEmit && npm test -- lib/tournaments`
Expected: no new errors; existing tournament tests still pass (this task doesn't change any tested pure logic — `decideConfirmation`, `checkCanRegister`, etc. are untouched).

- [ ] **Step 4: Commit**

```bash
git add lib/tournaments/confirm.ts lib/tournaments/actions.ts
git commit -m "feat(tournaments): settle referral coins on Paystack confirmation and the coin-discount free-entry path"
```

---

### Task 6: Rewrite the `/dashboard/referrals` page and panel

**Files:**
- Modify: `app/dashboard/referrals/page.tsx`
- Modify: `components/dashboard/ReferralPanel.tsx`

**Interfaces:**
- Consumes: `REFERRAL_MILESTONES` (Task 2); `HexAvatar` (`components/shared/HexAvatar.tsx`); `MembershipTier` (`lib/membership/tiers.ts`).
- Produces: `ReferredPlayer`, `MilestoneHistoryEntry` types exported from `ReferralPanel.tsx`.

No unit test for this step — it's Server Component data assembly + presentational UI, matching the convention of every other dashboard subpage in this codebase (none of `app/dashboard/wallet/page.tsx`, `app/dashboard/settings/page.tsx`, etc. have page-level tests).

- [ ] **Step 1: Rewrite `app/dashboard/referrals/page.tsx`**

```tsx
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { DashboardShell } from '@/components/dashboard/DashboardShell'
import { ReferralPanel, type ReferredPlayer, type MilestoneHistoryEntry } from '@/components/dashboard/ReferralPanel'
import { REFERRAL_MILESTONES } from '@/lib/referrals/constants'

export const metadata: Metadata = { title: 'Referrals · SentinelX Esports', robots: { index: false, follow: false } }

type ReferredRef =
  | { username: string | null; display_name: string | null; avatar_url: string | null; membership_tier: string | null }
  | { username: string | null; display_name: string | null; avatar_url: string | null; membership_tier: string | null }[]
  | null
function firstRef(r: ReferredRef) {
  return Array.isArray(r) ? (r[0] ?? null) : r
}

export default async function DashboardReferralsPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/dashboard/referrals')

  const admin = createAdminClient()
  const [profileRes, referralsRes, coinTxRes, milestoneTxRes, milestoneAchievementsRes] = await Promise.all([
    admin.from('profiles').select('username').eq('id', user.id).maybeSingle(),
    admin
      .from('referrals')
      .select(
        'id, status, created_at, converted_at, coins_awarded, referred:profiles!referrals_referred_id_fkey(username, display_name, avatar_url, membership_tier)',
      )
      .eq('referrer_id', user.id)
      .order('created_at', { ascending: false }),
    admin
      .from('sx_coin_transactions')
      .select('amount')
      .eq('player_id', user.id)
      .in('source', ['referral_reward', 'referral_milestone']),
    admin
      .from('sx_coin_transactions')
      .select('id, amount, description, created_at')
      .eq('player_id', user.id)
      .eq('source', 'referral_milestone')
      .order('created_at', { ascending: true }),
    admin
      .from('achievements')
      .select('slug, coin_reward')
      .in(
        'slug',
        REFERRAL_MILESTONES.map((m) => m.achievementSlug),
      ),
  ])

  const referredPlayers: ReferredPlayer[] = ((referralsRes.data ?? []) as unknown[]).map((raw) => {
    const r = raw as {
      id: string
      status: string
      created_at: string
      converted_at: string | null
      coins_awarded: number | null
      referred: ReferredRef
    }
    const p = firstRef(r.referred)
    return {
      id: r.id,
      name: p?.display_name ?? p?.username ?? 'Player',
      avatarUrl: p?.avatar_url ?? null,
      tier: (p?.membership_tier ?? 'recruit') as ReferredPlayer['tier'],
      status: r.status as 'pending' | 'converted' | 'invalid',
      date: r.converted_at ?? r.created_at,
      coinsAwarded: r.coins_awarded,
    }
  })

  const totalReferrals = referredPlayers.length
  const convertedCount = referredPlayers.filter((r) => r.status === 'converted').length
  const totalCoinsEarned = ((coinTxRes.data ?? []) as { amount: number }[]).reduce((sum, t) => sum + t.amount, 0)
  const milestoneHistory: MilestoneHistoryEntry[] = (
    (milestoneTxRes.data ?? []) as { id: string; amount: number; description: string | null; created_at: string }[]
  ).map((t) => ({
    id: t.id,
    description: t.description ?? 'Referral milestone bonus',
    coins: t.amount,
    date: t.created_at,
  }))

  const bonusBySlug = new Map(((milestoneAchievementsRes.data ?? []) as { slug: string; coin_reward: number }[]).map((a) => [a.slug, a.coin_reward]))
  const nextMilestone = REFERRAL_MILESTONES.find((m) => m.count > convertedCount) ?? null
  const nextMilestoneBonusCoins = nextMilestone ? (bonusBySlug.get(nextMilestone.achievementSlug) ?? null) : null

  return (
    <DashboardShell>
      <h1 className="text-lg font-bold text-white">Referrals</h1>
      <ReferralPanel
        username={profileRes.data?.username ?? ''}
        totalReferrals={totalReferrals}
        convertedCount={convertedCount}
        totalCoinsEarned={totalCoinsEarned}
        nextMilestoneCount={nextMilestone?.count ?? null}
        nextMilestoneBonusCoins={nextMilestoneBonusCoins}
        referredPlayers={referredPlayers}
        milestoneHistory={milestoneHistory}
      />
    </DashboardShell>
  )
}
```

- [ ] **Step 2: Rewrite `components/dashboard/ReferralPanel.tsx`**

```tsx
'use client'
import { useState } from 'react'
import { HexAvatar } from '@/components/shared/HexAvatar'
import type { MembershipTier } from '@/lib/membership/tiers'

export interface ReferredPlayer {
  id: string
  name: string
  avatarUrl: string | null
  tier: MembershipTier
  status: 'pending' | 'converted' | 'invalid'
  date: string
  coinsAwarded: number | null
}

export interface MilestoneHistoryEntry {
  id: string
  description: string
  coins: number
  date: string
}

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })
}

export function ReferralPanel({
  username,
  totalReferrals,
  convertedCount,
  totalCoinsEarned,
  nextMilestoneCount,
  nextMilestoneBonusCoins,
  referredPlayers,
  milestoneHistory,
}: {
  username: string
  totalReferrals: number
  convertedCount: number
  totalCoinsEarned: number
  nextMilestoneCount: number | null
  nextMilestoneBonusCoins: number | null
  referredPlayers: ReferredPlayer[]
  milestoneHistory: MilestoneHistoryEntry[]
}) {
  const [copied, setCopied] = useState(false)
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sentinelx.gg'
  const link = `${siteUrl}/signup?ref=${username}`
  const shareText = `Come compete on SentinelX — Nigeria's home of mobile esports! Sign up here: ${link}`
  const shareUrl = `https://wa.me/?text=${encodeURIComponent(shareText)}`

  function copyLink() {
    navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const progressPct = nextMilestoneCount ? Math.min(100, Math.round((convertedCount / nextMilestoneCount) * 100)) : 100

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">Bring in a friend. Earn coins when they compete.</p>

      <div className="rounded-2xl border border-sx-border bg-sx-surface p-4">
        <p className="text-[11px] uppercase text-sx-gray">Your referral link</p>
        <code className="mt-1 block truncate rounded-lg bg-sx-bg px-2.5 py-1.5 text-[11px] text-sx-gray">{link}</code>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={copyLink}
            className="flex-1 rounded-lg bg-sx-purple px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-sx-purple-light"
          >
            {copied ? 'Copied!' : 'Copy Link'}
          </button>
          <a
            href={shareUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 rounded-lg border border-sx-border px-2.5 py-1.5 text-center text-[11px] font-bold text-white hover:bg-sx-bg"
          >
            Share on WhatsApp
          </a>
        </div>
      </div>

      <p className="text-sm text-slate-300">
        {totalReferrals} total referral{totalReferrals === 1 ? '' : 's'} · {convertedCount} converted · +
        {totalCoinsEarned.toLocaleString()} coins earned
      </p>

      {nextMilestoneCount && (
        <div className="rounded-2xl border border-sx-border bg-sx-surface p-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-sx-white">Next Milestone</p>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-sx-bg">
            <div className="h-full rounded-full bg-sx-purple transition-all" style={{ width: `${progressPct}%` }} />
          </div>
          <p className="mt-1.5 text-[11px] text-sx-gray">
            {convertedCount} of {nextMilestoneCount} converted
            {nextMilestoneBonusCoins ? ` — +${nextMilestoneBonusCoins.toLocaleString()} coins bonus` : ''}
          </p>
        </div>
      )}

      <div>
        <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-sx-white">Referred Players</p>
        {referredPlayers.length === 0 ? (
          <p className="rounded-2xl border border-sx-border bg-sx-surface p-4 text-center text-xs text-sx-gray">
            No referrals yet — share your link to get started.
          </p>
        ) : (
          <div className="space-y-2">
            {referredPlayers.map((r) => (
              <div key={r.id} className="flex items-center gap-3 rounded-2xl border border-sx-border bg-sx-surface p-3">
                <HexAvatar src={r.avatarUrl} username={r.name} tier={r.tier} size="xs" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-white">{r.name}</p>
                  <p className="text-[11px] text-sx-gray">
                    {r.status === 'converted' ? '✅ Converted' : r.status === 'pending' ? '⏳ Pending' : '—'} · {formatShortDate(r.date)}
                    {r.coinsAwarded ? ` · +${r.coinsAwarded} coins` : ''}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {milestoneHistory.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-sx-white">Milestone History</p>
          <div className="space-y-1.5">
            {milestoneHistory.map((m) => (
              <p key={m.id} className="text-xs text-sx-gray">
                ✅ {m.description} — +{m.coins.toLocaleString()} coins ({formatShortDate(m.date)})
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add app/dashboard/referrals/page.tsx components/dashboard/ReferralPanel.tsx
git commit -m "feat(referrals): rebuild /dashboard/referrals — coin summary, milestone progress, pending/converted list, milestone history"
```

---

### Task 7: Wire coins into the wallet page's Referral Earnings card

**Files:**
- Modify: `components/wallet/ReferralEarningsCard.tsx`
- Modify: `app/dashboard/wallet/page.tsx`

**Interfaces:**
- `ReferralEarningsCard` prop signature changes from `{ referralLink, totalReferrals, totalEarned }` (naira) to `{ referralLink, convertedReferrals, totalCoinsEarned }` (coins).

- [ ] **Step 1: Rewrite `components/wallet/ReferralEarningsCard.tsx`**

```tsx
'use client'
import { useState } from 'react'
import Link from 'next/link'

export function ReferralEarningsCard({
  referralLink,
  convertedReferrals,
  totalCoinsEarned,
}: {
  referralLink: string
  convertedReferrals: number
  totalCoinsEarned: number
}) {
  const [copied, setCopied] = useState(false)
  function copyLink() {
    navigator.clipboard.writeText(referralLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div className="rounded-2xl border border-sx-border bg-sx-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-black uppercase tracking-widest text-sx-white">Referral Earnings</h2>
        <Link href="/dashboard/referrals" className="text-[11px] font-semibold text-sx-purple-text hover:text-sx-purple-light">
          View All →
        </Link>
      </div>
      <div className="flex items-center justify-between text-sm">
        <div>
          <p className="text-[10px] uppercase text-sx-gray">Converted Referrals</p>
          <p className="font-display text-lg font-black text-white">{convertedReferrals}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase text-sx-gray">Coins Earned</p>
          <p className="font-display text-lg font-black text-emerald-400">🪙 {totalCoinsEarned.toLocaleString()}</p>
        </div>
      </div>
      <p className="mt-3 text-[11px] text-sx-gray">Your Referral Link</p>
      <div className="mt-1 flex items-center gap-2">
        <code className="flex-1 truncate rounded-lg bg-sx-bg px-2.5 py-1.5 text-[11px] text-sx-gray">{referralLink}</code>
        <button
          type="button"
          onClick={copyLink}
          className="shrink-0 rounded-lg bg-sx-purple px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-sx-purple-light"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <p className="mt-2 text-[11px] text-sx-gray">Earn 250 SX Coins when your referral plays their first tournament.</p>
    </div>
  )
}
```

- [ ] **Step 2: Update `app/dashboard/wallet/page.tsx`**

Replace the `referralsRes` entry in the `Promise.all` array (currently counts ALL referrals, unfiltered) and add a coin-sum query. Change:

```ts
    admin.from('referrals').select('id', { count: 'exact', head: true }).eq('referrer_id', user.id),
```
to:
```ts
    admin.from('referrals').select('id', { count: 'exact', head: true }).eq('referrer_id', user.id).eq('status', 'converted'),
    admin.from('sx_coin_transactions').select('amount').eq('player_id', user.id).in('source', ['referral_reward', 'referral_milestone']),
```

and update the destructuring line accordingly:
```ts
  const [walletRes, allTxnRes, pendingWithdrawalsRes, profileRes, coinBalance, kycRes, referralsRes, referralCoinTxRes] = await Promise.all([
```

After `const breakdown = summarizeEarningsByCategory(allTxnRows)`, add:
```ts
  const referralCoinsEarned = ((referralCoinTxRes.data ?? []) as { amount: number }[]).reduce((sum, t) => sum + t.amount, 0)
```

Update the `ReferralEarningsCard` render call:
```tsx
        <ReferralEarningsCard
          referralLink={`${siteUrl}/signup?ref=${profileRes.data?.username ?? ''}`}
          convertedReferrals={referralsRes.count ?? 0}
          totalCoinsEarned={referralCoinsEarned}
        />
```

Leave the `EarningsOverview` component's `referral={breakdown.referral ?? 0}` line untouched — that's the general naira-breakdown-by-category widget and stays showing historical naira totals, per Global Constraints.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Manual verification**

Since neither of these files has direct tests, run the dev server and load `/dashboard/wallet` as a logged-in test player (or via `npm run build` to catch any Server Component data-shape error at build time) — confirm the page renders without a runtime error.

- [ ] **Step 5: Commit**

```bash
git add components/wallet/ReferralEarningsCard.tsx app/dashboard/wallet/page.tsx
git commit -m "feat(wallet): Referral Earnings card shows SX Coins instead of naira"
```

---

### Task 8: Admin referral analytics (`/admin/referrals`)

**Files:**
- Create: `app/admin/referrals/page.tsx`
- Modify: `lib/admin/nav.ts`

**Interfaces:**
- Consumes: `requireAdmin()` from `lib/admin/auth.ts` (same guard used by every other admin page, e.g. `app/admin/wallet/page.tsx`).

No test needed for `lib/admin/nav.ts` — `lib/admin/nav.test.ts` uses its own local fixture array, not `ADMIN_NAV` itself, so adding an entry doesn't require a test update (verified by reading the test file).

- [ ] **Step 1: Create `app/admin/referrals/page.tsx`**

```tsx
import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/admin/auth'

export const metadata: Metadata = { title: 'Referrals · Admin · SentinelX' }

type ProfileRef = { username: string | null; display_name: string | null } | null
function nameOf(p: ProfileRef): string {
  return p?.display_name ?? p?.username ?? 'Player'
}
function firstP(p: ProfileRef | ProfileRef[]): ProfileRef {
  return Array.isArray(p) ? (p[0] ?? null) : p
}

export default async function AdminReferralsPage() {
  await requireAdmin()
  const admin = createAdminClient()

  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)

  const [totalRes, convertedRes, monthRes, coinsRes, allConvertedRes] = await Promise.all([
    admin.from('referrals').select('id', { count: 'exact', head: true }),
    admin.from('referrals').select('id', { count: 'exact', head: true }).eq('status', 'converted'),
    admin
      .from('referrals')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'converted')
      .gte('converted_at', monthStart.toISOString()),
    admin.from('sx_coin_transactions').select('amount').in('source', ['referral_reward', 'referral_milestone']),
    admin
      .from('referrals')
      .select('referrer_id, profiles!referrals_referrer_id_fkey(username, display_name)')
      .eq('status', 'converted'),
  ])

  const totalCoinsDistributed = ((coinsRes.data ?? []) as { amount: number }[]).reduce((sum, t) => sum + t.amount, 0)

  const countByReferrer = new Map<string, { name: string; count: number }>()
  for (const raw of (allConvertedRes.data ?? []) as unknown[]) {
    const row = raw as { referrer_id: string; profiles: ProfileRef | ProfileRef[] }
    const existing = countByReferrer.get(row.referrer_id)
    const name = nameOf(firstP(row.profiles))
    countByReferrer.set(row.referrer_id, { name, count: (existing?.count ?? 0) + 1 })
  }
  const topReferrers = [...countByReferrer.values()].sort((a, b) => b.count - a.count).slice(0, 10)

  return (
    <section className="space-y-8">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <p className="text-[11px] uppercase text-slate-500">Total Referrals</p>
          <p className="font-display text-2xl font-black text-white">{totalRes.count ?? 0}</p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <p className="text-[11px] uppercase text-slate-500">Total Converted</p>
          <p className="font-display text-2xl font-black text-white">{convertedRes.count ?? 0}</p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <p className="text-[11px] uppercase text-slate-500">Converted This Month</p>
          <p className="font-display text-2xl font-black text-white">{monthRes.count ?? 0}</p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <p className="text-[11px] uppercase text-slate-500">Coins Distributed</p>
          <p className="font-display text-2xl font-black text-white">🪙 {totalCoinsDistributed.toLocaleString()}</p>
        </div>
      </div>

      <div>
        <h2 className="mb-4 text-base font-bold text-white">Top 10 Referrers</h2>
        {topReferrers.length === 0 ? (
          <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center text-sm text-slate-500">No conversions yet.</p>
        ) : (
          <div className="space-y-2">
            {topReferrers.map((r, i) => (
              <div key={`${r.name}-${i}`} className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900 p-4">
                <p className="font-bold text-white">
                  #{i + 1} {r.name}
                </p>
                <p className="text-sm text-slate-400">{r.count} converted</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Add the nav entry to `lib/admin/nav.ts`**

Insert after the `Wallet` entry:

```ts
  { label: 'Wallet', href: '/admin/wallet', adminOnly: true },
  { label: 'Referrals', href: '/admin/referrals', adminOnly: true },
  { label: 'Friendlies', href: '/admin/friendlies', adminOnly: true },
```

- [ ] **Step 3: Run the admin nav test suite to confirm it still passes**

Run: `npm test -- lib/admin/nav.test.ts`
Expected: PASS — the test file uses its own local `items` fixture, unaffected by this change.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add app/admin/referrals/page.tsx lib/admin/nav.ts
git commit -m "feat(admin): read-only referral analytics — totals, monthly conversions, coins distributed, top 10 referrers"
```

---

### Task 9: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass (840 baseline + 4 new `pickMilestone` tests = 844), 0 failures.

- [ ] **Step 2: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 4: Production build**

Run: `npm run build`
Expected: build succeeds — this is the strongest signal that every Server Component data shape (the new admin/referrals/dashboard queries) type-checks and every route compiles.

- [ ] **Step 5: Report back**

Confirm and report to the user:
- Migration number: `063`
- `achievements.slug` UNIQUE constraint: already existed (migration `053_achievements.sql`) — no change needed there; only the `category` CHECK needed extending (`'social'` added).
- `?ref=` threading: unchanged from the existing implementation — `lib/auth/actions.ts`'s `signup()` passes it as Supabase Auth signup metadata (`options.data.ref`), consumed entirely server-side by the `handle_new_user()` Postgres trigger, which this plan extended to also insert the pending `referrals` row atomically with profile creation. No Server-Action-side referral capture was added, since the trigger already owned this responsibility before this plan started.
- Milestone idempotency: `player_achievements`' existing `UNIQUE(player_id, achievement_id)` constraint — not a `sx_coin_transactions` lookup. The coin award only happens after the `player_achievements` insert succeeds.
- `sx_coin_transactions` exact columns used: `player_id`, `amount`, `balance_after`, `source` (not `category`), `reference_id`, `description` (not `note`).
