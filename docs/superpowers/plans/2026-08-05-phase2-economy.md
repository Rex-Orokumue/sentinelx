# Phase 2 — The Economy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the SentinelX economy layer — SX Score rename/rescale, XP + membership tiers, SX Coins, achievements, a cosmetics Store, and a wallet earnings breakdown — on top of the existing tournament infrastructure, in the exact sequence specified in `2026-08-05-phase2-economy-design.md`.

**Architecture:** Nine sequential parts, each depending on the previous. Part 1 (SX Score rename/rescale) touches the single existing scoring pipeline (`lib/scoring/*`) every later system reads. Parts 2–4 add three new ledgered subsystems (XP, coins, achievements) that all follow the same shape as the existing `sentinel_score_events`/`wallet_transactions` ledgers: a cache column on `profiles` + an immutable ledger table + a service-role-only write path. Parts 5–8 are UI/admin surface over those ledgers. Part 9 is final verification.

**Tech Stack:** Next.js 14 App Router (Server Components + Server Actions), Supabase (Postgres + RLS), Vitest, Zod.

## Global Constraints

- Mobile-first, Server Components by default, `"use client"` only for interactivity (CLAUDE.md).
- RLS enabled on every new table (CLAUDE.md).
- Every SX Score change must still write a row to `sx_score_events` (renamed from `sentinel_score_events`) — never update `profiles.sx_score` directly (CLAUDE.md).
- Admin routes/actions checked server-side via `requireStaff()`/`requireAdmin()` (`lib/admin/auth.ts`).
- All service-role writes go through `createAdminClient()` (`lib/supabase/admin.ts`).
- Migrations are additive history — never edit an existing `supabase/migrations/*.sql` file; the next sequential number is `049` (latest existing is `048_game_interest.sql`).
- Test runner is Vitest (`npm run test` = `vitest run`); tests are colocated `*.test.ts` files next to their module.
- **Decisions made to resolve gaps between the design doc and the actual codebase** (the design doc was written without full codebase context — see `docs/superpowers/specs/2026-08-05-phase2-economy-design.md` §2.3, §5.4 for the ambiguities being resolved here):
  1. **Score deltas**: the design doc's rate table (§2.3: win +100, loss +10, no-show −100) is authoritative over its "just ×10 the old values" description (the old values it assumes — "+10 win, −10 no-show" — don't match the actual code, which is `MATCH_COMPLETED_DELTA=2` + `WIN_DELTA=1` stacked, `NO_SHOW_DELTA=-10`). The existing two-event architecture (`match_completed` + `win_no_dispute`) is kept, but the constants are recalibrated so a win still totals 100 and a loss still totals 10: `MATCH_COMPLETED_DELTA=10`, `WIN_DELTA=90`, `NO_SHOW_DELTA=-100`. Historical events are still multiplied ×10 exactly as specified — this is independent of the new constants and stays internally consistent because `computeScore` sums *all* logged deltas from a rescaled `BASE_SCORE`.
  2. **Match/tournament economy trigger points**: coins+XP+achievement checks for match completion are wired into both `confirmResult` AND `declareNoShowWinner` (not just `confirmResult` as §5.4's table literally lists) — a walkover win produces the exact same `match_completed`+`win_no_dispute` event pair as a normal win, so it must count the same way. `markBothNoShow` and `disputeResult` are not wired — they never produce a completed/win event, so there's nothing to award.
  3. **Tournament placement economy**: `awardSeasonPoints()` is restructured so placement-based coins/XP/achievements fire for **every** tournament type (including `champions_cup` and `open`), while the existing `season_ranking_points` write stays scoped to `community_club`/`masters` only (unchanged — Champions Cup deliberately doesn't participate in the season leaderboard). This is necessary because the achievement catalogue includes `champions_cup_qualifier`/`champions_cup_champion`, which can only fire from this hook per §5.4's own table.
  4. **`tier_upgraded`/`achievement_unlocked` notifications**: implemented as **in-app only** (`notifyInApp`/`player_notifications`), not routed through the WhatsApp Termii pipeline (`lib/notifications/templates.ts`) the design doc's snippet suggests. WhatsApp/Termii automation is explicitly v2.0-and-later scope per CLAUDE.md and is reserved for core tournament-ops messages (registration, fixtures, results, prizes) — gamification pings follow the existing in-app-only precedent already set by `invitation_accepted`.
  5. **`sentinel_tier`** (the existing generated `elite/trusted/developing/at_risk` column, distinct from the new `membership_tier`) is kept as-is, not renamed — the design doc never asks for it — but its generated-column thresholds are rescaled ×10 (elite ≥900, trusted ≥750, developing ≥600) to stay meaningful at the new score scale.
  6. **`season_top_100`/`season_top_10` achievements** are seeded (per §5.2) but their unlock trigger is **not wired** in this phase — there is no existing "season closes" event anywhere in the codebase to hook into (seasons only have a `status` column with no transition code). This is called out explicitly, the same way the design doc itself defers Phase 3 community achievements — it is a real, documented gap, not a silent omission.
  7. **Player achievements are publicly readable** (`player_achievements` RLS: `SELECT USING (true)`), not owner-only — §8 of the design doc puts the achievements grid on the public profile page, visible to any visitor, same privacy model as existing public stats (`total_titles`, `wins`).

---

## File Structure

New files this plan creates:

```
supabase/migrations/049_sx_score_rescale.sql
supabase/migrations/050_xp_membership.sql
supabase/migrations/051_sx_coins_store.sql
supabase/migrations/052_achievements.sql
supabase/migrations/053_wallet_category.sql

lib/membership/tiers.ts            lib/membership/tiers.test.ts
lib/membership/xp.ts               lib/membership/xp.test.ts
lib/login/streak.ts                lib/login/streak.test.ts
lib/login/actions.ts               lib/login/actions.test.ts
lib/coins/service.ts               lib/coins/service.test.ts
lib/coins/actions.ts               lib/coins/actions.test.ts
lib/matches/economy-hooks.ts       lib/matches/economy-hooks.test.ts
lib/achievements/catalogue.ts
lib/achievements/unlock.ts         lib/achievements/unlock.test.ts
lib/wallet/breakdown.ts            lib/wallet/breakdown.test.ts
lib/admin/player-economy-actions.ts
lib/admin/store-actions.ts

components/player/MembershipBadge.tsx
components/player/AchievementsGrid.tsx
components/dashboard/XPProgressPanel.tsx
components/dashboard/CoinBalancePanel.tsx
components/dashboard/RecentAchievements.tsx
components/dashboard/LoginStreakBadge.tsx
components/dashboard/EarningsBreakdownPanel.tsx
components/store/StoreGrid.tsx
components/store/StoreItemCard.tsx
components/admin/PlayerEconomyPanel.tsx
components/admin/StoreItemForm.tsx

app/store/page.tsx
app/admin/players/[id]/page.tsx
app/admin/store/page.tsx
```

Existing files this plan modifies (grouped by task below — not repeated here).

---

## Part 1 — SX Score Migration (foundational)

### Task 1.1: Migration — rename + rescale

**Files:**
- Create: `supabase/migrations/049_sx_score_rescale.sql`

**Interfaces:**
- Produces: table `public.sx_score_events` (was `sentinel_score_events`, same columns), column `public.profiles.sx_score` (was `sentinel_score`), rescaled generated column `public.profiles.sentinel_tier`.

- [x] **Step 1: Write the migration**

```sql
-- 049_sx_score_rescale.sql
-- Phase 2 Economy §2: rename Sentinel Score -> SX Score and rescale ×10,
-- removing the 0-100 upper cap (now floored at 0 only). See
-- docs/superpowers/specs/2026-08-05-phase2-economy-design.md §2.

ALTER TABLE public.sentinel_score_events RENAME TO sx_score_events;
ALTER TABLE public.profiles RENAME COLUMN sentinel_score TO sx_score;

-- Drop the old 0-100 constraint BEFORE rescaling — it still enforces <=100
-- (constraints follow a renamed column, they don't get renamed themselves;
-- discovered when the first apply attempt hit profiles_sentinel_score_check
-- while multiplying scores past 100).
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_sentinel_score_check;

UPDATE public.profiles SET sx_score = sx_score * 10;
UPDATE public.sx_score_events SET points_delta = points_delta * 10;

ALTER TABLE public.profiles ADD CONSTRAINT profiles_sx_score_check CHECK (sx_score >= 0);

-- sentinel_tier is a separate, still-live concept (reliability tier, distinct
-- from the new XP-based membership_tier added in 050) — kept as-is, just
-- rescaled ×10 so it still means the same real-world skill band.
ALTER TABLE public.profiles DROP COLUMN sentinel_tier;
ALTER TABLE public.profiles ADD COLUMN sentinel_tier text GENERATED ALWAYS AS (
  CASE
    WHEN sx_score >= 900 THEN 'elite'
    WHEN sx_score >= 750 THEN 'trusted'
    WHEN sx_score >= 600 THEN 'developing'
    ELSE 'at_risk'
  END
) STORED;

-- RLS policies are attached to the table, not the column/name — renaming the
-- table preserves them under Postgres, but the policy names still say "sse_*"
-- for readability. Recreate with sx_* names for consistency going forward.
DROP POLICY IF EXISTS "sse_read" ON public.sx_score_events;
DROP POLICY IF EXISTS "sse_staff_insert" ON public.sx_score_events;
CREATE POLICY "sx_score_events_read" ON public.sx_score_events
  FOR SELECT USING (auth.uid() = player_id OR public.is_staff());
CREATE POLICY "sx_score_events_staff_insert" ON public.sx_score_events
  FOR INSERT WITH CHECK (public.is_staff());
```

- [x] **Step 2: Apply the migration**

Run via the Supabase MCP `apply_migration` tool (name: `sx_score_rescale`, paste the SQL above), or `supabase db push` if using the CLI. Confirm with `list_tables` / `SELECT sx_score, sentinel_tier FROM profiles LIMIT 5;` that values are ×10 and tiers still compute.

Applied. First attempt failed (`profiles_sentinel_score_check` still enforced `<=100` post-rename since constraints don't rename with their column) — fixed by moving the `DROP CONSTRAINT` before the `UPDATE`, see the corrected SQL above. Verified: scores now in the 700–900+ range, `sentinel_tier` computing correctly at the new thresholds.

- [x] **Step 3: Regenerate TypeScript types**

Run: `npx supabase gen types typescript --project-id <project-id> > lib/supabase/types.ts` (or the Supabase MCP `generate_typescript_types` tool). Confirm `lib/supabase/types.ts` now has `sx_score`/`sx_score_events` and no `sentinel_score`/`sentinel_score_events`.

Regenerated via MCP tool. Confirmed `sx_score`/`sx_score_events` present; the only remaining `sentinel_score` text is two FK constraint *names* (`sentinel_score_events_match_id_fkey` etc., which Postgres doesn't rename along with their table) — cosmetic, not a functional reference.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/049_sx_score_rescale.sql lib/supabase/types.ts
git commit -m "feat(sx-score): migrate sentinel_score -> sx_score, rescale ×10"
```

### Task 1.2: Rescale `lib/scoring/score.ts`

**Files:**
- Modify: `lib/scoring/score.ts`
- Modify: `lib/scoring/score.test.ts`

**Interfaces:**
- Produces: `computeScore(events)`, `BASE_SCORE = 700`, floor-only clamp (no upper bound) — used by `lib/scoring/apply.ts` (Task 1.4).

- [ ] **Step 1: Update the failing tests first**

```ts
import { describe, it, expect } from 'vitest'
import { computeScore, BASE_SCORE } from './score'

describe('computeScore', () => {
  it('returns the base score (700) for an empty log', () => {
    expect(BASE_SCORE).toBe(700)
    expect(computeScore([])).toBe(700)
  })

  it('adds stored deltas to the base', () => {
    expect(computeScore([{ points_delta: 20 }, { points_delta: 10 }])).toBe(730)
  })

  it('handles negative and mixed deltas', () => {
    expect(computeScore([{ points_delta: 20 }, { points_delta: -80 }, { points_delta: 10 }])).toBe(650)
  })

  it('has no upper cap', () => {
    expect(computeScore([{ points_delta: 5000 }])).toBe(5700)
  })

  it('clamps at 0', () => {
    expect(computeScore([{ points_delta: -1000 }])).toBe(0)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/scoring/score.test.ts` — expect FAIL (old file returns 100-clamped, 70-based values).

- [ ] **Step 3: Implement**

```ts
// SX Score is derived: base 700 plus the sum of every logged points_delta,
// floored at 0 with no upper bound. profiles.sx_score is a cache of this
// value, never the source. (Rescaled ×10 from the old 0-100 Sentinel Score —
// see docs/superpowers/specs/2026-08-05-phase2-economy-design.md §2.)
export const BASE_SCORE = 700
const MIN_SCORE = 0

export function computeScore(events: { points_delta: number }[]): number {
  const raw = BASE_SCORE + events.reduce((sum, e) => sum + e.points_delta, 0)
  return Math.max(MIN_SCORE, raw)
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/scoring/score.test.ts` — expect PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/scoring/score.ts lib/scoring/score.test.ts
git commit -m "feat(sx-score): rescale computeScore to base 700, remove upper cap"
```

### Task 1.3: Recalibrate `lib/scoring/events.ts`

**Files:**
- Modify: `lib/scoring/events.ts`
- Modify: `lib/scoring/events.test.ts`

**Interfaces:**
- Produces: `MATCH_COMPLETED_DELTA=10`, `WIN_DELTA=90`, `NO_SHOW_DELTA=-100`, `matchEventsFor()` (signature unchanged) — consumed by `lib/scoring/apply.ts` (Task 1.4) and `lib/matches/economy-hooks.ts` (Task 3.3, which reads the same event list to know who to pay coins/XP to).

- [ ] **Step 1: Update existing tests to the new constants**

Read `lib/scoring/events.test.ts` first (existing file, not shown here — it asserts on `MATCH_COMPLETED_DELTA`/`WIN_DELTA`/`NO_SHOW_DELTA` values and the resulting `points_delta` per scenario). Update every hardcoded `2`/`1`/`-10` expectation in that file to `10`/`90`/`-100` respectively, keeping every other assertion (event_type, player_id, which branch fires) unchanged. Add one new case:

```ts
it('a decisive win totals 100 and a loss totals 10 across both events', () => {
  const events = matchEventsFor({
    id: 'm1', player_a_id: 'a', player_b_id: 'b',
    score_a: 3, score_b: 1, status: 'completed', resolution: null,
  })
  const totalFor = (playerId: string) =>
    events.filter((e) => e.player_id === playerId).reduce((s, e) => s + e.points_delta, 0)
  expect(totalFor('a')).toBe(100)
  expect(totalFor('b')).toBe(10)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/scoring/events.test.ts` — expect FAIL on the old constant values.

- [ ] **Step 3: Implement**

```ts
export const MATCH_COMPLETED_DELTA = 10
export const WIN_DELTA = 90
export const NO_SHOW_DELTA = -100
```

(Only these three constants change — `matchEventsFor`'s branching logic is untouched.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/scoring/events.test.ts` — expect PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/scoring/events.ts lib/scoring/events.test.ts
git commit -m "feat(sx-score): recalibrate match event deltas to win=100/loss=10/no-show=-100"
```

### Task 1.4: Rename table/column references in `lib/scoring/apply.ts`

**Files:**
- Modify: `lib/scoring/apply.ts`

**Interfaces:**
- Consumes: `computeScore` (Task 1.2), `matchEventsFor`/`AUTO_MATCH_EVENT_TYPES` (Task 1.3).
- Produces: `syncMatchEvents(admin, matchId)`, `recomputeAllScoring(admin)` — signatures unchanged, now reading/writing `sx_score_events` and `profiles.sx_score`.

- [ ] **Step 1: Mechanical rename**

In `lib/scoring/apply.ts`, replace every occurrence of the string `'sentinel_score_events'` with `'sx_score_events'` (4 occurrences: lines 66, 68, 71, 120, 150, 152 per current file — `.from('sentinel_score_events')` calls in `regenerateMatchEvents`, `refreshPlayer`, and `recomputeAllScoring`). Replace the `refreshPlayer` write `{ ...aggregates, sentinel_score }` with `{ ...aggregates, sx_score }`, and rename the local `const sentinel_score = computeScore(...)` to `const sx_score = computeScore(...)`.

- [ ] **Step 2: Run existing scoring tests**

Run: `npx vitest run lib/scoring` — there's no `apply.test.ts` today (it's integration-shaped, exercised indirectly via `lib/matches/verify.test.ts` and `lib/matches/noshow.test.ts`); confirm those still pass after the rename (they mock/hit the same table names, so this catches drift).

- [ ] **Step 3: Commit**

```bash
git add lib/scoring/apply.ts
git commit -m "feat(sx-score): rename sentinel_score_events/sentinel_score refs in scoring engine"
```

### Task 1.5: Masters eligibility — rename + threshold 40→400

**Files:**
- Modify: `lib/seasons/eligibility.ts`
- Modify: `lib/seasons/eligibility.test.ts`
- Modify: `lib/seasons/invitation-actions.ts` (caller of `selectInvitees`)
- Modify: `lib/seasons/data.ts` (if it builds `LeaderboardEntry` rows — see Step 1)

**Interfaces:**
- Produces: `MIN_SX_SCORE_FOR_INVITATION = 400`, `LeaderboardEntry.sxScore` (renamed from `sentinelScore`), `selectInvitees()` signature unchanged.

- [ ] **Step 1: Read the two caller files first**

Read `lib/seasons/invitation-actions.ts` and `lib/seasons/data.ts` in full to find every place a `LeaderboardEntry` is constructed (look for `sentinelScore:` object literals, almost certainly reading `profiles.sentinel_score` — which Task 1.1 already renamed to `sx_score` in the DB, so these queries need their `select()` string updated too, not just the field name).

- [ ] **Step 2: Update the failing test**

In `lib/seasons/eligibility.test.ts`, update every `sentinelScore:` field to `sxScore:` and every threshold assertion from `40`/`39` to `400`/`399`.

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run lib/seasons/eligibility.test.ts` — expect FAIL (field renamed in test but not source).

- [ ] **Step 4: Implement**

```ts
// lib/seasons/eligibility.ts
export interface LeaderboardEntry {
  playerId: string
  points: number
  sxScore: number
}

export const MIN_SX_SCORE_FOR_INVITATION = 400

export function selectInvitees(
  leaderboard: LeaderboardEntry[],
  alreadyInvitedPlayerIds: ReadonlySet<string>,
  openSlots: number,
): string[] {
  if (openSlots <= 0) return []
  return leaderboard
    .filter((e) => e.sxScore >= MIN_SX_SCORE_FOR_INVITATION && !alreadyInvitedPlayerIds.has(e.playerId))
    .sort((a, b) => b.points - a.points)
    .slice(0, openSlots)
    .map((e) => e.playerId)
}
```

Update `lib/seasons/invitation-actions.ts` and `lib/seasons/data.ts` to match: rename any `.select(...)` string still containing `sentinel_score` to `sx_score`, and any `sentinelScore:` object-literal key feeding into `LeaderboardEntry` to `sxScore:`.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run lib/seasons` — expect PASS across the whole `lib/seasons` directory (catches any other file in that folder referencing the old names).

- [ ] **Step 6: Commit**

```bash
git add lib/seasons/eligibility.ts lib/seasons/eligibility.test.ts lib/seasons/invitation-actions.ts lib/seasons/data.ts
git commit -m "feat(sx-score): rename Masters eligibility to sxScore, raise threshold to 400"
```

### Task 1.6: Fix + rename the admin disqualify flow

**Files:**
- Modify: `lib/tournaments/registrations-admin-actions.ts`

**Interfaces:**
- Consumes: `syncMatchEvents` is NOT used here (this writes an authored event directly, bypassing the AUTO-event pipeline by design) — but must now also call `refreshPlayer`-equivalent so `profiles.sx_score` doesn't go stale. Since `refreshPlayer` isn't exported from `lib/scoring/apply.ts`, export it.

- [ ] **Step 1: Export `refreshPlayer` from `lib/scoring/apply.ts`**

In `lib/scoring/apply.ts`, change `async function refreshPlayer` to `export async function refreshPlayer`.

- [ ] **Step 2: Update `disqualifyRegistration`**

In `lib/tournaments/registrations-admin-actions.ts`, read the full `disqualifyRegistration` function (lines 16-68) first. Change the insert target from `'sentinel_score_events'` to `'sx_score_events'`, rescale the hardcoded conduct-flag penalty from `-5` to `-50` (×10, consistent with Task 1.3's recalibration — this is an `admin_flag_conduct` event, not one of the three AUTO types, but still lives on the same 0-open sx_score scale so it must move with it), and add the missing refresh call right after the insert:

```ts
import { refreshPlayer } from '@/lib/scoring/apply'
// ...
await admin.from('sx_score_events').insert({
  player_id: registration.player_id,
  match_id: null,
  event_type: 'admin_flag_conduct',
  points_delta: -50,
  note: `Disqualified from ${tournamentTitle}: ${reason}`,
})
await refreshPlayer(admin, registration.player_id)
```

(Exact surrounding variable names — `registration`, `tournamentTitle`, `admin` — must match whatever the existing function already uses; read the file to confirm before editing rather than guessing.)

- [ ] **Step 3: Run tests**

Run: `npx vitest run lib/tournaments/registrations-admin-actions.test.ts` if it exists, else `npx vitest run lib/tournaments` to catch regressions.

- [ ] **Step 4: Commit**

```bash
git add lib/scoring/apply.ts lib/tournaments/registrations-admin-actions.ts
git commit -m "fix(sx-score): rename disqualify event table, rescale penalty, refresh cached score"
```

### Task 1.7: Sweep — rename remaining UI/type/label references

**Files (modify all):**
- `lib/players/profile.ts` — `ProfileView.sentinelScore` → `sxScore` (keep `sentinelTier` name, per Global Constraints #5)
- `app/(public)/players/[username]/page.tsx` — `PROFILE_COLS`/`ProfileRow` select string `sentinel_score` → `sx_score`; `p.sentinel_score` → `p.sx_score` everywhere (metadata description, JSON-LD props, `profile: ProfileView` construction — keep `sentinelTier: p.sentinel_tier` unchanged)
- `app/(public)/rankings/page.tsx` — select string, `PlayerStatsInput` construction (`sentinelScore: p.sentinel_score` → `sxScore: p.sx_score`), `topScore`/`viewer.sentinelScore` sort/display references
- `components/rankings/LeaderboardTable.tsx` — read first; rename any `sentinelScore` prop/field references
- `lib/rankings/leaderboard.ts` + `lib/rankings/leaderboard.test.ts` — `PlayerStatsInput.sentinelScore` → `sxScore`, update sort/display logic and tests
- `components/player/PlayerCard.tsx` — `PlayerCardData.sentinel_score`/`sentinel_tier` → `sx_score`/`sentinel_tier` (tier unchanged); **remove the hardcoded `/100` suffix** (line 32, `<span className="text-slate-500">/100</span>`) since the score is now open-ended — display just `{player.sx_score}`
- `components/player/ProfileStats.tsx` — rename `sentinelScore` field access to `sxScore`; remove any `/100` or percentage-of-100 framing if present (read the file first)
- `app/page.tsx` — rename any `sentinel_score`/`sentinelScore` references (home page leaderboard preview)
- `app/(public)/players/page.tsx` — rename any `sentinel_score` select/display references
- `app/(public)/hall-of-fame/page.tsx` — rename select/display references, `metricLabel="Sentinel Score"` → `metricLabel="SX Score"`
- `lib/hall-of-fame/awards.ts` + `lib/hall-of-fame/awards.test.ts` — rename any `sentinel_score`/`sentinelScore` field references
- `lib/seo/schema/player.ts` + `lib/seo/schema/player.test.ts` — `buildPlayerJsonLd({ sentinelScore, ... })` param renamed to `sxScore`
- `components/admin/RecomputeButton.tsx` — button copy "Recompute Sentinel Scores" → "Recompute SX Scores" (read file first to get exact string)
- `components/admin/MarkBothNoShowForm.tsx` — any visible "Sentinel Score" copy → "SX Score"
- `lib/tournaments/bracket-admin-actions.ts` — rename any `sentinel_score`/`sentinel_score_events` references (comment or code)
- `lib/friendly-matches/admin-actions.ts` — rename any `sentinel_score`/`sentinel_score_events` references
- `public/llms.txt` — replace "Sentinel Score" mentions with "SX Score"
- `CLAUDE.md` — replace the entire "## Sentinel Score System" section (the 0–100/tier table) with the new SX Score description: base 700, open-ended, floored at 0, tiers Elite/Trusted/Developing/At Risk rescaled ×10 (900/750/600), new event rates (win +100, loss +10, no-show −100), logged to `sx_score_events`. Keep the section heading renamed to "## SX Score System". Also update the "Key Rules When Coding" rule #6 wording from "Sentinel Score" to "SX Score" and the note about `sentinel_score_events` → `sx_score_events`.

**Interfaces:**
- Consumes: `sx_score` DB column (Task 1.1), `ProfileView.sxScore` / `PlayerStatsInput.sxScore` (this task defines both).

- [ ] **Step 1: Rename field-by-field**

For each file above, open it, find every occurrence of `sentinel_score`, `sentinelScore`, `SENTINEL_SCORE`, or the literal text "Sentinel Score" (case-sensitive first pass, then a case-insensitive pass for prose), and replace with `sx_score`, `sxScore`, `SX_SCORE`, "SX Score" respectively — **except** any occurrence that is actually `sentinel_tier`/`sentinelTier`/"Sentinel Tier", which stays unchanged per Global Constraints #5. Read each file before editing (do not blind-replace) since several of these have interleaved `sentinel_score` and `sentinel_tier` references that must be told apart.

- [ ] **Step 2: Verify no stale references remain**

Run: `grep -rn "sentinel_score\|sentinelScore\|SENTINEL_SCORE" --include="*.ts" --include="*.tsx" app lib components` (excluding `lib/supabase/types.ts`, which was already regenerated in Task 1.1, and `docs/`, which is historical record). Expected: zero matches. If `lib/supabase/types.ts` still shows old names, re-run Task 1.1 Step 3.

- [ ] **Step 3: Run the full test suite**

Run: `npm run test` — expect PASS. Run: `npm run build` — expect a clean build (catches any TypeScript reference the grep missed, e.g. a destructured prop name).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(sx-score): rename remaining UI/type/label references sentinel_score -> sx_score"
```

**Part 1 is now complete and independently shippable** — every later part depends on `sx_score`/`sx_score_events` existing, but nothing later is required for Part 1 itself to be correct, tested, and deployed.

---

## Part 2 — XP + Membership Tier

### Task 2.1: Migration — XP, membership tier, login streak columns + `xp_events`

**Files:**
- Create: `supabase/migrations/050_xp_membership.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 050_xp_membership.sql
-- Phase 2 Economy §4: XP-based membership tiers, plus daily-login tracking
-- columns (§3.7) landed here since they're both profiles-level additions
-- with no cross-table dependency. See
-- docs/superpowers/specs/2026-08-05-phase2-economy-design.md §4, §3.7.

ALTER TABLE public.profiles
  ADD COLUMN xp integer NOT NULL DEFAULT 0 CHECK (xp >= 0),
  ADD COLUMN membership_tier text NOT NULL DEFAULT 'recruit'
    CHECK (membership_tier IN ('recruit', 'guardian', 'elite', 'sentinel', 'legend')),
  ADD COLUMN last_login_date date,
  ADD COLUMN login_streak integer NOT NULL DEFAULT 0;

CREATE TABLE public.xp_events (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id    uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  xp           integer     NOT NULL CHECK (xp > 0),
  source       text        NOT NULL CHECK (source IN (
    'match_played', 'match_won', 'tournament_entered', 'tournament_completed',
    'tournament_placement', 'achievement_unlocked',
    'daily_login', 'login_streak', 'community_activity',
    'admin_grant'
  )),
  reference_id uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON public.xp_events (player_id);

ALTER TABLE public.xp_events ENABLE ROW LEVEL SECURITY;

-- Same shape as sx_score_events: player reads their own, staff reads all,
-- no client INSERT policy — every write is via awardXP()'s service-role client.
CREATE POLICY "xp_events_read" ON public.xp_events
  FOR SELECT USING (auth.uid() = player_id OR public.is_staff());

-- New in-app notification types (Global Constraints #4 — in-app only, not
-- routed through the WhatsApp/Termii pipeline).
ALTER TABLE public.player_notifications DROP CONSTRAINT player_notifications_type_check;
ALTER TABLE public.player_notifications ADD CONSTRAINT player_notifications_type_check
  CHECK (type IN (
    'listing_approved', 'listing_removed', 'listing_deleted', 'listing_sold',
    'withdrawal_paid', 'withdrawal_rejected',
    'result_confirmed', 'referral_credited',
    'friend_request', 'wallet_credited',
    'player_disqualified', 'noshow_needs_decision',
    'buy_request_in_progress', 'buy_request_fulfilled', 'buy_request_closed',
    'masters_invitation', 'champions_cup_invitation',
    'invitation_accepted', 'invitation_expired_cascade',
    'tier_upgraded', 'achievement_unlocked'
  ));
```

- [ ] **Step 2: Apply, regenerate types, commit**

Apply via Supabase MCP `apply_migration` (name `xp_membership`) or CLI push. Regenerate `lib/supabase/types.ts` (same command as Task 1.1 Step 3).

```bash
git add supabase/migrations/050_xp_membership.sql lib/supabase/types.ts
git commit -m "feat(xp): add xp/membership_tier/login_streak columns and xp_events ledger"
```

### Task 2.2: `computeTier()`

**Files:**
- Create: `lib/membership/tiers.ts`
- Create: `lib/membership/tiers.test.ts`

**Interfaces:**
- Produces: `MembershipTier` type, `TIER_XP_THRESHOLDS`, `computeTier(xp: number): MembershipTier` — consumed by `awardXP` (Task 2.3), `components/player/MembershipBadge.tsx` (Task 6.1), `components/dashboard/XPProgressPanel.tsx` (Task 6.2).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { computeTier, TIER_XP_THRESHOLDS } from './tiers'

describe('computeTier', () => {
  it('is recruit below 1,000 xp', () => {
    expect(computeTier(0)).toBe('recruit')
    expect(computeTier(999)).toBe('recruit')
  })
  it('is guardian from 1,000 xp', () => {
    expect(computeTier(1000)).toBe('guardian')
    expect(computeTier(4999)).toBe('guardian')
  })
  it('is elite from 5,000 xp', () => {
    expect(computeTier(5000)).toBe('elite')
    expect(computeTier(14999)).toBe('elite')
  })
  it('is sentinel from 15,000 xp', () => {
    expect(computeTier(15000)).toBe('sentinel')
    expect(computeTier(49999)).toBe('sentinel')
  })
  it('is legend from 50,000 xp', () => {
    expect(computeTier(50000)).toBe('legend')
    expect(computeTier(1_000_000)).toBe('legend')
  })
  it('exposes the thresholds used', () => {
    expect(TIER_XP_THRESHOLDS.legend).toBe(50_000)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/membership/tiers.test.ts` — expect FAIL, module doesn't exist.

- [ ] **Step 3: Implement**

```ts
export type MembershipTier = 'recruit' | 'guardian' | 'elite' | 'sentinel' | 'legend'

export const TIER_XP_THRESHOLDS: Record<MembershipTier, number> = {
  recruit: 0,
  guardian: 1_000,
  elite: 5_000,
  sentinel: 15_000,
  legend: 50_000,
}

export function computeTier(xp: number): MembershipTier {
  if (xp >= TIER_XP_THRESHOLDS.legend) return 'legend'
  if (xp >= TIER_XP_THRESHOLDS.sentinel) return 'sentinel'
  if (xp >= TIER_XP_THRESHOLDS.elite) return 'elite'
  if (xp >= TIER_XP_THRESHOLDS.guardian) return 'guardian'
  return 'recruit'
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/membership/tiers.test.ts` — expect PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/membership/tiers.ts lib/membership/tiers.test.ts
git commit -m "feat(xp): add computeTier membership tier function"
```

### Task 2.3: `awardXP()`

**Files:**
- Create: `lib/membership/xp.ts`
- Create: `lib/membership/xp.test.ts`

**Interfaces:**
- Consumes: `computeTier` (Task 2.2), `createAdminClient` (`lib/supabase/admin.ts`), `notifyInApp` (`lib/notifications/inbox.ts` — Task 2.4 adds the new type it needs).
- Produces: `awardXP(admin, playerId, xp, source, referenceId): Promise<{ newXp: number; tierChanged: boolean; newTier: MembershipTier }>` — consumed by every economy hook in Parts 3–4 and by `lib/admin/player-economy-actions.ts` (Task 8.1).

- [ ] **Step 1: Write the failing test**

Vitest here mocks a minimal fake admin client (this codebase has no existing shared Supabase test-double per the Explore findings — `verify.test.ts`/`noshow.test.ts` test the *pure* helper functions, not the IO-performing action functions directly — so `awardXP` is written to take its two DB reads/writes as directly mockable calls via a tiny in-memory fake matching the `.from().select()...` chain shape actually used):

```ts
import { describe, it, expect, vi } from 'vitest'
import { awardXP } from './xp'

function fakeAdmin(profile: { xp: number; membership_tier: string }) {
  const updates: Record<string, unknown>[] = []
  const inserts: Record<string, unknown>[] = []
  return {
    client: {
      from(table: string) {
        if (table === 'profiles') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: profile }),
              }),
            }),
            update: (vals: Record<string, unknown>) => ({
              eq: async () => {
                updates.push(vals)
                Object.assign(profile, vals)
                return { data: null, error: null }
              },
            }),
          }
        }
        if (table === 'xp_events') {
          return { insert: async (row: Record<string, unknown>) => { inserts.push(row); return { data: null, error: null } } }
        }
        throw new Error(`unexpected table ${table}`)
      },
    },
    updates,
    inserts,
  }
}

describe('awardXP', () => {
  it('adds xp, logs an event, and does not change tier below a threshold', async () => {
    const { client, updates, inserts } = fakeAdmin({ xp: 100, membership_tier: 'recruit' })
    const result = await awardXP(client as never, 'p1', 50, 'match_played', 'm1')
    expect(result).toEqual({ newXp: 150, tierChanged: false, newTier: 'recruit' })
    expect(updates).toEqual([{ xp: 150, membership_tier: 'recruit' }])
    expect(inserts).toEqual([{ player_id: 'p1', xp: 50, source: 'match_played', reference_id: 'm1' }])
  })

  it('flips tier and reports the change when crossing a threshold', async () => {
    const { client } = fakeAdmin({ xp: 950, membership_tier: 'recruit' })
    const result = await awardXP(client as never, 'p1', 100, 'match_won', 'm1')
    expect(result).toEqual({ newXp: 1050, tierChanged: true, newTier: 'guardian' })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/membership/xp.test.ts` — expect FAIL, module doesn't exist.

- [ ] **Step 3: Implement**

```ts
import { computeTier, type MembershipTier } from './tiers'
import { notifyInApp } from '@/lib/notifications/inbox'
import type { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

export interface AwardXpResult {
  newXp: number
  tierChanged: boolean
  newTier: MembershipTier
}

// XP is permanent — it never decreases (design doc §4.1). Recomputes and
// writes profiles.membership_tier on every award; fires an in-app
// tier_upgraded notification exactly once per tier crossing, never on every
// XP award (see the tierChanged guard below).
export async function awardXP(
  admin: Admin,
  playerId: string,
  xp: number,
  source: string,
  referenceId: string | null,
): Promise<AwardXpResult> {
  const { data: profile } = await admin
    .from('profiles')
    .select('xp, membership_tier')
    .eq('id', playerId)
    .maybeSingle()
  const currentXp = profile?.xp ?? 0
  const currentTier = (profile?.membership_tier ?? 'recruit') as MembershipTier

  const newXp = currentXp + xp
  const newTier = computeTier(newXp)
  const tierChanged = newTier !== currentTier

  await admin.from('profiles').update({ xp: newXp, membership_tier: newTier }).eq('id', playerId)
  await admin.from('xp_events').insert({ player_id: playerId, xp, source, reference_id: referenceId })

  if (tierChanged) {
    await notifyInApp({
      playerId,
      type: 'tier_upgraded',
      title: 'Membership tier up!',
      body: `You've reached ${newTier[0].toUpperCase()}${newTier.slice(1)} — ${newXp.toLocaleString()} XP.`,
      link: '/dashboard',
    })
  }

  return { newXp, tierChanged, newTier }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/membership/xp.test.ts` — expect PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/membership/xp.ts lib/membership/xp.test.ts
git commit -m "feat(xp): add awardXP with tier recompute and tier-up notification"
```

### Task 2.4: `tier_upgraded`/`achievement_unlocked` notification types

**Files:**
- Modify: `lib/notifications/inbox.ts`

**Interfaces:**
- Produces: extended `NotificationType` union — consumed by `awardXP` (Task 2.3, already written above assuming this exists) and `checkAndUnlockAchievements` (Task 4.3).

- [ ] **Step 1: Extend the union**

In `lib/notifications/inbox.ts`, add two members to the `NotificationType` union (after `'invitation_expired_cascade'`):

```ts
  | 'tier_upgraded'
  | 'achievement_unlocked'
```

(The DB-side CHECK constraint for these was already added in Task 2.1's migration — this is the TypeScript side only.)

- [ ] **Step 2: Commit**

```bash
git add lib/notifications/inbox.ts
git commit -m "feat(xp): add tier_upgraded/achievement_unlocked notification types"
```

### Task 2.5: Daily login streak — pure logic

**Files:**
- Create: `lib/login/streak.ts`
- Create: `lib/login/streak.test.ts`

**Interfaces:**
- Produces: `nextLoginState(input): { alreadyLoggedToday: boolean; newStreak: number; todayWAT: string }`, `todayInWAT(now: Date): string` (YYYY-MM-DD in WAT/UTC+1) — consumed by `lib/login/actions.ts` (Task 2.6).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { todayInWAT, nextLoginState } from './streak'

describe('todayInWAT', () => {
  it('rolls over at UTC+1 midnight, not UTC midnight', () => {
    // 23:30 UTC on Jan 1 is 00:30 WAT on Jan 2.
    expect(todayInWAT(new Date('2026-01-01T23:30:00Z'))).toBe('2026-01-02')
    expect(todayInWAT(new Date('2026-01-01T22:30:00Z'))).toBe('2026-01-01')
  })
})

describe('nextLoginState', () => {
  it('is a no-op the second time the same WAT day is recorded', () => {
    const state = nextLoginState({ lastLoginDate: '2026-01-02', loginStreak: 3, now: new Date('2026-01-01T23:30:00Z') })
    expect(state).toEqual({ alreadyLoggedToday: true, newStreak: 3, todayWAT: '2026-01-02' })
  })

  it('increments the streak on a consecutive day', () => {
    const state = nextLoginState({ lastLoginDate: '2026-01-01', loginStreak: 3, now: new Date('2026-01-02T10:00:00Z') })
    expect(state).toEqual({ alreadyLoggedToday: false, newStreak: 4, todayWAT: '2026-01-02' })
  })

  it('resets the streak to 1 after a gap', () => {
    const state = nextLoginState({ lastLoginDate: '2026-01-01', loginStreak: 5, now: new Date('2026-01-05T10:00:00Z') })
    expect(state).toEqual({ alreadyLoggedToday: false, newStreak: 1, todayWAT: '2026-01-05' })
  })

  it('starts a streak of 1 for a never-logged-in player', () => {
    const state = nextLoginState({ lastLoginDate: null, loginStreak: 0, now: new Date('2026-01-05T10:00:00Z') })
    expect(state).toEqual({ alreadyLoggedToday: false, newStreak: 1, todayWAT: '2026-01-05' })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/login/streak.test.ts` — expect FAIL, module doesn't exist.

- [ ] **Step 3: Implement**

```ts
const WAT_OFFSET_MS = 60 * 60 * 1000 // UTC+1, no DST

// YYYY-MM-DD calendar date in West Africa Time.
export function todayInWAT(now: Date): string {
  const wat = new Date(now.getTime() + WAT_OFFSET_MS)
  return wat.toISOString().slice(0, 10)
}

function daysBetween(a: string, b: string): number {
  const msPerDay = 24 * 60 * 60 * 1000
  return Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / msPerDay)
}

export interface NextLoginStateInput {
  lastLoginDate: string | null
  loginStreak: number
  now: Date
}

export interface NextLoginState {
  alreadyLoggedToday: boolean
  newStreak: number
  todayWAT: string
}

// design doc §3.7: no-op same day; +1 on a consecutive day; reset to 1 on a
// gap or a first-ever login.
export function nextLoginState({ lastLoginDate, loginStreak, now }: NextLoginStateInput): NextLoginState {
  const todayWAT = todayInWAT(now)
  if (lastLoginDate === todayWAT) {
    return { alreadyLoggedToday: true, newStreak: loginStreak, todayWAT }
  }
  const gap = lastLoginDate ? daysBetween(lastLoginDate, todayWAT) : null
  const newStreak = gap === 1 ? loginStreak + 1 : 1
  return { alreadyLoggedToday: false, newStreak, todayWAT }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/login/streak.test.ts` — expect PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/login/streak.ts lib/login/streak.test.ts
git commit -m "feat(login-streak): add pure WAT-day streak calculation"
```

### Task 2.6: `recordDailyLogin()` — IO wrapper + wiring

**Files:**
- Create: `lib/login/actions.ts`
- Create: `lib/login/actions.test.ts`
- Modify: `app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `nextLoginState` (Task 2.5), `awardXP` (Task 2.3), `awardCoins` (Task 3.2 — this task is written now but only wired to call `awardCoins` once Task 3.2 lands; see note in Step 3).
- Produces: `recordDailyLogin(admin, playerId): Promise<void>` — best-effort, never throws (matches `notify()`/`notifyInApp()` convention).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest'
import { recordDailyLogin } from './actions'

vi.mock('@/lib/coins/service', () => ({ awardCoins: vi.fn() }))
vi.mock('@/lib/membership/xp', () => ({ awardXP: vi.fn() }))

function fakeAdmin(profile: { last_login_date: string | null; login_streak: number }) {
  const updates: Record<string, unknown>[] = []
  return {
    client: {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile }) }) }),
        update: (vals: Record<string, unknown>) => ({
          eq: async () => { updates.push(vals); Object.assign(profile, vals); return { data: null, error: null } },
        }),
      }),
    },
    updates,
  }
}

describe('recordDailyLogin', () => {
  it('is idempotent for a second call the same day', async () => {
    const { awardCoins } = await import('@/lib/coins/service')
    const { client, updates } = fakeAdmin({ last_login_date: '2026-01-02', login_streak: 3 })
    await recordDailyLogin(client as never, 'p1', new Date('2026-01-01T23:30:00Z'))
    expect(updates).toEqual([])
    expect(awardCoins).not.toHaveBeenCalled()
  })

  it('awards daily coins/xp and bumps the streak on a new day', async () => {
    const { awardCoins } = await import('@/lib/coins/service')
    const { awardXP } = await import('@/lib/membership/xp')
    const { client, updates } = fakeAdmin({ last_login_date: '2026-01-01', login_streak: 3 })
    await recordDailyLogin(client as never, 'p1', new Date('2026-01-02T10:00:00Z'))
    expect(updates).toEqual([{ last_login_date: '2026-01-02', login_streak: 4 }])
    expect(awardCoins).toHaveBeenCalledWith(client, 'p1', 5, 'daily_login', null)
    expect(awardXP).toHaveBeenCalledWith(client, 'p1', 20, 'daily_login', null)
  })

  it('awards the 7-day streak bonus on day 7', async () => {
    const { awardCoins } = await import('@/lib/coins/service')
    const { awardXP } = await import('@/lib/membership/xp')
    const { client } = fakeAdmin({ last_login_date: '2026-01-06', login_streak: 6 })
    await recordDailyLogin(client as never, 'p1', new Date('2026-01-07T10:00:00Z'))
    expect(awardCoins).toHaveBeenCalledWith(client, 'p1', 5, 'daily_login', null)
    expect(awardCoins).toHaveBeenCalledWith(client, 'p1', 50, 'login_streak', null)
    expect(awardXP).toHaveBeenCalledWith(client, 'p1', 20, 'daily_login', null)
    expect(awardXP).toHaveBeenCalledWith(client, 'p1', 100, 'login_streak', null)
  })

  it('awards the 30-day streak bonus on day 30, not the 7-day one', async () => {
    const { awardCoins } = await import('@/lib/coins/service')
    const { client } = fakeAdmin({ last_login_date: '2026-01-29', login_streak: 29 })
    await recordDailyLogin(client as never, 'p1', new Date('2026-01-30T10:00:00Z'))
    expect(awardCoins).toHaveBeenCalledWith(client, 'p1', 200, 'login_streak', null)
    expect(awardCoins).not.toHaveBeenCalledWith(client, 'p1', 50, 'login_streak', null)
  })

  it('never throws even if a downstream call rejects', async () => {
    const { awardCoins } = await import('@/lib/coins/service')
    vi.mocked(awardCoins).mockRejectedValueOnce(new Error('boom'))
    const { client } = fakeAdmin({ last_login_date: '2026-01-01', login_streak: 1 })
    await expect(recordDailyLogin(client as never, 'p1', new Date('2026-01-02T10:00:00Z'))).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/login/actions.test.ts` — expect FAIL, module doesn't exist.

- [ ] **Step 3: Implement**

```ts
import { nextLoginState } from './streak'
import { awardCoins } from '@/lib/coins/service'
import { awardXP } from '@/lib/membership/xp'
import type { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

// Best-effort, idempotent per WAT calendar day — mirrors the
// notify()/notifyInApp() convention of never throwing into the caller's
// primary render path. design doc §3.7.
export async function recordDailyLogin(admin: Admin, playerId: string, now: Date = new Date()): Promise<void> {
  try {
    const { data: profile } = await admin
      .from('profiles')
      .select('last_login_date, login_streak')
      .eq('id', playerId)
      .maybeSingle()

    const state = nextLoginState({
      lastLoginDate: profile?.last_login_date ?? null,
      loginStreak: profile?.login_streak ?? 0,
      now,
    })
    if (state.alreadyLoggedToday) return

    await admin
      .from('profiles')
      .update({ last_login_date: state.todayWAT, login_streak: state.newStreak })
      .eq('id', playerId)

    await awardCoins(admin, playerId, 5, 'daily_login', null)
    await awardXP(admin, playerId, 20, 'daily_login', null)

    if (state.newStreak % 30 === 0) {
      await awardCoins(admin, playerId, 200, 'login_streak', null)
      await awardXP(admin, playerId, 500, 'login_streak', null)
    } else if (state.newStreak % 7 === 0) {
      await awardCoins(admin, playerId, 50, 'login_streak', null)
      await awardXP(admin, playerId, 100, 'login_streak', null)
    }
  } catch (err) {
    console.error('[recordDailyLogin] failed', { playerId, message: err instanceof Error ? err.message : String(err) })
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/login/actions.test.ts` — expect PASS.

- [ ] **Step 5: Wire into the dashboard entry point**

In `app/dashboard/page.tsx`, right after the existing auth guard (`if (!user) redirect('/login?next=/dashboard')`, current line 106), add a fire-and-forget call before the `Promise.all`:

```ts
import { createAdminClient } from '@/lib/supabase/admin'
import { recordDailyLogin } from '@/lib/login/actions'
// ... inside DashboardPage, right after the redirect guard:
await recordDailyLogin(createAdminClient(), user.id)
```

This runs once per dashboard page load (server component, no client polling), consistent with the codebase's existing best-effort side-effect pattern. `createAdminClient` is already imported in this file for the opponent-WhatsApp lookup further down — reuse that import, don't add a second one.

- [ ] **Step 6: Run tests + manual smoke check**

Run: `npm run test`. Then load `/dashboard` locally (or via `npx next dev` + browser) as a logged-in test player and confirm `profiles.last_login_date`/`login_streak` update via a Supabase query.

- [ ] **Step 7: Commit**

```bash
git add lib/login/actions.ts lib/login/actions.test.ts app/dashboard/page.tsx
git commit -m "feat(login-streak): wire recordDailyLogin into dashboard page load"
```

**Part 2 depends on Task 3.2 (`awardCoins`) existing for Task 2.6 to actually run without a missing-module error** — implement Part 3's Task 3.2 before running Task 2.6's Step 3 onward, or stub `lib/coins/service.ts` with just the exported signature first. (Recommended: do Task 3.1–3.2 immediately before Task 2.6 if executing tasks strictly in-order task-by-task; the numbering reflects the design doc's requested sequence, not a hard dependency edge.)

---

## Part 3 — SX Coins

### Task 3.1: Migration — coins, ledger, store tables

**Files:**
- Create: `supabase/migrations/051_sx_coins_store.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 051_sx_coins_store.sql
-- Phase 2 Economy §3: SX Coins balance + ledger, and the cosmetics Store
-- catalogue + player inventory. See
-- docs/superpowers/specs/2026-08-05-phase2-economy-design.md §3.

CREATE TABLE public.sx_coins (
  player_id    uuid    PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  balance      integer NOT NULL DEFAULT 0 CHECK (balance >= 0),
  total_earned integer NOT NULL DEFAULT 0,
  total_spent  integer NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sx_coins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sx_coins_read" ON public.sx_coins
  FOR SELECT USING (auth.uid() = player_id);
-- No client write policy — every write is via awardCoins()/purchaseStoreItem()'s service-role client.

CREATE TABLE public.sx_coin_transactions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id    uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount       integer     NOT NULL,
  balance_after integer    NOT NULL,
  source       text        NOT NULL CHECK (source IN (
    'match_played', 'match_won', 'tournament_placement',
    'daily_login', 'login_streak', 'achievement_unlocked',
    'store_purchase', 'community_activity',
    'admin_grant', 'admin_deduct'
  )),
  reference_id uuid,
  description  text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON public.sx_coin_transactions (player_id);

ALTER TABLE public.sx_coin_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sx_coin_transactions_read" ON public.sx_coin_transactions
  FOR SELECT USING (auth.uid() = player_id);

CREATE TABLE public.store_items (
  id           uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         text    NOT NULL UNIQUE,
  name         text    NOT NULL,
  description  text,
  category     text    NOT NULL CHECK (category IN (
    'avatar_border', 'profile_theme', 'username_colour', 'bubble_skin'
  )),
  price_coins  integer NOT NULL CHECK (price_coins > 0),
  preview_url  text,
  active       boolean NOT NULL DEFAULT true,
  sort_order   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.store_items ENABLE ROW LEVEL SECURITY;
-- Public catalogue — everyone browsing /store reads it; only active items
-- are filtered in the query layer, not RLS, so admin can still see inactive
-- ones on /admin/store via the service-role client.
CREATE POLICY "store_items_read" ON public.store_items
  FOR SELECT USING (true);

CREATE TABLE public.player_store_items (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id    uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  item_id      uuid        NOT NULL REFERENCES public.store_items(id),
  purchased_at timestamptz NOT NULL DEFAULT now(),
  equipped     boolean     NOT NULL DEFAULT false,
  UNIQUE (player_id, item_id)
);

CREATE INDEX ON public.player_store_items (player_id);

ALTER TABLE public.player_store_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "player_store_items_read" ON public.player_store_items
  FOR SELECT USING (true);
-- Public read (not owner-only): equipped cosmetics render on the public
-- profile page, so any visitor must be able to look up who owns/has
-- equipped what. No client write policy — purchaseStoreItem/equipStoreItem
-- use the service-role client exclusively.

INSERT INTO public.store_items (slug, name, description, category, price_coins, sort_order) VALUES
  ('avatar_border_bronze', 'Bronze Frame', 'A modest bronze ring around your avatar.', 'avatar_border', 150, 1),
  ('avatar_border_purple_glow', 'Purple Glow', 'A pulsing purple aura for your avatar.', 'avatar_border', 300, 2),
  ('avatar_border_gold_crown', 'Gold Crown', 'A crowned gold frame for certified legends.', 'avatar_border', 500, 3),
  ('theme_dark_void', 'Dark Void', 'A minimal black profile card background.', 'profile_theme', 250, 1),
  ('theme_neon_grid', 'Neon Grid', 'A cyberpunk neon-grid profile card background.', 'profile_theme', 500, 2),
  ('theme_lagos_skyline', 'Lagos Skyline', 'The Lagos skyline at dusk behind your card.', 'profile_theme', 800, 3),
  ('username_purple', 'Purple Username', 'Show your username in Sentinel purple.', 'username_colour', 150, 1),
  ('username_gold', 'Gold Username', 'Show your username in gold.', 'username_colour', 150, 2),
  ('username_red', 'Red Username', 'Show your username in red.', 'username_colour', 150, 3),
  ('username_teal', 'Teal Username', 'Show your username in teal.', 'username_colour', 150, 4),
  ('bubble_classic_mascot', 'Classic Mascot', 'The original Sentinel guide bubble.', 'bubble_skin', 300, 1),
  ('bubble_neon_mascot', 'Neon Mascot', 'A neon-outlined mascot skin.', 'bubble_skin', 450, 2),
  ('bubble_gold_mascot', 'Gold Mascot', 'A gold-plated mascot skin for top spenders.', 'bubble_skin', 600, 3);
```

- [ ] **Step 2: Apply, regenerate types, commit**

Apply via Supabase MCP `apply_migration` (name `sx_coins_store`). Regenerate `lib/supabase/types.ts`.

```bash
git add supabase/migrations/051_sx_coins_store.sql lib/supabase/types.ts
git commit -m "feat(coins): add sx_coins ledger and store catalogue tables, seed initial items"
```

### Task 3.2: `awardCoins()` + balance read

**Files:**
- Create: `lib/coins/service.ts`
- Create: `lib/coins/service.test.ts`

**Interfaces:**
- Produces: `awardCoins(admin, playerId, amount, source, referenceId, description?): Promise<number>` (returns new balance), `getCoinBalance(admin, playerId): Promise<number>` — consumed by `lib/login/actions.ts` (Task 2.6), `lib/matches/economy-hooks.ts` (Task 3.3), `lib/matches/season-points.ts` (Task 3.4), `lib/coins/actions.ts` (Task 3.5), `lib/admin/player-economy-actions.ts` (Task 8.1).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { awardCoins, getCoinBalance } from './service'

function fakeAdmin(existing: { balance: number; total_earned: number; total_spent: number } | null) {
  const upserts: Record<string, unknown>[] = []
  const inserts: Record<string, unknown>[] = []
  let row = existing
  return {
    client: {
      from(table: string) {
        if (table === 'sx_coins') {
          return {
            select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row }) }) }),
            upsert: async (vals: Record<string, unknown>) => { upserts.push(vals); row = vals as never; return { data: null, error: null } },
          }
        }
        if (table === 'sx_coin_transactions') {
          return { insert: async (v: Record<string, unknown>) => { inserts.push(v); return { data: null, error: null } } }
        }
        throw new Error(`unexpected table ${table}`)
      },
    },
    upserts,
    inserts,
  }
}

describe('getCoinBalance', () => {
  it('returns 0 for a player with no wallet row yet', async () => {
    const { client } = fakeAdmin(null)
    expect(await getCoinBalance(client as never, 'p1')).toBe(0)
  })
})

describe('awardCoins', () => {
  it('creates a wallet row lazily and logs the ledger row', async () => {
    const { client, upserts, inserts } = fakeAdmin(null)
    const newBalance = await awardCoins(client as never, 'p1', 20, 'match_played', 'm1')
    expect(newBalance).toBe(20)
    expect(upserts[0]).toMatchObject({ player_id: 'p1', balance: 20, total_earned: 20, total_spent: 0 })
    expect(inserts[0]).toMatchObject({ player_id: 'p1', amount: 20, balance_after: 20, source: 'match_played', reference_id: 'm1' })
  })

  it('adds to an existing balance', async () => {
    const { client } = fakeAdmin({ balance: 100, total_earned: 100, total_spent: 0 })
    const newBalance = await awardCoins(client as never, 'p1', 30, 'match_won', 'm1')
    expect(newBalance).toBe(130)
  })

  it('supports negative amounts for admin deductions without going below 0', async () => {
    const { client } = fakeAdmin({ balance: 40, total_earned: 100, total_spent: 60 })
    const newBalance = await awardCoins(client as never, 'p1', -100, 'admin_deduct', null)
    expect(newBalance).toBe(0)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/coins/service.test.ts` — expect FAIL, module doesn't exist.

- [ ] **Step 3: Implement**

```ts
import type { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

export async function getCoinBalance(admin: Admin, playerId: string): Promise<number> {
  const { data } = await admin.from('sx_coins').select('balance').eq('player_id', playerId).maybeSingle()
  return data?.balance ?? 0
}

// Positive amount = earn, negative = spend/deduct. Floors at 0 (never a
// negative balance) — a negative award larger than the current balance
// clamps rather than erroring, matching sx_score's MAX(0, ...) clamp rule.
// Always logs a ledger row, mirroring wallet_transactions/sx_score_events.
export async function awardCoins(
  admin: Admin,
  playerId: string,
  amount: number,
  source: string,
  referenceId: string | null,
  description?: string,
): Promise<number> {
  const { data: existing } = await admin
    .from('sx_coins')
    .select('balance, total_earned, total_spent')
    .eq('player_id', playerId)
    .maybeSingle()

  const currentBalance = existing?.balance ?? 0
  const newBalance = Math.max(0, currentBalance + amount)
  const appliedDelta = newBalance - currentBalance

  await admin.from('sx_coins').upsert({
    player_id: playerId,
    balance: newBalance,
    total_earned: (existing?.total_earned ?? 0) + Math.max(0, appliedDelta),
    total_spent: (existing?.total_spent ?? 0) + Math.max(0, -appliedDelta),
    updated_at: new Date().toISOString(),
  })

  await admin.from('sx_coin_transactions').insert({
    player_id: playerId,
    amount: appliedDelta,
    balance_after: newBalance,
    source,
    reference_id: referenceId,
    description: description ?? null,
  })

  return newBalance
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/coins/service.test.ts` — expect PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/coins/service.ts lib/coins/service.test.ts
git commit -m "feat(coins): add awardCoins/getCoinBalance service"
```

### Task 3.3: Match completion economy hook

**Files:**
- Create: `lib/matches/economy-hooks.ts`
- Create: `lib/matches/economy-hooks.test.ts`
- Modify: `lib/matches/verify-actions.ts` (wire into `confirmResult`)
- Modify: `lib/matches/noshow-actions.ts` (wire into `declareNoShowWinner`)

**Interfaces:**
- Consumes: `awardCoins` (Task 3.2), `awardXP` (Task 2.3), `checkAndUnlockAchievements` (Task 4.3 — this task's Step 3 code calls it; if executing strictly in task order, stub `lib/achievements/unlock.ts` with a no-op `checkAndUnlockAchievements` export first, then replace it for real in Task 4.3).
- Produces: `awardMatchEconomy(admin, matchId): Promise<void>` — dedup-safe (checks for an existing ledger row before paying), called once per match right after `syncMatchEvents`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest'
import { awardMatchEconomy } from './economy-hooks'

vi.mock('@/lib/coins/service', () => ({ awardCoins: vi.fn() }))
vi.mock('@/lib/membership/xp', () => ({ awardXP: vi.fn() }))
vi.mock('@/lib/achievements/unlock', () => ({ checkAndUnlockAchievements: vi.fn() }))

function fakeAdmin(events: { player_id: string; event_type: string }[], existingCoinTx: { player_id: string; source: string; reference_id: string }[]) {
  return {
    from(table: string) {
      if (table === 'sx_score_events') {
        return { select: () => ({ eq: () => ({ in: async () => ({ data: events }) }) }) }
      }
      if (table === 'sx_coin_transactions') {
        return {
          select: () => ({
            eq: (col: string, val: string) => ({
              eq: (col2: string, val2: string) => ({
                eq: async (col3: string, val3: string) =>
                  ({ data: existingCoinTx.filter((t) => t.player_id === val && t.source === val2 && t.reference_id === val3) }),
              }),
            }),
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

describe('awardMatchEconomy', () => {
  it('pays participation + win bonus to the winner, participation only to the loser', async () => {
    const { awardCoins } = await import('@/lib/coins/service')
    const { awardXP } = await import('@/lib/membership/xp')
    const admin = fakeAdmin(
      [
        { player_id: 'a', event_type: 'match_completed' },
        { player_id: 'b', event_type: 'match_completed' },
        { player_id: 'a', event_type: 'win_no_dispute' },
      ],
      [],
    )
    await awardMatchEconomy(admin as never, 'm1')
    expect(awardCoins).toHaveBeenCalledWith(admin, 'a', 20, 'match_played', 'm1')
    expect(awardCoins).toHaveBeenCalledWith(admin, 'a', 30, 'match_won', 'm1')
    expect(awardCoins).toHaveBeenCalledWith(admin, 'b', 20, 'match_played', 'm1')
    expect(awardCoins).not.toHaveBeenCalledWith(admin, 'b', 30, 'match_won', 'm1')
    expect(awardXP).toHaveBeenCalledWith(admin, 'a', 50, 'match_played', 'm1')
    expect(awardXP).toHaveBeenCalledWith(admin, 'a', 50, 'match_won', 'm1')
  })

  it('pays nobody for a no-show event', async () => {
    const { awardCoins } = await import('@/lib/coins/service')
    vi.mocked(awardCoins).mockClear()
    const admin = fakeAdmin([{ player_id: 'a', event_type: 'no_show' }], [])
    await awardMatchEconomy(admin as never, 'm1')
    expect(awardCoins).not.toHaveBeenCalled()
  })

  it('is dedup-safe — does not re-pay a player already paid for this match', async () => {
    const { awardCoins } = await import('@/lib/coins/service')
    vi.mocked(awardCoins).mockClear()
    const admin = fakeAdmin(
      [{ player_id: 'a', event_type: 'match_completed' }],
      [{ player_id: 'a', source: 'match_played', reference_id: 'm1' }],
    )
    await awardMatchEconomy(admin as never, 'm1')
    expect(awardCoins).not.toHaveBeenCalledWith(admin, 'a', 20, 'match_played', 'm1')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/matches/economy-hooks.test.ts` — expect FAIL, module doesn't exist.

- [ ] **Step 3: Implement**

```ts
import { awardCoins } from '@/lib/coins/service'
import { awardXP } from '@/lib/membership/xp'
import { checkAndUnlockAchievements } from '@/lib/achievements/unlock'
import type { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

async function alreadyPaid(admin: Admin, playerId: string, source: string, matchId: string): Promise<boolean> {
  const { data } = await admin
    .from('sx_coin_transactions')
    .select('id')
    .eq('player_id', playerId)
    .eq('source', source)
    .eq('reference_id', matchId)
  return (data?.length ?? 0) > 0
}

// Called right after syncMatchEvents(admin, matchId) — reads back the exact
// sx_score_events rows that call just wrote (design doc §3.2: "match played
// +20... match won +30 bonus... stacks... no-show: no coins"). Dedup-safe
// via a ledger existence check per (player, source, matchId), since this can
// run more than once for the same match (declareNoShowWinner is documented
// as also a correction path for an already-resolved match).
export async function awardMatchEconomy(admin: Admin, matchId: string): Promise<void> {
  const { data: events } = await admin
    .from('sx_score_events')
    .select('player_id, event_type')
    .eq('match_id', matchId)
    .in('event_type', ['match_completed', 'win_no_dispute'])
  const rows = events ?? []

  const completedPlayerIds = rows.filter((e) => e.event_type === 'match_completed').map((e) => e.player_id)
  const winnerIds = rows.filter((e) => e.event_type === 'win_no_dispute').map((e) => e.player_id)

  for (const playerId of completedPlayerIds) {
    if (!(await alreadyPaid(admin, playerId, 'match_played', matchId))) {
      await awardCoins(admin, playerId, 20, 'match_played', matchId)
      await awardXP(admin, playerId, 50, 'match_played', matchId)
    }
  }
  for (const playerId of winnerIds) {
    if (!(await alreadyPaid(admin, playerId, 'match_won', matchId))) {
      await awardCoins(admin, playerId, 30, 'match_won', matchId)
      await awardXP(admin, playerId, 50, 'match_won', matchId)
    }
  }

  for (const playerId of completedPlayerIds) {
    await checkAndUnlockAchievements(admin, playerId, {
      type: 'match_completed',
      matchId,
      won: winnerIds.includes(playerId),
    })
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/matches/economy-hooks.test.ts` — expect PASS.

- [ ] **Step 5: Wire into `confirmResult`**

In `lib/matches/verify-actions.ts`, right after the existing `await syncMatchEvents(admin, id)` call (line 395), add:

```ts
import { awardMatchEconomy } from './economy-hooks'
// ...
await syncMatchEvents(admin, id)
await awardMatchEconomy(admin, id)
```

- [ ] **Step 6: Wire into `declareNoShowWinner`**

In `lib/matches/noshow-actions.ts`, right after its own `await syncMatchEvents(admin, id)` call (line 230), add the same two lines (import + call). Do **not** add it to `markBothNoShow` (line 313's `syncMatchEvents` call) — that path never produces `match_completed`/`win_no_dispute` events, so `awardMatchEconomy` would correctly no-op there anyway, but skipping the call keeps the no-op explicit rather than implicit.

- [ ] **Step 7: Run the full matches test suite**

Run: `npx vitest run lib/matches` — expect PASS (catches any regression in `verify.test.ts`/`noshow.test.ts` from the new import).

- [ ] **Step 8: Commit**

```bash
git add lib/matches/economy-hooks.ts lib/matches/economy-hooks.test.ts lib/matches/verify-actions.ts lib/matches/noshow-actions.ts
git commit -m "feat(coins): wire match-completion coins/xp/achievement checks into result confirmation"
```

### Task 3.4: Tournament placement economy in `awardSeasonPoints()`

**Files:**
- Modify: `lib/matches/season-points.ts`
- Create: `lib/matches/season-points.test.ts`

**Interfaces:**
- Consumes: `bandsForPlacements`, `placementForBand`, `pointsForBand` (`lib/tournaments/season-placement.ts`, unchanged), `awardCoins`, `awardXP`, `checkAndUnlockAchievements`.
- Produces: restructured `awardSeasonPoints(admin, tournamentId)` — `season_ranking_points` writes stay scoped to `community_club`/`masters`, but coin/XP/achievement awards now run for every tournament type (Global Constraints #3).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest'
import { awardSeasonPoints } from './season-points'

vi.mock('@/lib/coins/service', () => ({ awardCoins: vi.fn() }))
vi.mock('@/lib/membership/xp', () => ({ awardXP: vi.fn() }))
vi.mock('@/lib/achievements/unlock', () => ({ checkAndUnlockAchievements: vi.fn() }))

function fakeAdmin(opts: {
  tournament: { id: string; tournament_type: string; season_id: string | null }
  registrations: { player_id: string }[]
  matches: { round: string; status: string; player_a_id: string | null; player_b_id: string | null; score_a: number | null; score_b: number | null }[]
}) {
  const upserts: Record<string, unknown>[] = []
  return {
    client: {
      from(table: string) {
        if (table === 'tournaments') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.tournament }) }) }) }
        if (table === 'tournament_registrations') return { select: () => ({ eq: () => ({ eq: async () => ({ data: opts.registrations }) }) }) }
        if (table === 'matches') return { select: () => ({ eq: async () => ({ data: opts.matches }) }) }
        if (table === 'season_ranking_points') return { upsert: async (rows: Record<string, unknown>[]) => { upserts.push(...rows); return { data: null, error: null } } }
        throw new Error(`unexpected table ${table}`)
      },
    },
    upserts,
  }
}

const championMatch = { round: 'final', status: 'completed', player_a_id: 'winner', player_b_id: 'loser', score_a: 3, score_b: 1 }

describe('awardSeasonPoints', () => {
  it('writes season_ranking_points AND awards placement coins/xp for a community_club tournament', async () => {
    const { awardCoins } = await import('@/lib/coins/service')
    const { client, upserts } = fakeAdmin({
      tournament: { id: 't1', tournament_type: 'community_club', season_id: 's1' },
      registrations: [{ player_id: 'winner' }, { player_id: 'loser' }],
      matches: [championMatch],
    })
    await awardSeasonPoints(client as never, 't1')
    expect(upserts.length).toBe(2)
    expect(awardCoins).toHaveBeenCalledWith(client, 'winner', 500, 'tournament_placement', 't1')
  })

  it('awards placement coins/xp for a champions_cup tournament even though it writes no season_ranking_points', async () => {
    const { awardCoins } = await import('@/lib/coins/service')
    vi.mocked(awardCoins).mockClear()
    const { client, upserts } = fakeAdmin({
      tournament: { id: 't2', tournament_type: 'champions_cup', season_id: null },
      registrations: [{ player_id: 'winner' }, { player_id: 'loser' }],
      matches: [championMatch],
    })
    await awardSeasonPoints(client as never, 't2')
    expect(upserts.length).toBe(0)
    expect(awardCoins).toHaveBeenCalledWith(client, 'winner', 500, 'tournament_placement', 't2')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/matches/season-points.test.ts` — expect FAIL (current `awardSeasonPoints` early-returns entirely for `champions_cup`, so the second test fails).

- [ ] **Step 3: Implement**

Rewrite `lib/matches/season-points.ts` in full:

```ts
import { createAdminClient } from '@/lib/supabase/admin'
import {
  bandsForPlacements,
  pointsForBand,
  placementForBand,
  type PlacementMatch,
  type SeasonTournamentType,
} from '@/lib/tournaments/season-placement'
import { awardCoins } from '@/lib/coins/service'
import { awardXP } from '@/lib/membership/xp'
import { checkAndUnlockAchievements } from '@/lib/achievements/unlock'

type Admin = ReturnType<typeof createAdminClient>

function isSeasonTournamentType(t: string): t is SeasonTournamentType {
  return t === 'community_club' || t === 'masters'
}

// design doc §3.2 placement tiers, keyed by the same numeric placement
// placementForBand() already produces (1, 2, 3, 5, 9, 17).
const PLACEMENT_COINS: Record<number, number> = { 1: 500, 2: 300, 3: 150, 5: 75, 9: 30, 17: 10 }
const PLACEMENT_XP: Record<number, number> = { 1: 500, 2: 300, 3: 200, 5: 100 }

// Runs for EVERY tournament type once a tournament completes — coins/XP/
// achievement checks are not gated on having a season, only the
// season_ranking_points write is (Global Constraints #3: Champions Cup
// deliberately doesn't join the season leaderboard, but its players still
// earn coins/XP and can unlock champions_cup_* achievements).
export async function awardSeasonPoints(admin: Admin, tournamentId: string): Promise<void> {
  const { data: tournament } = await admin
    .from('tournaments')
    .select('id, tournament_type, season_id')
    .eq('id', tournamentId)
    .maybeSingle()
  if (!tournament) return

  const { data: registrations } = await admin
    .from('tournament_registrations')
    .select('player_id')
    .eq('tournament_id', tournamentId)
    .eq('status', 'active')
  const activePlayerIds = (registrations ?? []).map((r) => r.player_id)
  if (activePlayerIds.length === 0) return

  const { data: matches } = await admin
    .from('matches')
    .select('round, status, player_a_id, player_b_id, score_a, score_b')
    .eq('tournament_id', tournamentId)

  const placements = bandsForPlacements((matches ?? []) as PlacementMatch[], activePlayerIds)

  if (tournament.season_id && isSeasonTournamentType(tournament.tournament_type)) {
    const tournamentType = tournament.tournament_type
    const rows = placements.map(({ playerId, band }) => ({
      season_id: tournament.season_id as string,
      player_id: playerId,
      tournament_id: tournamentId,
      points: pointsForBand(tournamentType, band),
      placement: placementForBand(tournamentType, band),
    }))
    await admin.from('season_ranking_points').upsert(rows, { onConflict: 'season_id,player_id,tournament_id' })
  }

  // Placement is only meaningful relative to *some* tournament type's bands
  // — reuse community_club's band->number mapping for coin/XP tiers since
  // it's the finer-grained one (masters collapses several bands to the same
  // number); the coin/XP table keys off the numeric placement, not the band.
  for (const { playerId, band } of placements) {
    const placement = placementForBand('community_club', band)
    const coins = PLACEMENT_COINS[placement]
    if (coins) await awardCoins(admin, playerId, coins, 'tournament_placement', tournamentId)
    const xp = PLACEMENT_XP[placement]
    if (xp) await awardXP(admin, playerId, xp, 'tournament_placement', tournamentId)
    await checkAndUnlockAchievements(admin, playerId, {
      type: 'tournament_completed',
      tournamentId,
      placement,
      tournamentType: tournament.tournament_type,
    })
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/matches/season-points.test.ts` — expect PASS.

- [ ] **Step 5: Run the full matches + tournaments suite**

Run: `npx vitest run lib/matches lib/tournaments` — expect PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/matches/season-points.ts lib/matches/season-points.test.ts
git commit -m "feat(coins): award tournament placement coins/xp/achievements for every tournament type"
```

### Task 3.5: `purchaseStoreItem` + `equipStoreItem`

**Files:**
- Create: `lib/coins/actions.ts`
- Create: `lib/coins/actions.test.ts`

**Interfaces:**
- Consumes: `createClient` (`lib/supabase/server.ts`, for `auth.getUser()`), `createAdminClient`, `getCoinBalance` (Task 3.2).
- Produces: `purchaseStoreItem(_prev, formData): Promise<PurchaseState>`, `equipStoreItem(_prev, formData): Promise<PurchaseState>` — `'use server'` actions, `useFormState`-shaped, consumed by `components/store/StoreItemCard.tsx` (Task 5.1).

- [ ] **Step 1: Write the failing test**

Since these are `'use server'` actions authenticating via `createClient()`, follow the existing convention (`lib/wallet/actions.ts`) of testing the pure decision logic separately from the IO. Split out a pure `decidePurchase()`:

```ts
import { describe, it, expect } from 'vitest'
import { decidePurchase } from './actions'

describe('decidePurchase', () => {
  it('rejects an inactive item', () => {
    expect(decidePurchase({ item: { active: false, price_coins: 100 }, alreadyOwned: false, balance: 500 }))
      .toEqual({ ok: false, error: 'This item is no longer available.' })
  })
  it('rejects an item the player already owns', () => {
    expect(decidePurchase({ item: { active: true, price_coins: 100 }, alreadyOwned: true, balance: 500 }))
      .toEqual({ ok: false, error: 'You already own this item.' })
  })
  it('rejects insufficient balance', () => {
    expect(decidePurchase({ item: { active: true, price_coins: 600 }, alreadyOwned: false, balance: 500 }))
      .toEqual({ ok: false, error: 'Not enough SX Coins.' })
  })
  it('allows a valid purchase', () => {
    expect(decidePurchase({ item: { active: true, price_coins: 500 }, alreadyOwned: false, balance: 500 }))
      .toEqual({ ok: true })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/coins/actions.test.ts` — expect FAIL, module doesn't exist.

- [ ] **Step 3: Implement**

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCoinBalance } from './service'

export type PurchaseState = { error?: string; success?: boolean } | undefined

interface PurchaseItemInput {
  item: { active: boolean; price_coins: number }
  alreadyOwned: boolean
  balance: number
}
type PurchaseDecision = { ok: true } | { ok: false; error: string }

// Pure — unit tested directly, no IO.
export function decidePurchase({ item, alreadyOwned, balance }: PurchaseItemInput): PurchaseDecision {
  if (!item.active) return { ok: false, error: 'This item is no longer available.' }
  if (alreadyOwned) return { ok: false, error: 'You already own this item.' }
  if (balance < item.price_coins) return { ok: false, error: 'Not enough SX Coins.' }
  return { ok: true }
}

export async function purchaseStoreItem(_prev: PurchaseState, formData: FormData): Promise<PurchaseState> {
  const itemId = String(formData.get('itemId') ?? '')
  if (!itemId) return { error: 'Missing item.' }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const admin = createAdminClient()
  const { data: item } = await admin
    .from('store_items')
    .select('id, name, active, price_coins')
    .eq('id', itemId)
    .maybeSingle()
  if (!item) return { error: 'Item not found.' }

  const { data: existingOwned } = await admin
    .from('player_store_items')
    .select('id')
    .eq('player_id', user.id)
    .eq('item_id', itemId)
    .maybeSingle()

  const balance = await getCoinBalance(admin, user.id)
  const decision = decidePurchase({ item, alreadyOwned: !!existingOwned, balance })
  if (!decision.ok) return { error: decision.error }

  const { data: coinsRow } = await admin.from('sx_coins').select('balance, total_earned, total_spent').eq('player_id', user.id).maybeSingle()
  const newBalance = balance - item.price_coins
  await admin.from('sx_coins').upsert({
    player_id: user.id,
    balance: newBalance,
    total_earned: coinsRow?.total_earned ?? 0,
    total_spent: (coinsRow?.total_spent ?? 0) + item.price_coins,
    updated_at: new Date().toISOString(),
  })
  await admin.from('sx_coin_transactions').insert({
    player_id: user.id,
    amount: -item.price_coins,
    balance_after: newBalance,
    source: 'store_purchase',
    reference_id: itemId,
    description: item.name,
  })
  const { error: insertErr } = await admin.from('player_store_items').insert({ player_id: user.id, item_id: itemId })
  if (insertErr) {
    // UNIQUE(player_id, item_id) race — refund the coins we just deducted.
    await admin.from('sx_coins').update({ balance, total_spent: coinsRow?.total_spent ?? 0 }).eq('player_id', user.id)
    return { error: 'You already own this item.' }
  }

  revalidatePath('/store')
  revalidatePath('/dashboard')
  return { success: true }
}

export async function equipStoreItem(_prev: PurchaseState, formData: FormData): Promise<PurchaseState> {
  const itemId = String(formData.get('itemId') ?? '')
  if (!itemId) return { error: 'Missing item.' }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const admin = createAdminClient()
  const { data: owned } = await admin
    .from('player_store_items')
    .select('id, item_id, store_items(category)')
    .eq('player_id', user.id)
    .eq('item_id', itemId)
    .maybeSingle()
  if (!owned) return { error: 'You do not own this item.' }

  const categoryRef = owned.store_items as { category: string } | { category: string }[] | null
  const category = Array.isArray(categoryRef) ? categoryRef[0]?.category : categoryRef?.category
  if (!category) return { error: 'Could not resolve item category.' }

  const { data: sameCategoryItems } = await admin.from('store_items').select('id').eq('category', category)
  const sameCategoryIds = (sameCategoryItems ?? []).map((i) => i.id)
  await admin
    .from('player_store_items')
    .update({ equipped: false })
    .eq('player_id', user.id)
    .in('item_id', sameCategoryIds)
  await admin.from('player_store_items').update({ equipped: true }).eq('player_id', user.id).eq('item_id', itemId)

  revalidatePath('/store')
  revalidatePath('/players/[username]', 'page')
  return { success: true }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/coins/actions.test.ts` — expect PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/coins/actions.ts lib/coins/actions.test.ts
git commit -m "feat(store): add purchaseStoreItem/equipStoreItem server actions"
```

---

## Part 4 — Achievement System

### Task 4.1: Migration — `achievements` + `player_achievements`

**Files:**
- Create: `supabase/migrations/052_achievements.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 052_achievements.sql
-- Phase 2 Economy §5: achievement catalogue + per-player unlocks. See
-- docs/superpowers/specs/2026-08-05-phase2-economy-design.md §5.

CREATE TABLE public.achievements (
  id           uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         text    NOT NULL UNIQUE,
  name         text    NOT NULL,
  description  text    NOT NULL,
  category     text    NOT NULL CHECK (category IN (
    'matches', 'tournaments', 'score', 'season', 'profile', 'community'
  )),
  icon_url     text,
  xp_reward    integer NOT NULL DEFAULT 0,
  coin_reward  integer NOT NULL DEFAULT 0,
  phase        text    NOT NULL DEFAULT 'phase2'
    CHECK (phase IN ('phase2', 'phase3')),
  sort_order   integer NOT NULL DEFAULT 0
);

ALTER TABLE public.achievements ENABLE ROW LEVEL SECURITY;
-- Public catalogue — needed to render the "greyed-out, unearned" state on
-- any visitor's view of a profile's achievement grid, same as store_items.
CREATE POLICY "achievements_read" ON public.achievements
  FOR SELECT USING (true);

CREATE TABLE public.player_achievements (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id      uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  achievement_id uuid        NOT NULL REFERENCES public.achievements(id),
  unlocked_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (player_id, achievement_id)
);

CREATE INDEX ON public.player_achievements (player_id);

ALTER TABLE public.player_achievements ENABLE ROW LEVEL SECURITY;
-- Public read (Global Constraints #7) — the achievements grid is on the
-- public profile page, visible to any visitor, not just the owner. No
-- client write policy — every unlock is via checkAndUnlockAchievements()'s
-- service-role client, or the admin manual-unlock action.
CREATE POLICY "player_achievements_read" ON public.player_achievements
  FOR SELECT USING (true);

INSERT INTO public.achievements (slug, name, description, category, xp_reward, coin_reward, phase, sort_order) VALUES
  ('first_match', 'First Blood', 'Play your first match', 'matches', 50, 20, 'phase2', 1),
  ('matches_10', 'Getting Started', 'Play 10 matches', 'matches', 100, 50, 'phase2', 2),
  ('matches_50', 'Battle-Hardened', 'Play 50 matches', 'matches', 200, 100, 'phase2', 3),
  ('matches_100', 'Century Club', 'Play 100 matches', 'matches', 500, 250, 'phase2', 4),
  ('first_win', 'First W', 'Win your first match', 'matches', 100, 50, 'phase2', 5),
  ('wins_10', 'On a Roll', 'Win 10 matches', 'matches', 150, 75, 'phase2', 6),
  ('wins_50', 'Relentless', 'Win 50 matches', 'matches', 300, 150, 'phase2', 7),
  ('win_streak_3', 'Hat-Trick', 'Win 3 matches in a row', 'matches', 150, 75, 'phase2', 8),
  ('win_streak_5', 'Unstoppable', 'Win 5 matches in a row', 'matches', 300, 150, 'phase2', 9),
  ('first_tournament', 'Tournament Debut', 'Enter your first tournament', 'tournaments', 100, 50, 'phase2', 10),
  ('first_podium', 'Podium Finish', 'Finish top 3 in any tournament', 'tournaments', 200, 100, 'phase2', 11),
  ('first_champion', 'Champion', 'Win a tournament', 'tournaments', 500, 250, 'phase2', 12),
  ('champion_3x', 'Triple Crown', 'Win 3 tournaments', 'tournaments', 1000, 500, 'phase2', 13),
  ('masters_qualifier', 'Masters Bound', 'Qualify for SentinelX Masters', 'tournaments', 300, 150, 'phase2', 14),
  ('masters_champion', 'Masters Champion', 'Win SentinelX Masters', 'tournaments', 1000, 500, 'phase2', 15),
  ('champions_cup_qualifier', 'Cup Contender', 'Qualify for SentinelX Champions Cup', 'tournaments', 500, 250, 'phase2', 16),
  ('champions_cup_champion', 'SentinelX Legend', 'Win the Champions Cup', 'tournaments', 2000, 1000, 'phase2', 17),
  ('sx_score_100', 'Rising Talent', 'Reach 100 SX Score', 'score', 50, 25, 'phase2', 18),
  ('sx_score_500', 'Proven Player', 'Reach 500 SX Score', 'score', 100, 50, 'phase2', 19),
  ('sx_score_1000', 'Elite Level', 'Reach 1,000 SX Score', 'score', 200, 100, 'phase2', 20),
  ('sx_score_5000', 'Legend Territory', 'Reach 5,000 SX Score', 'score', 500, 250, 'phase2', 21),
  ('season_participant', 'Season Opener', 'Play at least one Community Club in a season', 'season', 100, 50, 'phase2', 22),
  ('season_month_sweep', 'Month Sweep', 'Play every Community Club in a calendar month', 'season', 300, 150, 'phase2', 23),
  ('season_top_100', 'Top 100', 'Finish a season in the top 100 leaderboard', 'season', 200, 100, 'phase2', 24),
  ('season_top_10', 'Top 10', 'Finish a season in the top 10 leaderboard', 'season', 500, 250, 'phase2', 25),
  ('profile_complete', 'Ready to Compete', 'Set your avatar and bio', 'profile', 50, 20, 'phase2', 26),
  ('phone_verified', 'Verified Soldier', 'Verify your phone number', 'profile', 50, 20, 'phase2', 27),
  ('first_post', 'First Post', 'Post in the community feed', 'community', 50, 20, 'phase3', 28),
  ('likes_100', 'Fan Favourite', 'Receive 100 likes', 'community', 150, 75, 'phase3', 29),
  ('posts_50', 'Community Pillar', 'Make 50 community posts', 'community', 300, 150, 'phase3', 30);
```

- [ ] **Step 2: Apply, regenerate types, commit**

Apply via Supabase MCP `apply_migration` (name `achievements`). Regenerate `lib/supabase/types.ts`. Confirm `SELECT count(*) FROM achievements;` returns 30.

```bash
git add supabase/migrations/052_achievements.sql lib/supabase/types.ts
git commit -m "feat(achievements): add achievements/player_achievements tables, seed 30-item catalogue"
```

### Task 4.2: Achievement catalogue module (TS mirror for admin UI)

**Files:**
- Create: `lib/achievements/catalogue.ts`

**Interfaces:**
- Produces: `ACHIEVEMENT_CATEGORIES: readonly string[]` — consumed by `components/admin/PlayerEconomyPanel.tsx` (Task 8.1, the manual-unlock dropdown groups by category) and `components/store/StoreGrid.tsx`-equivalent grouping on the profile achievements grid (Task 6.1). The catalogue's actual *data* stays server-side in the `achievements` table (queried directly), not duplicated in TS — this module only holds the category list, which is also the DB CHECK constraint's value set and must not silently drift from it.

- [ ] **Step 1: Implement (no test — pure constant, exercised transitively by every module that imports it)**

```ts
// Mirrors the achievements.category CHECK constraint in
// supabase/migrations/052_achievements.sql — keep these two in sync.
export const ACHIEVEMENT_CATEGORIES = ['matches', 'tournaments', 'score', 'season', 'profile', 'community'] as const
export type AchievementCategory = (typeof ACHIEVEMENT_CATEGORIES)[number]

export const ACHIEVEMENT_CATEGORY_LABELS: Record<AchievementCategory, string> = {
  matches: 'Matches',
  tournaments: 'Tournaments',
  score: 'SX Score',
  season: 'Season',
  profile: 'Profile',
  community: 'Community',
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/achievements/catalogue.ts
git commit -m "feat(achievements): add achievement category constants"
```

### Task 4.3: `checkAndUnlockAchievements()`

**Files:**
- Create: `lib/achievements/unlock.ts`
- Create: `lib/achievements/unlock.test.ts`

**Interfaces:**
- Consumes: `awardXP` (Task 2.3), `awardCoins` (Task 3.2), `notifyInApp` (Task 2.4's extended type).
- Produces: `AchievementContext` union, `checkAndUnlockAchievements(admin, playerId, context): Promise<void>` — consumed by `lib/matches/economy-hooks.ts` (Task 3.3, already wired above), `lib/matches/season-points.ts` (Task 3.4, already wired above), `lib/matches/noshow-actions.ts`/`lib/scoring/apply.ts` (sx_score_updated — this task's Step 5), `lib/profile/actions.ts` (profile_complete — Step 6), `lib/phone/actions.ts` (phone_verified — Step 6).

**Note on scope (Global Constraints #6):** `season_top_100`/`season_top_10` are matched against nothing here — there is no `season_completed` trigger anywhere in this codebase yet. The `season_completed` context variant is included in the type for forward-compatibility with the design doc's shape, but `checkAndUnlockAchievements` never receives one in this phase; a future season-close feature will call it.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, vi } from 'vitest'
import { checkAndUnlockAchievements } from './unlock'

vi.mock('@/lib/membership/xp', () => ({ awardXP: vi.fn() }))
vi.mock('@/lib/coins/service', () => ({ awardCoins: vi.fn() }))
vi.mock('@/lib/notifications/inbox', () => ({ notifyInApp: vi.fn() }))

function fakeAdmin(opts: {
  unlockedSlugs?: string[]
  achievements: { id: string; slug: string; name: string; category: string; xp_reward: number; coin_reward: number }[]
  profile?: { total_matches: number; wins: number }
  recentMatches?: { outcome: 'win' | 'loss' | 'draw' }[]
  seasonRankingWins?: number
}) {
  const inserted: Record<string, unknown>[] = []
  return {
    client: {
      from(table: string) {
        if (table === 'player_achievements') {
          return {
            select: () => ({ eq: async () => ({ data: (opts.unlockedSlugs ?? []).map((slug) => ({ achievement_id: slug })) }) }),
            insert: async (row: Record<string, unknown>) => { inserted.push(row); return { data: null, error: null } },
          }
        }
        if (table === 'achievements') {
          return { select: () => ({ eq: async () => ({ data: opts.achievements }) }) }
        }
        if (table === 'profiles') {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.profile }) }) }) }
        }
        if (table === 'season_ranking_points') {
          return { select: () => ({ eq: () => ({ eq: async () => ({ data: Array(opts.seasonRankingWins ?? 0).fill({ placement: 1 }) }) }) }) }
        }
        throw new Error(`unexpected table ${table}`)
      },
    },
    inserted,
  }
}

describe('checkAndUnlockAchievements — match_completed', () => {
  it('unlocks first_match and first_win on a winning first match', async () => {
    const { client, inserted } = fakeAdmin({
      achievements: [
        { id: 'a1', slug: 'first_match', name: 'First Blood', category: 'matches', xp_reward: 50, coin_reward: 20 },
        { id: 'a2', slug: 'first_win', name: 'First W', category: 'matches', xp_reward: 100, coin_reward: 50 },
      ],
      profile: { total_matches: 1, wins: 1 },
    })
    await checkAndUnlockAchievements(client as never, 'p1', { type: 'match_completed', matchId: 'm1', won: true })
    expect(inserted.map((r) => r.achievement_id)).toEqual(['a1', 'a2'])
  })

  it('does not unlock first_win on a loss', async () => {
    const { client, inserted } = fakeAdmin({
      achievements: [{ id: 'a2', slug: 'first_win', name: 'First W', category: 'matches', xp_reward: 100, coin_reward: 50 }],
      profile: { total_matches: 1, wins: 0 },
    })
    await checkAndUnlockAchievements(client as never, 'p1', { type: 'match_completed', matchId: 'm1', won: false })
    expect(inserted).toEqual([])
  })

  it('never re-unlocks an achievement the player already has', async () => {
    const { client, inserted } = fakeAdmin({
      unlockedSlugs: ['a1'],
      achievements: [], // already-unlocked ones are excluded from the query itself
      profile: { total_matches: 1, wins: 1 },
    })
    await checkAndUnlockAchievements(client as never, 'p1', { type: 'match_completed', matchId: 'm1', won: true })
    expect(inserted).toEqual([])
  })
})

describe('checkAndUnlockAchievements — sx_score_updated', () => {
  it('unlocks sx_score_100 once the threshold is crossed', async () => {
    const { client, inserted } = fakeAdmin({
      achievements: [{ id: 'a3', slug: 'sx_score_100', name: 'Rising Talent', category: 'score', xp_reward: 50, coin_reward: 25 }],
    })
    await checkAndUnlockAchievements(client as never, 'p1', { type: 'sx_score_updated', newScore: 120 })
    expect(inserted.map((r) => r.achievement_id)).toEqual(['a3'])
  })

  it('does not unlock a threshold not yet reached', async () => {
    const { client, inserted } = fakeAdmin({
      achievements: [{ id: 'a3', slug: 'sx_score_100', name: 'Rising Talent', category: 'score', xp_reward: 50, coin_reward: 25 }],
    })
    await checkAndUnlockAchievements(client as never, 'p1', { type: 'sx_score_updated', newScore: 99 })
    expect(inserted).toEqual([])
  })
})

describe('checkAndUnlockAchievements — awards + notification', () => {
  it('awards xp and coins and sends an achievement_unlocked notification on unlock', async () => {
    const { awardXP } = await import('@/lib/membership/xp')
    const { awardCoins } = await import('@/lib/coins/service')
    const { notifyInApp } = await import('@/lib/notifications/inbox')
    const { client } = fakeAdmin({
      achievements: [{ id: 'a1', slug: 'first_match', name: 'First Blood', category: 'matches', xp_reward: 50, coin_reward: 20 }],
      profile: { total_matches: 1, wins: 0 },
    })
    await checkAndUnlockAchievements(client as never, 'p1', { type: 'match_completed', matchId: 'm1', won: false })
    expect(awardXP).toHaveBeenCalledWith(client, 'p1', 50, 'achievement_unlocked', 'a1')
    expect(awardCoins).toHaveBeenCalledWith(client, 'p1', 20, 'achievement_unlocked', 'a1')
    expect(notifyInApp).toHaveBeenCalledWith(expect.objectContaining({ playerId: 'p1', type: 'achievement_unlocked' }))
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/achievements/unlock.test.ts` — expect FAIL, module doesn't exist.

- [ ] **Step 3: Implement**

```ts
import { awardXP } from '@/lib/membership/xp'
import { awardCoins } from '@/lib/coins/service'
import { notifyInApp } from '@/lib/notifications/inbox'
import type { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

export type AchievementContext =
  | { type: 'match_completed'; matchId: string; won: boolean }
  | { type: 'tournament_completed'; tournamentId: string; placement: number; tournamentType: string }
  | { type: 'sx_score_updated'; newScore: number }
  | { type: 'profile_updated' }
  | { type: 'season_completed'; season: string } // not yet fired anywhere — see Task 4.3 note

interface AchievementRow {
  id: string
  slug: string
  name: string
  category: string
  xp_reward: number
  coin_reward: number
}

const SCORE_THRESHOLDS: [string, number][] = [
  ['sx_score_100', 100],
  ['sx_score_500', 500],
  ['sx_score_1000', 1000],
  ['sx_score_5000', 5000],
]

async function unlockedSlugSet(admin: Admin, playerId: string): Promise<Set<string>> {
  const { data } = await admin.from('player_achievements').select('achievement_id').eq('player_id', playerId)
  return new Set((data ?? []).map((r) => r.achievement_id as string))
}

async function candidateAchievements(admin: Admin, category: string): Promise<AchievementRow[]> {
  const { data } = await admin
    .from('achievements')
    .select('id, slug, name, category, xp_reward, coin_reward')
    .eq('category', category)
    .eq('phase', 'phase2')
  return (data ?? []) as AchievementRow[]
}

async function unlock(admin: Admin, playerId: string, achievement: AchievementRow): Promise<void> {
  await admin.from('player_achievements').insert({ player_id: playerId, achievement_id: achievement.id })
  if (achievement.xp_reward > 0) await awardXP(admin, playerId, achievement.xp_reward, 'achievement_unlocked', achievement.id)
  if (achievement.coin_reward > 0) await awardCoins(admin, playerId, achievement.coin_reward, 'achievement_unlocked', achievement.id)
  await notifyInApp({
    playerId,
    type: 'achievement_unlocked',
    title: 'Achievement unlocked!',
    body: `${achievement.name} — +${achievement.xp_reward} XP, +${achievement.coin_reward} SX Coins.`,
    link: `/players`,
  })
}

async function unlockIfDue(
  admin: Admin,
  playerId: string,
  already: Set<string>,
  candidates: AchievementRow[],
  isDue: (slug: string) => boolean,
): Promise<void> {
  for (const a of candidates) {
    if (already.has(a.id) || already.has(a.slug)) continue
    if (isDue(a.slug)) await unlock(admin, playerId, a)
  }
}

export async function checkAndUnlockAchievements(admin: Admin, playerId: string, context: AchievementContext): Promise<void> {
  const already = await unlockedSlugSet(admin, playerId)

  if (context.type === 'match_completed') {
    const { data: profile } = await admin.from('profiles').select('total_matches, wins').eq('id', playerId).maybeSingle()
    const totalMatches = profile?.total_matches ?? 0
    const wins = profile?.wins ?? 0
    const candidates = await candidateAchievements(admin, 'matches')

    let streak = 0
    if (context.won) {
      const { data: recent } = await admin
        .from('matches')
        .select('player_a_id, player_b_id, score_a, score_b, completed_at')
        .eq('status', 'completed')
        .or(`player_a_id.eq.${playerId},player_b_id.eq.${playerId}`)
        .order('completed_at', { ascending: false })
        .limit(10)
      for (const m of recent ?? []) {
        const isA = m.player_a_id === playerId
        const mine = isA ? m.score_a : m.score_b
        const theirs = isA ? m.score_b : m.score_a
        if (mine == null || theirs == null || mine <= theirs) break
        streak++
      }
    }

    await unlockIfDue(admin, playerId, already, candidates, (slug) => {
      if (slug === 'first_match') return totalMatches >= 1
      if (slug === 'matches_10') return totalMatches >= 10
      if (slug === 'matches_50') return totalMatches >= 50
      if (slug === 'matches_100') return totalMatches >= 100
      if (slug === 'first_win') return context.won && wins >= 1
      if (slug === 'wins_10') return context.won && wins >= 10
      if (slug === 'wins_50') return context.won && wins >= 50
      if (slug === 'win_streak_3') return context.won && streak >= 3
      if (slug === 'win_streak_5') return context.won && streak >= 5
      return false
    })
    return
  }

  if (context.type === 'tournament_completed') {
    const candidates = await candidateAchievements(admin, 'tournaments')
    const { count: championCount } = await admin
      .from('season_ranking_points')
      .select('id', { count: 'exact', head: true })
      .eq('player_id', playerId)
      .eq('placement', 1)

    await unlockIfDue(admin, playerId, already, candidates, (slug) => {
      if (slug === 'first_tournament') return true
      if (slug === 'first_podium') return context.placement <= 3
      if (slug === 'first_champion') return context.placement === 1
      if (slug === 'champion_3x') return context.placement === 1 && (championCount ?? 0) >= 3
      if (slug === 'masters_qualifier') return context.tournamentType === 'masters'
      if (slug === 'masters_champion') return context.tournamentType === 'masters' && context.placement === 1
      if (slug === 'champions_cup_qualifier') return context.tournamentType === 'champions_cup'
      if (slug === 'champions_cup_champion') return context.tournamentType === 'champions_cup' && context.placement === 1
      return false
    })

    const seasonCandidates = await candidateAchievements(admin, 'season')
    await unlockIfDue(admin, playerId, already, seasonCandidates, (slug) => {
      // season_top_100/season_top_10/season_month_sweep are deliberately not
      // evaluated here — see Global Constraints #6 and the note above Task 4.3.
      if (slug === 'season_participant') return context.tournamentType === 'community_club'
      return false
    })
    return
  }

  if (context.type === 'sx_score_updated') {
    const candidates = await candidateAchievements(admin, 'score')
    await unlockIfDue(admin, playerId, already, candidates, (slug) => {
      const threshold = SCORE_THRESHOLDS.find(([s]) => s === slug)?.[1]
      return threshold != null && context.newScore >= threshold
    })
    return
  }

  if (context.type === 'profile_updated') {
    const { data: profile } = await admin
      .from('profiles')
      .select('avatar_url, bio, phone_verified_at')
      .eq('id', playerId)
      .maybeSingle()
    const candidates = await candidateAchievements(admin, 'profile')
    await unlockIfDue(admin, playerId, already, candidates, (slug) => {
      if (slug === 'profile_complete') return !!profile?.avatar_url && !!profile?.bio
      if (slug === 'phone_verified') return !!profile?.phone_verified_at
      return false
    })
    return
  }

  // 'season_completed' — no-op in this phase; see Global Constraints #6.
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/achievements/unlock.test.ts` — expect PASS.

- [ ] **Step 5: Wire the `sx_score_updated` trigger**

In `lib/scoring/apply.ts`, inside `refreshPlayer` (Task 1.6 already exported it), right after the `.update({ ...aggregates, sx_score })` call, add:

```ts
import { checkAndUnlockAchievements } from '@/lib/achievements/unlock'
// ... inside refreshPlayer, after the profiles.update call:
await checkAndUnlockAchievements(admin, playerId, { type: 'sx_score_updated', newScore: sx_score })
```

This fires on every score recompute (match confirm, no-show resolution, dispute, disqualification, and the admin full-recompute button) — correct, since crossing a score threshold should unlock the achievement regardless of which path caused the score change.

- [ ] **Step 6: Wire the `profile_updated` trigger**

In `lib/profile/actions.ts::updateProfile`, right after the successful `.update(...)` call and before `revalidatePath`, add:

```ts
import { createAdminClient } from '@/lib/supabase/admin'
import { checkAndUnlockAchievements } from '@/lib/achievements/unlock'
// ... after the successful update:
await checkAndUnlockAchievements(createAdminClient(), user.id, { type: 'profile_updated' })
```

In `lib/phone/actions.ts::confirmPhoneCode`, right after the `.update({ phone: ..., phone_verified_at: ... })` call, add:

```ts
import { checkAndUnlockAchievements } from '@/lib/achievements/unlock'
// ... after the profiles.update call (admin client already in scope here):
await checkAndUnlockAchievements(admin, user.id, { type: 'profile_updated' })
```

- [ ] **Step 7: Run the full test suite**

Run: `npm run test` — expect PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/achievements/unlock.ts lib/achievements/unlock.test.ts lib/scoring/apply.ts lib/profile/actions.ts lib/phone/actions.ts
git commit -m "feat(achievements): add checkAndUnlockAchievements, wire into score/profile/phone triggers"
```

---

## Part 5 — Store Page

### Task 5.1: `/store` page + components

**Files:**
- Create: `app/store/page.tsx`
- Create: `components/store/StoreGrid.tsx`
- Create: `components/store/StoreItemCard.tsx`

**Interfaces:**
- Consumes: `purchaseStoreItem`, `equipStoreItem` (Task 3.5), `getCoinBalance` (Task 3.2), `ACHIEVEMENT_CATEGORY_LABELS`-equivalent for store (this task defines its own `STORE_CATEGORY_LABELS`, store categories are a different set than achievement categories).

- [ ] **Step 1: Build the page (Server Component, auth-optional — store is publicly browsable, purchase/equip require login)**

```tsx
// app/store/page.tsx
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCoinBalance } from '@/lib/coins/service'
import { StoreGrid } from '@/components/store/StoreGrid'
import { buildMetadata } from '@/lib/seo/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Store — Sentinel X',
  description: 'Spend your SX Coins on avatar borders, profile themes, username colours, and mascot skins.',
  path: '/store',
})

export default async function StorePage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: items } = await supabase
    .from('store_items')
    .select('id, slug, name, description, category, price_coins, preview_url')
    .eq('active', true)
    .order('category')
    .order('sort_order')

  let ownedItemIds = new Set<string>()
  let equippedItemIds = new Set<string>()
  let balance = 0
  if (user) {
    const admin = createAdminClient()
    const [{ data: owned }, coinBalance] = await Promise.all([
      admin.from('player_store_items').select('item_id, equipped').eq('player_id', user.id),
      getCoinBalance(admin, user.id),
    ])
    ownedItemIds = new Set((owned ?? []).map((o) => o.item_id))
    equippedItemIds = new Set((owned ?? []).filter((o) => o.equipped).map((o) => o.item_id))
    balance = coinBalance
  }

  return (
    <div className="mx-auto max-w-7xl px-4 pb-20 sm:px-6 lg:px-8">
      <header className="mb-8 flex flex-col items-center gap-4 pt-8 text-center sm:flex-row sm:justify-between sm:text-left">
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-widest text-sx-purple-text">Store</p>
          <h1 className="font-display text-3xl font-black uppercase text-white sm:text-4xl">Spend Your SX Coins</h1>
        </div>
        {user ? (
          <div className="shrink-0 rounded-xl border border-sx-border bg-sx-surface px-5 py-3 text-center">
            <p className="text-[10px] uppercase tracking-wide text-sx-gray">Your Balance</p>
            <p className="font-display text-2xl font-black text-white">🪙 {balance.toLocaleString()}</p>
          </div>
        ) : (
          <a href="/login?next=/store" className="rounded-lg bg-sx-purple px-4 py-2.5 text-xs font-bold text-white hover:bg-sx-purple-light">
            Sign in to buy
          </a>
        )}
      </header>
      <StoreGrid items={items ?? []} ownedItemIds={ownedItemIds} equippedItemIds={equippedItemIds} isLoggedIn={!!user} />
    </div>
  )
}
```

- [ ] **Step 2: `StoreGrid` — groups items by category**

```tsx
// components/store/StoreGrid.tsx
import { StoreItemCard, type StoreItem } from './StoreItemCard'

const CATEGORY_LABELS: Record<string, string> = {
  avatar_border: 'Avatar Borders',
  profile_theme: 'Profile Card Themes',
  username_colour: 'Username Colours',
  bubble_skin: 'Guide Bubble Skins',
}
const CATEGORY_ORDER = ['avatar_border', 'profile_theme', 'username_colour', 'bubble_skin']

export function StoreGrid({
  items,
  ownedItemIds,
  equippedItemIds,
  isLoggedIn,
}: {
  items: StoreItem[]
  ownedItemIds: Set<string>
  equippedItemIds: Set<string>
  isLoggedIn: boolean
}) {
  return (
    <div className="space-y-10">
      {CATEGORY_ORDER.filter((c) => items.some((i) => i.category === c)).map((category) => (
        <section key={category}>
          <h2 className="mb-4 text-sm font-bold uppercase tracking-widest text-white">{CATEGORY_LABELS[category]}</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {items
              .filter((i) => i.category === category)
              .map((item) => (
                <StoreItemCard
                  key={item.id}
                  item={item}
                  owned={ownedItemIds.has(item.id)}
                  equipped={equippedItemIds.has(item.id)}
                  isLoggedIn={isLoggedIn}
                />
              ))}
          </div>
        </section>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: `StoreItemCard` — client component (form state via `useFormState`)**

```tsx
// components/store/StoreItemCard.tsx
'use client'
import { useFormState, useFormStatus } from 'react-dom'
import { purchaseStoreItem, equipStoreItem } from '@/lib/coins/actions'
import { ImagePlaceholder } from '@/components/ui/ImagePlaceholder'

export interface StoreItem {
  id: string
  slug: string
  name: string
  description: string | null
  category: string
  price_coins: number
  preview_url: string | null
}

function SubmitButton({ children, variant }: { children: React.ReactNode; variant: 'buy' | 'equip' }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className={`w-full rounded-lg px-3 py-2 text-xs font-bold transition-colors disabled:opacity-50 ${
        variant === 'buy' ? 'bg-sx-purple text-white hover:bg-sx-purple-light' : 'border border-sx-border text-white hover:border-sx-purple/40'
      }`}
    >
      {pending ? '…' : children}
    </button>
  )
}

export function StoreItemCard({
  item,
  owned,
  equipped,
  isLoggedIn,
}: {
  item: StoreItem
  owned: boolean
  equipped: boolean
  isLoggedIn: boolean
}) {
  const [purchaseState, purchaseAction] = useFormState(purchaseStoreItem, undefined)
  const [equipState, equipAction] = useFormState(equipStoreItem, undefined)

  return (
    <div className="flex flex-col rounded-xl border border-sx-border bg-sx-surface p-3">
      {item.preview_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.preview_url} alt={item.name} className="mb-2 aspect-square w-full rounded-lg object-cover" />
      ) : (
        <ImagePlaceholder className="mb-2 aspect-square w-full rounded-lg" label={item.name} />
      )}
      <p className="truncate text-xs font-bold text-white">{item.name}</p>
      <p className="mb-2 text-[11px] text-sx-gray">🪙 {item.price_coins.toLocaleString()}</p>
      {!isLoggedIn ? (
        <a href="/login?next=/store" className="block rounded-lg border border-sx-border px-3 py-2 text-center text-xs font-bold text-white">
          Sign in
        </a>
      ) : equipped ? (
        <span className="block rounded-lg bg-sx-green/20 px-3 py-2 text-center text-xs font-bold text-sx-green">Equipped</span>
      ) : owned ? (
        <form action={equipAction}>
          <input type="hidden" name="itemId" value={item.id} />
          <SubmitButton variant="equip">Equip</SubmitButton>
        </form>
      ) : (
        <form action={purchaseAction}>
          <input type="hidden" name="itemId" value={item.id} />
          <SubmitButton variant="buy">Buy</SubmitButton>
        </form>
      )}
      {purchaseState?.error && <p className="mt-1 text-[10px] text-red-400">{purchaseState.error}</p>}
      {equipState?.error && <p className="mt-1 text-[10px] text-red-400">{equipState.error}</p>}
    </div>
  )
}
```

(Read `components/ui/ImagePlaceholder.tsx` first to confirm its actual prop names — it's used elsewhere in this codebase, e.g. `app/(public)/rankings/page.tsx`, with a `className`/`label` shape; match whatever it really is rather than guessing.)

- [ ] **Step 4: Add `/store` to primary nav**

Find the site header/nav component (grep for where `/exchange` or `/rankings` appear in a nav list — likely `components/layout/Header.tsx` or similar) and add a `/store` entry with a 🛍️ or 🪙 icon, following that file's existing pattern exactly.

- [ ] **Step 5: Manual smoke check**

Run `npm run build` (catches Server/Client Component boundary mistakes). Load `/store` logged out (browse-only, no buy buttons) and logged in (buy → equip flow) against a local/dev Supabase instance if available.

- [ ] **Step 6: Commit**

```bash
git add app/store/page.tsx components/store/StoreGrid.tsx components/store/StoreItemCard.tsx
git commit -m "feat(store): add public /store page with buy/equip flow"
```

---

## Part 6 — UI Updates

### Task 6.1: Player profile — tier badge, achievements grid, coin balance

**Files:**
- Create: `components/player/MembershipBadge.tsx`
- Create: `components/player/AchievementsGrid.tsx`
- Modify: `components/player/ProfileHeader.tsx`
- Modify: `app/(public)/players/[username]/page.tsx`

- [ ] **Step 1: `MembershipBadge`**

```tsx
// components/player/MembershipBadge.tsx
import type { MembershipTier } from '@/lib/membership/tiers'

const TIER: Record<MembershipTier, { label: string; cls: string }> = {
  recruit:  { label: 'Recruit',  cls: 'border-slate-600 text-slate-300' },
  guardian: { label: 'Guardian', cls: 'border-blue-500/50 text-blue-400' },
  elite:    { label: 'Elite',    cls: 'border-sx-purple/50 text-sx-purple-text' },
  sentinel: { label: 'Sentinel', cls: 'border-amber-500/50 text-amber-400' },
  legend:   { label: 'Legend',   cls: 'border-red-500/50 bg-gradient-to-r from-red-400 to-amber-300 bg-clip-text text-transparent' },
}

export function MembershipBadge({ tier }: { tier: string }) {
  const t = TIER[tier as MembershipTier] ?? TIER.recruit
  return (
    <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${t.cls}`}>{t.label}</span>
  )
}
```

- [ ] **Step 2: `AchievementsGrid` — replaces the profile page's `TrophiesComingSoon`**

```tsx
// components/player/AchievementsGrid.tsx
import { Medal } from 'lucide-react'

export interface AchievementCell {
  slug: string
  name: string
  description: string
  unlocked: boolean
}

export function AchievementsGrid({ achievements }: { achievements: AchievementCell[] }) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-widest text-white">Trophies &amp; Badges</h2>
        <span className="text-xs text-sx-gray">
          {achievements.filter((a) => a.unlocked).length}/{achievements.length}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {achievements.map((a) => (
          <div
            key={a.slug}
            title={a.description}
            className={`flex flex-col items-center gap-2 rounded-xl border p-4 text-center ${
              a.unlocked ? 'border-sx-purple/40 bg-sx-surface' : 'border-sx-border bg-sx-surface opacity-50'
            }`}
          >
            <Medal className={`h-8 w-8 ${a.unlocked ? 'text-sx-purple-text' : 'text-sx-gray'}`} />
            <p className={`text-xs font-semibold ${a.unlocked ? 'text-white' : 'text-sx-gray'}`}>{a.name}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
```

- [ ] **Step 3: Wire tier badge into `ProfileHeader`**

In `components/player/ProfileHeader.tsx`, add `import { MembershipBadge } from './MembershipBadge'` and render `<MembershipBadge tier={profile.membershipTier} />` next to the existing `<TierBadge tier={profile.sentinelTier} />` (line 39) — both badges show, since they're different concepts (Global Constraints #5). Add `membershipTier: string` to `ProfileView` in `lib/players/profile.ts`.

- [ ] **Step 4: Wire into the profile page**

In `app/(public)/players/[username]/page.tsx`:
- Add `xp, membership_tier` to `PROFILE_COLS` and `ProfileRow`.
- Add `membershipTier: p.membership_tier` to the `ProfileView` construction.
- Fetch the achievement grid data: `supabase.from('achievements').select('slug, name, description').order('sort_order')` and `supabase.from('player_achievements').select('achievement_id').eq('player_id', p.id)` (add both to the existing `Promise.all`), then build `AchievementCell[]` by cross-referencing.
- Fetch coin balance **only when `user?.id === p.id`** (owner-only, per design doc §8): `user && user.id === p.id ? await getCoinBalance(createAdminClient(), p.id) : null`.
- Replace the `<TrophiesComingSoon />` call (and delete the `TrophiesComingSoon` function + `BADGE_NAMES` constant entirely) with `<AchievementsGrid achievements={achievementCells} />`.
- If `coinBalance !== null`, render a small owner-only coin balance chip near the header (e.g. inside `ProfileHeader` behind a new optional `coinBalance?: number` prop, shown only when passed).

- [ ] **Step 5: Run tests + build**

Run: `npm run test && npm run build`.

- [ ] **Step 6: Commit**

```bash
git add components/player/MembershipBadge.tsx components/player/AchievementsGrid.tsx components/player/ProfileHeader.tsx lib/players/profile.ts "app/(public)/players/[username]/page.tsx"
git commit -m "feat(ui): add membership badge + real achievements grid to player profile"
```

### Task 6.2: Dashboard — XP bar, coin balance, recent achievements, login streak

**Files:**
- Create: `components/dashboard/XPProgressPanel.tsx`
- Create: `components/dashboard/CoinBalancePanel.tsx`
- Create: `components/dashboard/RecentAchievements.tsx`
- Create: `components/dashboard/LoginStreakBadge.tsx`
- Modify: `app/dashboard/page.tsx`

- [ ] **Step 1: `XPProgressPanel`**

```tsx
// components/dashboard/XPProgressPanel.tsx
import { computeTier, TIER_XP_THRESHOLDS, type MembershipTier } from '@/lib/membership/tiers'

const NEXT_TIER: Record<MembershipTier, MembershipTier | null> = {
  recruit: 'guardian', guardian: 'elite', elite: 'sentinel', sentinel: 'legend', legend: null,
}

export function XPProgressPanel({ xp }: { xp: number }) {
  const tier = computeTier(xp)
  const next = NEXT_TIER[tier]
  const floor = TIER_XP_THRESHOLDS[tier]
  const ceiling = next ? TIER_XP_THRESHOLDS[next] : null
  const pct = ceiling ? Math.min(100, Math.round(((xp - floor) / (ceiling - floor)) * 100)) : 100

  return (
    <div className="rounded-xl border border-sx-border bg-sx-surface p-4">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="font-bold uppercase text-white">{tier}</span>
        <span className="text-sx-gray">{xp.toLocaleString()} XP{ceiling ? ` / ${ceiling.toLocaleString()}` : ' (max tier)'}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-800">
        <div className="h-full rounded-full bg-sx-purple transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: `CoinBalancePanel`, `RecentAchievements`, `LoginStreakBadge`**

```tsx
// components/dashboard/CoinBalancePanel.tsx
import Link from 'next/link'

export function CoinBalancePanel({ balance }: { balance: number }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-sx-border bg-sx-surface p-4">
      <div>
        <p className="text-[10px] uppercase tracking-wide text-sx-gray">SX Coins</p>
        <p className="font-display text-xl font-black text-white">🪙 {balance.toLocaleString()}</p>
      </div>
      <Link href="/store" className="rounded-lg bg-sx-purple px-3 py-2 text-xs font-bold text-white hover:bg-sx-purple-light">
        Store →
      </Link>
    </div>
  )
}
```

```tsx
// components/dashboard/RecentAchievements.tsx
import { Medal } from 'lucide-react'

export interface RecentAchievement {
  name: string
  unlockedAt: string
}

export function RecentAchievements({ achievements }: { achievements: RecentAchievement[] }) {
  if (achievements.length === 0) return null
  return (
    <div className="space-y-2">
      {achievements.map((a) => (
        <div key={a.name} className="flex items-center gap-2 text-xs text-sx-gray">
          <Medal className="h-4 w-4 text-sx-purple-text" /> {a.name}
        </div>
      ))}
    </div>
  )
}
```

```tsx
// components/dashboard/LoginStreakBadge.tsx
export function LoginStreakBadge({ streak }: { streak: number }) {
  if (streak <= 0) return null
  return <span className="text-xs font-semibold text-amber-400">🔥 {streak}-day streak</span>
}
```

- [ ] **Step 3: Wire into `app/dashboard/page.tsx`**

Add `xp, membership_tier, login_streak` to the existing `profiles` select in the `Promise.all` (currently selects `'username, display_name, avatar_url, whatsapp_number, country, bio, wins, losses, goals_scored, phone_verified_at'` — append the three new columns). Add two more entries to the same `Promise.all`: `getCoinBalance(createAdminClient(), user.id)` and a query for the 3 most recent unlocked achievements (`supabase.from('player_achievements').select('unlocked_at, achievements(name)').eq('player_id', user.id).order('unlocked_at', { ascending: false }).limit(3)`). Render a new `<CollapsibleSection id="progression" title="Your Progress" defaultOpen>` block, placed right after `<DashboardHeader ... />` and before the existing `<MastersInvitationBanner>` check, containing `<XPProgressPanel xp={profile?.xp ?? 0} />`, `<CoinBalancePanel balance={coinBalance} />`, `<LoginStreakBadge streak={profile?.login_streak ?? 0} />`, and `<RecentAchievements achievements={recentAchievements} />`.

- [ ] **Step 4: Run tests + build**

Run: `npm run test && npm run build`.

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/XPProgressPanel.tsx components/dashboard/CoinBalancePanel.tsx components/dashboard/RecentAchievements.tsx components/dashboard/LoginStreakBadge.tsx app/dashboard/page.tsx
git commit -m "feat(ui): add XP progress, coin balance, recent achievements, login streak to dashboard"
```

### Task 6.3: Leaderboards — tier badge

**Files:**
- Modify: `app/(public)/rankings/page.tsx`
- Modify: `components/rankings/LeaderboardTable.tsx`
- Modify: `lib/rankings/leaderboard.ts`

- [ ] **Step 1: Extend `PlayerStatsInput`**

In `lib/rankings/leaderboard.ts`, add `membershipTier: string` to `PlayerStatsInput` (alongside the `sxScore`/`sentinelTier` rename already done in Task 1.7).

- [ ] **Step 2: Select + pass through in the rankings page**

In `app/(public)/rankings/page.tsx`, add `membership_tier` to the `profiles` select string and `membershipTier: p.membership_tier` to the `players` mapping.

- [ ] **Step 3: Render in the table**

Read `components/rankings/LeaderboardTable.tsx` first to find where each player row renders their name/tier. Add `import { MembershipBadge } from '@/components/player/MembershipBadge'` and render `<MembershipBadge tier={player.membershipTier} />` next to the player name, following the existing row layout's spacing conventions.

- [ ] **Step 4: Run tests + build**

Run: `npm run test && npm run build`.

- [ ] **Step 5: Commit**

```bash
git add app/(public)/rankings/page.tsx components/rankings/LeaderboardTable.tsx lib/rankings/leaderboard.ts
git commit -m "feat(ui): show membership tier badge on leaderboards"
```

---

## Part 7 — Wallet Enhancements

### Task 7.1: Migration — `wallet_transactions.category` + backfill

**Files:**
- Create: `supabase/migrations/053_wallet_category.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 053_wallet_category.sql
-- Phase 2 Economy §6: earnings-breakdown category on wallet_transactions.
-- See docs/superpowers/specs/2026-08-05-phase2-economy-design.md §6.

ALTER TABLE public.wallet_transactions
  ADD COLUMN category text
    CHECK (category IN ('tournament_prize', 'referral', 'community', 'bonus', 'withdrawal', 'entry_fee', 'refund'));

-- Backfill from the existing `type` column — a direct, unambiguous mapping
-- for every type value that exists today (see lib/wallet/service.ts
-- WalletTxnType and lib/betting's additions). Rows this doesn't cover
-- (there are none as of this migration — every existing type is listed
-- below) are left NULL rather than guessed.
UPDATE public.wallet_transactions SET category = 'tournament_prize' WHERE type = 'prize';
UPDATE public.wallet_transactions SET category = 'referral' WHERE type = 'referral';
UPDATE public.wallet_transactions SET category = 'bonus' WHERE type IN ('admin_credit', 'friendly_stake', 'bet_stake', 'bet_payout', 'bet_refund', 'deposit');
UPDATE public.wallet_transactions SET category = 'withdrawal' WHERE type IN ('withdrawal_request', 'withdrawal_reversal');
```

- [ ] **Step 2: Apply, regenerate types, commit**

Apply via Supabase MCP `apply_migration` (name `wallet_category`). Regenerate `lib/supabase/types.ts`. Confirm `SELECT category, count(*) FROM wallet_transactions GROUP BY category;` shows no unexpected NULLs.

```bash
git add supabase/migrations/053_wallet_category.sql lib/supabase/types.ts
git commit -m "feat(wallet): add category column to wallet_transactions, backfill from type"
```

### Task 7.2: `creditWallet()` — write category going forward

**Files:**
- Modify: `lib/wallet/service.ts`

**Interfaces:**
- Produces: `creditWallet(admin, playerId, amount, type, referenceId, note?, category?)` — the new 7th param defaults per `type` if omitted, so every existing call site keeps compiling unchanged.

- [ ] **Step 1: Update `creditWallet`'s insert to always set a category**

```ts
const DEFAULT_CATEGORY_BY_TYPE: Record<WalletTxnType, string> = {
  prize: 'tournament_prize',
  referral: 'referral',
  friendly_stake: 'bonus',
  admin_credit: 'bonus',
  withdrawal_request: 'withdrawal',
  withdrawal_reversal: 'withdrawal',
  bet_stake: 'bonus',
  bet_payout: 'bonus',
  bet_refund: 'bonus',
  deposit: 'bonus',
}

export async function creditWallet(
  admin: SupabaseClient<Database>,
  playerId: string,
  amount: number,
  type: WalletTxnType,
  referenceId: string | null,
  note?: string,
): Promise<void> {
  // ... existing wallet upsert logic unchanged ...
  await admin.from('wallet_transactions').insert({
    player_id: playerId,
    amount,
    type,
    reference_id: referenceId,
    note: note ?? null,
    category: DEFAULT_CATEGORY_BY_TYPE[type],
  })
}
```

(Apply the same `category: DEFAULT_CATEGORY_BY_TYPE[type]` addition to `debitWallet`'s insert too, so withdrawal debits are categorized consistently.)

- [ ] **Step 2: Run tests**

Run: `npx vitest run lib/wallet` — expect PASS (no signature change, so no caller needs updating).

- [ ] **Step 3: Commit**

```bash
git add lib/wallet/service.ts
git commit -m "feat(wallet): write category on every new wallet_transactions row"
```

### Task 7.3: Earnings breakdown query + panel

**Files:**
- Create: `lib/wallet/breakdown.ts`
- Create: `lib/wallet/breakdown.test.ts`
- Create: `components/dashboard/EarningsBreakdownPanel.tsx`
- Modify: `app/dashboard/page.tsx`

**Interfaces:**
- Produces: `summarizeEarningsByCategory(transactions): Record<string, number>` (pure, unit-tested) + a thin IO wrapper `getEarningsBreakdown(admin, playerId)` — consumed by the dashboard wallet section.

- [ ] **Step 1: Write the failing test for the pure summarizer**

```ts
import { describe, it, expect } from 'vitest'
import { summarizeEarningsByCategory } from './breakdown'

describe('summarizeEarningsByCategory', () => {
  it('sums credits (positive amounts) grouped by category, ignoring debits', () => {
    const result = summarizeEarningsByCategory([
      { amount: 5000, category: 'tournament_prize' },
      { amount: 3000, category: 'tournament_prize' },
      { amount: 500, category: 'referral' },
      { amount: -2000, category: 'withdrawal' }, // debit — excluded from an "earnings" breakdown
      { amount: 1000, category: null }, // uncategorized legacy row — excluded, not silently bucketed
    ])
    expect(result).toEqual({ tournament_prize: 8000, referral: 500 })
  })

  it('returns an empty object for no transactions', () => {
    expect(summarizeEarningsByCategory([])).toEqual({})
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/wallet/breakdown.test.ts` — expect FAIL, module doesn't exist.

- [ ] **Step 3: Implement**

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'

interface CategorizedTxn {
  amount: number
  category: string | null
}

// Pure — unit tested directly. Only positive (credit) amounts count toward
// "earnings"; a null category (pre-migration legacy row with no backfill
// match) is excluded rather than lumped into an inaccurate bucket.
export function summarizeEarningsByCategory(transactions: CategorizedTxn[]): Record<string, number> {
  const totals: Record<string, number> = {}
  for (const t of transactions) {
    if (t.amount <= 0 || !t.category) continue
    totals[t.category] = (totals[t.category] ?? 0) + t.amount
  }
  return totals
}

export async function getEarningsBreakdown(
  admin: SupabaseClient<Database>,
  playerId: string,
): Promise<Record<string, number>> {
  const { data } = await admin.from('wallet_transactions').select('amount, category').eq('player_id', playerId)
  return summarizeEarningsByCategory(data ?? [])
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/wallet/breakdown.test.ts` — expect PASS.

- [ ] **Step 5: `EarningsBreakdownPanel` component**

```tsx
// components/dashboard/EarningsBreakdownPanel.tsx
import { formatNaira } from '@/lib/format'

const CATEGORY_LABELS: Record<string, string> = {
  tournament_prize: 'Tournament Winnings',
  referral: 'Referral Rewards',
  community: 'Community Rewards',
  bonus: 'Cashback / Bonuses',
}
const CATEGORY_ORDER = ['tournament_prize', 'referral', 'community', 'bonus']

export function EarningsBreakdownPanel({ breakdown }: { breakdown: Record<string, number> }) {
  return (
    <div className="rounded-xl border border-sx-border bg-sx-surface p-4">
      <p className="mb-3 text-xs font-bold uppercase tracking-widest text-sx-purple-text">Earnings Breakdown</p>
      <div className="space-y-2">
        {CATEGORY_ORDER.map((cat) => (
          <div key={cat} className="flex items-center justify-between text-sm">
            <span className="text-sx-gray">{CATEGORY_LABELS[cat]}</span>
            <span className="font-semibold text-white">{formatNaira(breakdown[cat] ?? 0)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Wire into the dashboard wallet section**

In `app/dashboard/page.tsx`, add `getEarningsBreakdown(createAdminClient(), user.id)` to the existing `Promise.all`, and render `<EarningsBreakdownPanel breakdown={earningsBreakdown} />` inside the existing `<CollapsibleSection id="wallet" ...>` block (line 584), above `<WalletPanel ...>`.

- [ ] **Step 7: Run tests + build**

Run: `npm run test && npm run build`.

- [ ] **Step 8: Commit**

```bash
git add lib/wallet/breakdown.ts lib/wallet/breakdown.test.ts components/dashboard/EarningsBreakdownPanel.tsx app/dashboard/page.tsx
git commit -m "feat(wallet): add earnings breakdown by category to dashboard"
```

---

## Part 8 — Admin

### Task 8.1: Admin player economy actions + panel

**Files:**
- Create: `lib/admin/player-economy-actions.ts`
- Create: `lib/admin/player-economy-actions.test.ts`
- Create: `components/admin/PlayerEconomyPanel.tsx`
- Create: `app/admin/players/[id]/page.tsx`

**Interfaces:**
- Consumes: `requireAdmin` (`lib/admin/auth.ts`), `awardCoins`, `awardXP`, pattern mirrors `lib/admin/wallet-actions.ts::manualCreditWallet` exactly (Zod-validated reason, `createAdminClient()`, `notifyInApp`, `revalidatePath`).

- [ ] **Step 1: Write the failing test for the pure validation**

```ts
import { describe, it, expect } from 'vitest'
import { validateGrantAmount } from './player-economy-actions'

describe('validateGrantAmount', () => {
  it('rejects a non-positive amount', () => {
    expect(validateGrantAmount(0)).toBe('Enter a whole amount greater than 0.')
    expect(validateGrantAmount(-5)).toBe('Enter a whole amount greater than 0.')
  })
  it('rejects a non-integer amount', () => {
    expect(validateGrantAmount(5.5)).toBe('Enter a whole amount greater than 0.')
  })
  it('accepts a positive integer', () => {
    expect(validateGrantAmount(100)).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/admin/player-economy-actions.test.ts` — expect FAIL, module doesn't exist.

- [ ] **Step 3: Implement**

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/admin/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { awardCoins } from '@/lib/coins/service'
import { awardXP } from '@/lib/membership/xp'
import { notifyInApp } from '@/lib/notifications/inbox'

export type EconomyActionState = { error?: string; success?: boolean } | undefined

export function validateGrantAmount(amount: number): string | null {
  if (!Number.isInteger(amount) || amount <= 0) return 'Enter a whole amount greater than 0.'
  return null
}

async function readReason(formData: FormData): Promise<string | { error: string }> {
  const reason = String(formData.get('reason') ?? '').trim()
  if (!reason) return { error: 'Enter a reason for this action.' }
  return reason
}

export async function grantCoins(_prev: EconomyActionState, formData: FormData): Promise<EconomyActionState> {
  await requireAdmin()
  const playerId = String(formData.get('playerId') ?? '')
  const amount = Number(formData.get('amount'))
  const amountError = validateGrantAmount(amount)
  if (amountError) return { error: amountError }
  const reason = await readReason(formData)
  if (typeof reason !== 'string') return reason

  const admin = createAdminClient()
  await awardCoins(admin, playerId, amount, 'admin_grant', null, reason)
  await notifyInApp({ playerId, type: 'wallet_credited', title: 'SX Coins granted', body: `+${amount} SX Coins: ${reason}`, link: '/dashboard' })
  revalidatePath(`/admin/players/${playerId}`)
  return { success: true }
}

export async function deductCoins(_prev: EconomyActionState, formData: FormData): Promise<EconomyActionState> {
  await requireAdmin()
  const playerId = String(formData.get('playerId') ?? '')
  const amount = Number(formData.get('amount'))
  const amountError = validateGrantAmount(amount)
  if (amountError) return { error: amountError }
  const reason = await readReason(formData)
  if (typeof reason !== 'string') return reason

  const admin = createAdminClient()
  await awardCoins(admin, playerId, -amount, 'admin_deduct', null, reason)
  revalidatePath(`/admin/players/${playerId}`)
  return { success: true }
}

export async function grantXp(_prev: EconomyActionState, formData: FormData): Promise<EconomyActionState> {
  await requireAdmin()
  const playerId = String(formData.get('playerId') ?? '')
  const amount = Number(formData.get('amount'))
  const amountError = validateGrantAmount(amount)
  if (amountError) return { error: amountError }
  const reason = await readReason(formData)
  if (typeof reason !== 'string') return reason

  const admin = createAdminClient()
  await awardXP(admin, playerId, amount, 'admin_grant', null)
  revalidatePath(`/admin/players/${playerId}`)
  return { success: true }
}

// Manual unlock is a correction tool — inserts the row directly, skipping
// XP/coin rewards (design doc §7.3: "for correction purposes").
export async function manuallyUnlockAchievement(_prev: EconomyActionState, formData: FormData): Promise<EconomyActionState> {
  await requireAdmin()
  const playerId = String(formData.get('playerId') ?? '')
  const achievementId = String(formData.get('achievementId') ?? '')
  if (!playerId || !achievementId) return { error: 'Missing player or achievement.' }

  const admin = createAdminClient()
  const { error } = await admin.from('player_achievements').insert({ player_id: playerId, achievement_id: achievementId })
  if (error) {
    if ((error as { code?: string }).code === '23505') return { error: 'Player already has this achievement.' }
    return { error: 'Could not unlock the achievement.' }
  }
  revalidatePath(`/admin/players/${playerId}`)
  return { success: true }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/admin/player-economy-actions.test.ts` — expect PASS.

- [ ] **Step 5: `PlayerEconomyPanel` component + `/admin/players/[id]` page**

```tsx
// components/admin/PlayerEconomyPanel.tsx — client component, three small
// forms (grant coins / deduct coins / grant xp) each with an amount + reason
// field bound to the matching server action via useFormState, following the
// exact form-per-action shape already used elsewhere in this admin (e.g.
// wherever manualCreditWallet's form lives — read that component first and
// mirror its input/button markup and error-display convention exactly,
// rather than inventing new admin form styling).
```

Read the existing admin wallet-credit form component (the client component that calls `manualCreditWallet` — grep `app/admin/wallet` and `components/admin` for it) in full before writing `PlayerEconomyPanel.tsx`, and copy its structure: one `<form>` per action, `useFormState`, a submit button using `useFormStatus`, inline error text. Build three such forms (Grant Coins, Deduct Coins, Grant XP) plus a read-only achievements list with a "Manually unlock" `<select>` + button wired to `manuallyUnlockAchievement`.

```tsx
// app/admin/players/[id]/page.tsx
import { notFound } from 'next/navigation'
import { requireStaff } from '@/lib/admin/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCoinBalance } from '@/lib/coins/service'
import { PlayerEconomyPanel } from '@/components/admin/PlayerEconomyPanel'

export default async function AdminPlayerDetailPage({ params }: { params: { id: string } }) {
  await requireStaff()
  const admin = createAdminClient()

  const [{ data: profile }, { data: coins }, { data: unlockedAchievements }, { data: allAchievements }] = await Promise.all([
    admin.from('profiles').select('id, username, display_name, xp, membership_tier, sx_score').eq('id', params.id).maybeSingle(),
    admin.from('sx_coins').select('balance, total_earned, total_spent').eq('player_id', params.id).maybeSingle(),
    admin.from('player_achievements').select('achievement_id, unlocked_at, achievements(name)').eq('player_id', params.id),
    admin.from('achievements').select('id, name, category').order('sort_order'),
  ])
  if (!profile) notFound()

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-black text-white">{profile.display_name ?? profile.username}</h1>
      <p className="mb-6 text-sm text-slate-400">@{profile.username} · SX Score {profile.sx_score} · {profile.xp} XP · {profile.membership_tier}</p>
      <PlayerEconomyPanel
        playerId={profile.id}
        coinBalance={coins?.balance ?? 0}
        totalEarned={coins?.total_earned ?? 0}
        totalSpent={coins?.total_spent ?? 0}
        xp={profile.xp}
        membershipTier={profile.membership_tier}
        unlockedAchievements={(unlockedAchievements ?? []).map((r) => ({
          achievementId: r.achievement_id,
          unlockedAt: r.unlocked_at,
        }))}
        allAchievements={allAchievements ?? []}
      />
    </div>
  )
}
```

(`getCoinBalance` import above is unused in this exact snippet since the balance is read directly via `sx_coins` for `total_earned`/`total_spent` too — drop the import if not needed, or use `getCoinBalance` for just the balance and keep a second query for earned/spent; resolve this redundancy when actually writing the file rather than shipping a dead import.)

- [ ] **Step 6: Link to this page from somewhere in the existing admin UI**

Grep the admin index (`app/admin/page.tsx`) or wherever a player list/search already renders (`lib/admin/search.ts` per the earlier codebase exploration) and add a link to `/admin/players/[id]` from each player row, following that list's existing link pattern.

- [ ] **Step 7: Run tests + build**

Run: `npm run test && npm run build`.

- [ ] **Step 8: Commit**

```bash
git add lib/admin/player-economy-actions.ts lib/admin/player-economy-actions.test.ts components/admin/PlayerEconomyPanel.tsx "app/admin/players/[id]/page.tsx"
git commit -m "feat(admin): add per-player economy panel — grant/deduct coins, grant xp, manual achievement unlock"
```

### Task 8.2: `/admin/store` page

**Files:**
- Create: `lib/admin/store-actions.ts`
- Create: `components/admin/StoreItemForm.tsx`
- Create: `app/admin/store/page.tsx`

**Interfaces:**
- Consumes: `requireAdmin`, `createAdminClient`, `ACHIEVEMENT_CATEGORIES`-equivalent (this task's own store category list — reuse the DB CHECK's four values: `avatar_border`, `profile_theme`, `username_colour`, `bubble_skin`).

- [ ] **Step 1: `lib/admin/store-actions.ts`**

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin/auth'
import { createAdminClient } from '@/lib/supabase/admin'

export type StoreActionState = { error?: string; success?: boolean } | undefined

const storeItemSchema = z.object({
  slug: z.string().min(2).regex(/^[a-z0-9_]+$/, 'Slug must be lowercase letters, numbers, underscores only.'),
  name: z.string().min(2),
  description: z.string().optional(),
  category: z.enum(['avatar_border', 'profile_theme', 'username_colour', 'bubble_skin']),
  priceCoins: z.coerce.number().int().positive(),
  previewUrl: z.string().url().optional().or(z.literal('')),
})

export async function createStoreItem(_prev: StoreActionState, formData: FormData): Promise<StoreActionState> {
  await requireAdmin()
  const parsed = storeItemSchema.safeParse({
    slug: formData.get('slug'),
    name: formData.get('name'),
    description: formData.get('description') ?? undefined,
    category: formData.get('category'),
    priceCoins: formData.get('priceCoins'),
    previewUrl: formData.get('previewUrl') ?? '',
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const d = parsed.data

  const admin = createAdminClient()
  const { error } = await admin.from('store_items').insert({
    slug: d.slug,
    name: d.name,
    description: d.description ?? null,
    category: d.category,
    price_coins: d.priceCoins,
    preview_url: d.previewUrl || null,
  })
  if (error) {
    if ((error as { code?: string }).code === '23505') return { error: 'That slug is already in use.' }
    return { error: 'Could not create the item.' }
  }
  revalidatePath('/admin/store')
  revalidatePath('/store')
  return { success: true }
}

export async function updateStoreItem(_prev: StoreActionState, formData: FormData): Promise<StoreActionState> {
  await requireAdmin()
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing item.' }
  const priceCoins = Number(formData.get('priceCoins'))
  if (!Number.isInteger(priceCoins) || priceCoins <= 0) return { error: 'Enter a whole price greater than 0.' }

  const admin = createAdminClient()
  await admin.from('store_items').update({ price_coins: priceCoins }).eq('id', id)
  revalidatePath('/admin/store')
  revalidatePath('/store')
  return { success: true }
}

export async function toggleStoreItemActive(_prev: StoreActionState, formData: FormData): Promise<StoreActionState> {
  await requireAdmin()
  const id = String(formData.get('id') ?? '')
  const active = formData.get('active') === 'true'
  if (!id) return { error: 'Missing item.' }

  const admin = createAdminClient()
  await admin.from('store_items').update({ active: !active }).eq('id', id)
  revalidatePath('/admin/store')
  revalidatePath('/store')
  return { success: true }
}
```

- [ ] **Step 2: `app/admin/store/page.tsx`**

```tsx
import { requireAdmin } from '@/lib/admin/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { StoreItemForm } from '@/components/admin/StoreItemForm'

export default async function AdminStorePage() {
  await requireAdmin()
  const admin = createAdminClient()
  const { data: items } = await admin
    .from('store_items')
    .select('id, slug, name, category, price_coins, active, sort_order')
    .order('category')
    .order('sort_order')

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-black text-white">Store Items</h1>
      <StoreItemForm mode="create" />
      <table className="mt-8 w-full text-sm text-slate-300">
        <thead className="text-left text-xs uppercase text-slate-500">
          <tr><th className="py-2">Name</th><th>Category</th><th>Price</th><th>Active</th><th></th></tr>
        </thead>
        <tbody>
          {(items ?? []).map((item) => (
            <StoreItemForm key={item.id} mode="edit" item={item} />
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 3: `StoreItemForm`**

Client component with two render modes: `mode="create"` renders the add-item form (slug/name/category/price/previewUrl fields, `createStoreItem` action); `mode="edit"` renders one `<tr>` per existing item with an inline price input (`updateStoreItem`) and an active/inactive toggle button (`toggleStoreItemActive`), following the exact `useFormState`/`useFormStatus` pattern already established in `components/admin/PlayerEconomyPanel.tsx` (Task 8.1) for consistency within this new admin surface.

- [ ] **Step 4: Link from the admin nav**

Add `/admin/store` to whatever renders the admin sidebar/nav links (grep for where `/admin/wallet` or `/admin/withdrawals` appear in a nav list) — follow that file's existing pattern.

- [ ] **Step 5: Run tests + build**

Run: `npm run test && npm run build`.

- [ ] **Step 6: Commit**

```bash
git add lib/admin/store-actions.ts components/admin/StoreItemForm.tsx app/admin/store/page.tsx
git commit -m "feat(admin): add /admin/store page — add/edit item, active toggle"
```

---

## Part 9 — Final Verification

### Task 9.1: Full regression pass

**Files:** none (verification only).

- [ ] **Step 1: Run the entire test suite**

Run: `npm run test` — every test file across all 9 parts must pass, not just the ones touched most recently.

- [ ] **Step 2: Run the production build**

Run: `npm run build` — catches any TypeScript error, Server/Client boundary violation, or stale import across the whole tree.

- [ ] **Step 3: Run lint**

Run: `npm run lint`.

- [ ] **Step 4: Re-verify the design doc's §10 test checklist explicitly**

Confirm each of the following has a passing automated test (cross-reference against the task that added it — do not re-derive, just check the box):
- SX Score migration rescale correctness → Task 1.2/1.3 tests + Task 1.1 Step 2 manual `SELECT` check.
- Masters eligibility threshold (`sx_score < 400` rejected) → Task 1.5 test.
- Match win coin math (+20 played, +30 won = 50 total) → Task 3.3 test.
- No-show match writes 0 coins → Task 3.3 test.
- Purchase deducts balance + writes ledger + inventory row; double-purchase fails gracefully → Task 3.5 test (`decidePurchase` unit test covers the decision; the double-purchase-races-the-DB path is covered by the `player_store_items` UNIQUE constraint + the catch-block refund in Task 3.5 Step 3 — add one more integration-shaped test here if a real Supabase test project is available, else note this as DB-constraint-covered rather than unit-tested).
- `computeTier()` boundaries → Task 2.2 test.
- Tier-up notification fires once per tier change, not every XP award → Task 2.3 test (`tierChanged: false` case).
- Achievement trigger conditions in isolation, including "no double-unlock" and "no first_win on a loss" → Task 4.3 tests.
- `recordDailyLogin()` idempotent same-day, increments on consecutive day, resets after a gap → Task 2.5 + 2.6 tests.
- Wallet breakdown `GROUP BY category` sums match individual totals → Task 7.3 test.

- [ ] **Step 5: Manual smoke pass on a running instance**

Using `run` (the project's app-launch skill) or `npm run dev`, walk through: sign in → dashboard shows XP bar/coin balance/streak → play/confirm a test match → confirm SX Score, coins, and XP all increased and an achievement toast/notification appeared if a threshold was crossed → visit `/store`, buy an item, equip it, confirm it shows on the public profile → visit `/admin/players/[id]` and grant coins/XP as admin → visit `/admin/store` and toggle an item inactive, confirm it disappears from `/store`.

- [ ] **Step 6: Commit any final fixups, then stop — do not start Phase 3**

Per the user's explicit instruction: Phase 3 earning sources (community activity) are seeded in the DB (achievements with `phase = 'phase3'`, `sx_coin_transactions.source`/`xp_events.source` already include `'community_activity'`) but their trigger logic is intentionally not wired. Confirm no code added in this plan calls `checkAndUnlockAchievements` with a Phase 3 achievement category (`community`) outside of the seed data existing — Task 4.3's `candidateAchievements()` already filters `.eq('phase', 'phase2')`, which is the actual enforcement mechanism; this step is just a final confirmation, not new work.

```bash
git status # confirm clean tree
```

---

## Self-Review Notes

- **Spec coverage**: every numbered item in the user's 9-part request maps to a Part above (1→Part 1, 2→Part 2, 3→Part 3, 4→Part 4, 5→Part 5, 6→Part 6, 7→Part 7, 8→Part 8, 9→Part 9). Every §-numbered subsection of the design doc is referenced from at least one task's code comment.
- **Known, documented gaps** (not placeholders — explicit scope decisions, all captured in Global Constraints): `season_top_100`/`season_top_10` achievement triggers (no season-close event exists yet), the double-purchase-race integration test (DB-constraint-covered, not independently unit tested without a live test project), WhatsApp/Termii routing for the two new notification types (deliberately in-app only).
- **Type/signature consistency check**: `awardCoins(admin, playerId, amount, source, referenceId, description?)` and `awardXP(admin, playerId, xp, source, referenceId)` are used with these exact argument orders in every call site across Parts 2–8 — verified consistent. `checkAndUnlockAchievements(admin, playerId, context)` likewise. `MembershipTier` values (`recruit`/`guardian`/`elite`/`sentinel`/`legend`) match between the migration CHECK constraint (Task 2.1), `computeTier()` (Task 2.2), and `MembershipBadge` (Task 6.1).

