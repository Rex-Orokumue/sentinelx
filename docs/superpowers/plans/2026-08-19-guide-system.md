# Guide System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the site-wide interactive guide system — a `GuideLauncher` floating button that opens a `GuidePanel` (a 4-slide pitch for anonymous visitors, a 3-step quest checklist for logged-in players), backed by a reusable `Spotlight` overlay and a new claimable `battle_ready` achievement — replacing the existing 4-page `SentinelBubble`.

**Architecture:** One new `components/guide/` component set (`GuideLauncher` → `GuidePanel` → `Spotlight`) mounted once in `app/layout.tsx`, sibling to `SiteHeader`/`SiteFooter`, fed by the `navSession` the root layout already computes (no new layout-level query). Quest progress is derived server-side by a pure function (`lib/guide/quest-status.ts`) fed by two Server Actions in `lib/guide/actions.ts` — `getQuestStatus()` (lazy fetch on panel open) and `claimBattleReadyBadge()` (re-verifies server-side, reuses the same four reward primitives `lib/achievements/unlock.ts` already calls). `SentinelBubble` is deleted outright, not left running alongside.

**Tech Stack:** Next.js 14 App Router (Server Components + Server Actions), Supabase (Postgres + RLS + service-role admin client), TypeScript, Tailwind, vitest.

**Spec:** `docs/superpowers/specs/2026-08-18-guide-system-design.md` — this plan implements the whole spec (Architecture, all 3 components, quest-status data, the reward, visual/gamey treatment, error handling). Read both together; every deviation from the spec's literal text is called out inline below with the reason.

## Global Constraints

- **Name collision fix (deviation from spec):** the spec names the new achievement "Ready to Compete" without noticing that name is already taken by the existing `profile_complete` achievement (`053_achievements.sql:71`) — reusing it would put two identically-named achievements on the same profile grid. This plan uses **slug `battle_ready`, name "Battle Ready"** instead. Confirmed with a full read of `achievements` seed data before writing the migration.
- **Route deviation (deviation from spec):** the spec sends quest step 3 ("Complete your first match") to `/dashboard`. Investigation found fixtures now live at `/dashboard/matches` (the dashboard-overhaul restructure moved them off the root dashboard page — `app/dashboard/matches/page.tsx`). This plan links to `/dashboard/matches`, the real current location.
- No new query added to `app/layout.tsx`'s per-request fetch — `GuideLauncher` receives `isLoggedIn`/`username`/`avatarUrl` from the `navSession` the layout already computes (`lib/nav/session.ts`).
- Quest-status Supabase reads happen lazily inside a Server Action (`lib/guide/actions.ts`), called directly from the client `GuidePanel` when it opens for a logged-in visitor — not on every page load.
- All coin/XP ledger writes go through the existing primitives — `awardXP()` (`lib/membership/xp.ts`), `recordCoinTransaction()` (`lib/coins/service.ts`) — never a hand-rolled `profiles.xp`/`sx_coins` write.
- The claim action must re-verify `computeQuestStatus(...).allComplete` server-side — never trust client state (a stale second tab could call claim after the client thinks all 3 steps are done but the DB disagrees).
- `player_achievements` has `UNIQUE(player_id, achievement_id)` — a duplicate insert (double-click, two tabs) must be treated as "already claimed", not surfaced as an error.
- Apply the migration via the Supabase MCP tool (`mcp__claude_ai_Supabase__apply_migration`, project id `itxubrkbropttfdackmi`) — the CLI has a known intermittent Windows TLS connectivity gap (see project memory). Regenerate `lib/supabase/types.ts` via `mcp__claude_ai_Supabase__generate_typescript_types` in the same task and commit the diff.
- Mobile-first, Server Components by default, `'use client'` only where interactivity is needed (CLAUDE.md rules #1, #8).
- This codebase's vitest config has no jsdom (see `vitest.config.ts`) — no DOM/component tests. Components are verified via `npx tsc --noEmit -p .`, `npm run build`, and a manual responsive pass, matching every prior plan's convention in this repo.

---

### Task 1: `lib/guide/quest-status.ts` — pure quest-status logic

**Files:**
- Create: `lib/guide/quest-status.ts`
- Test: `lib/guide/quest-status.test.ts`

**Interfaces:**
- Produces: `QuestStatusInput` (`{ hasUsername: boolean; hasAvatar: boolean; hasPaidRegistration: boolean; totalMatches: number }`), `QuestStatus` (`{ profileComplete: boolean; firstTournamentEntered: boolean; firstMatchCompleted: boolean; allComplete: boolean }`), `computeQuestStatus(input: QuestStatusInput): QuestStatus` — Task 3 (`lib/guide/actions.ts`) and Task 7 (`GuidePanel`) both import these.

- [ ] **Step 1: Write the failing test**

```ts
// lib/guide/quest-status.test.ts
import { describe, it, expect } from 'vitest'
import { computeQuestStatus } from './quest-status'

describe('computeQuestStatus', () => {
  it('is all-false for a brand new player', () => {
    const status = computeQuestStatus({ hasUsername: false, hasAvatar: false, hasPaidRegistration: false, totalMatches: 0 })
    expect(status).toEqual({
      profileComplete: false,
      firstTournamentEntered: false,
      firstMatchCompleted: false,
      allComplete: false,
    })
  })

  it('profileComplete requires both username and avatar', () => {
    expect(computeQuestStatus({ hasUsername: true, hasAvatar: false, hasPaidRegistration: false, totalMatches: 0 }).profileComplete).toBe(false)
    expect(computeQuestStatus({ hasUsername: false, hasAvatar: true, hasPaidRegistration: false, totalMatches: 0 }).profileComplete).toBe(false)
    expect(computeQuestStatus({ hasUsername: true, hasAvatar: true, hasPaidRegistration: false, totalMatches: 0 }).profileComplete).toBe(true)
  })

  it('firstTournamentEntered mirrors hasPaidRegistration', () => {
    expect(computeQuestStatus({ hasUsername: false, hasAvatar: false, hasPaidRegistration: true, totalMatches: 0 }).firstTournamentEntered).toBe(true)
    expect(computeQuestStatus({ hasUsername: false, hasAvatar: false, hasPaidRegistration: false, totalMatches: 0 }).firstTournamentEntered).toBe(false)
  })

  it('firstMatchCompleted is true once totalMatches is at least 1', () => {
    expect(computeQuestStatus({ hasUsername: false, hasAvatar: false, hasPaidRegistration: false, totalMatches: 0 }).firstMatchCompleted).toBe(false)
    expect(computeQuestStatus({ hasUsername: false, hasAvatar: false, hasPaidRegistration: false, totalMatches: 1 }).firstMatchCompleted).toBe(true)
    expect(computeQuestStatus({ hasUsername: false, hasAvatar: false, hasPaidRegistration: false, totalMatches: 5 }).firstMatchCompleted).toBe(true)
  })

  it('allComplete is true only when all three steps are done', () => {
    const status = computeQuestStatus({ hasUsername: true, hasAvatar: true, hasPaidRegistration: true, totalMatches: 1 })
    expect(status.allComplete).toBe(true)
  })

  it('allComplete is false if any single step is missing', () => {
    expect(computeQuestStatus({ hasUsername: false, hasAvatar: true, hasPaidRegistration: true, totalMatches: 1 }).allComplete).toBe(false)
    expect(computeQuestStatus({ hasUsername: true, hasAvatar: true, hasPaidRegistration: false, totalMatches: 1 }).allComplete).toBe(false)
    expect(computeQuestStatus({ hasUsername: true, hasAvatar: true, hasPaidRegistration: true, totalMatches: 0 }).allComplete).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/guide/quest-status.test.ts`
Expected: FAIL — `Cannot find module './quest-status'`

- [ ] **Step 3: Write the implementation**

```ts
// lib/guide/quest-status.ts
// Pure derivation of onboarding-quest progress. Kept side-effect-free so it
// is directly unit-testable without mocking Supabase — the caller
// (lib/guide/actions.ts) does the DB reads and passes in plain booleans/a
// count. See docs/superpowers/specs/2026-08-18-guide-system-design.md
// "Data: quest-status computation" for why this is 3 steps, not 4 —
// `profiles.total_matches` only increments after admin confirmation, so
// "played" and "submitted its result" are the same observable signal.
export interface QuestStatusInput {
  hasUsername: boolean
  hasAvatar: boolean
  hasPaidRegistration: boolean
  totalMatches: number
}

export interface QuestStatus {
  profileComplete: boolean
  firstTournamentEntered: boolean
  firstMatchCompleted: boolean
  allComplete: boolean
}

export function computeQuestStatus(input: QuestStatusInput): QuestStatus {
  const profileComplete = input.hasUsername && input.hasAvatar
  const firstTournamentEntered = input.hasPaidRegistration
  const firstMatchCompleted = input.totalMatches >= 1
  return {
    profileComplete,
    firstTournamentEntered,
    firstMatchCompleted,
    allComplete: profileComplete && firstTournamentEntered && firstMatchCompleted,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/guide/quest-status.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/guide/quest-status.ts lib/guide/quest-status.test.ts
git commit -m "feat(guide): add pure quest-status computation"
```

---

### Task 2: Migration 069 — `battle_ready` achievement

**Files:**
- Create: `supabase/migrations/069_guide_system.sql`
- Modify: `lib/supabase/types.ts` (regenerated, not hand-edited)

**Interfaces:**
- Produces: an `achievements` row with `slug = 'battle_ready'` that Task 3's `claimBattleReadyBadge()` looks up by slug.

- [ ] **Step 1: Write the migration**

```sql
-- 069_guide_system.sql
-- Guide System — Reward: one new onboarding achievement, explicitly claimed
-- via lib/guide/actions.ts (not the automatic checkAndUnlockAchievements()
-- pipeline — this checklist spans profile/registrations/matches at once,
-- three unrelated domains that pipeline evaluates one category at a time).
-- See docs/superpowers/specs/2026-08-18-guide-system-design.md "Reward".
--
-- Deviation from the spec's literal text: the spec calls this achievement
-- "Ready to Compete", not noticing that name already belongs to the
-- existing 'profile_complete' achievement (053_achievements.sql:71) —
-- reusing it would show two identically-named achievements on one profile
-- grid. Renamed here to "Battle Ready" / slug battle_ready.
--
-- category='profile' and phase='phase3' are both already-valid CHECK
-- values (053_achievements.sql, 063_referral_coin_economy.sql) — no ALTER
-- needed. sort_order continues after the highest existing value (35, set
-- by 063's referral milestones).
INSERT INTO public.achievements (slug, name, description, icon_url, category, xp_reward, coin_reward, phase, sort_order)
VALUES (
  'battle_ready',
  'Battle Ready',
  'Complete your profile, enter a tournament, and finish your first match',
  '🧭',
  'profile',
  100,
  50,
  'phase3',
  36
)
ON CONFLICT (slug) DO NOTHING;
```

- [ ] **Step 2: Apply the migration**

Run via the `mcp__claude_ai_Supabase__apply_migration` MCP tool (project id `itxubrkbropttfdackmi`), name `guide_system`, passing the SQL above.
Expected: success, no errors (the `slug` UNIQUE constraint + `ON CONFLICT` make this idempotent if re-run).

- [ ] **Step 3: Verify the row live**

Run via `mcp__claude_ai_Supabase__execute_sql`: `select slug, name, xp_reward, coin_reward from achievements where slug = 'battle_ready';`
Expected: one row — `battle_ready | Battle Ready | 100 | 50`.

- [ ] **Step 4: Regenerate types**

Run via `mcp__claude_ai_Supabase__generate_typescript_types` (project id `itxubrkbropttfdackmi`), write the result to `lib/supabase/types.ts`.
Expected: file updates cleanly (this migration adds a row, not a column — the diff should be empty or near-empty; confirm no unrelated schema drift snuck in).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/069_guide_system.sql lib/supabase/types.ts
git commit -m "feat(guide): add battle_ready achievement migration"
```

---

### Task 3: `lib/guide/actions.ts` — quest-status fetch + claim Server Actions

**Files:**
- Create: `lib/guide/actions.ts`

**Interfaces:**
- Consumes: `computeQuestStatus`, `QuestStatus` (Task 1); `createClient` (`@/lib/supabase/server`); `createAdminClient` (`@/lib/supabase/admin`); `awardXP` (`@/lib/membership/xp`, signature `(admin, playerId, xp, source, referenceId)`); `recordCoinTransaction` (`@/lib/coins/service`, signature `(admin, playerId, amount, source, referenceId, description?)`); `notifyInApp` (`@/lib/notifications/inbox`, signature `({playerId, type, title, body, link?})`); `pushToPlayer` (`@/lib/notifications/push`, signature `(playerId, type, {title, body}, dataRecord)`); the `battle_ready` achievement row (Task 2).
- Produces: `getQuestStatus(): Promise<{ ok: true; status: QuestStatus; alreadyClaimed: boolean } | { ok: false; error: string }>`, `claimBattleReadyBadge(): Promise<{ ok: true } | { ok: false; error: string }>` — both consumed directly (called as plain async functions, not via `<form action>`) by Task 7's `GuidePanel`, matching the existing `createPost()` pattern in `lib/community/post-actions.ts:13`.

- [ ] **Step 1: Write the implementation**

No dedicated test file for this task — it's a Server Action that only does real Supabase reads/writes, no pure logic beyond what Task 1 already tests. This matches the codebase's established convention (`checkAndUnlockAchievements()`'s own call sites have no direct unit tests either — verified end-to-end). Verified manually in Step 2.

```ts
// lib/guide/actions.ts
'use server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { awardXP } from '@/lib/membership/xp'
import { recordCoinTransaction } from '@/lib/coins/service'
import { notifyInApp } from '@/lib/notifications/inbox'
import { pushToPlayer } from '@/lib/notifications/push'
import { computeQuestStatus, type QuestStatus } from './quest-status'

type Admin = ReturnType<typeof createAdminClient>

const BATTLE_READY_SLUG = 'battle_ready'

// Shared by both actions below — one Supabase round-trip shape, one place
// that knows which columns/tables back each quest step.
async function fetchStatus(admin: Admin, playerId: string): Promise<QuestStatus> {
  const [{ data: profile }, { count: registrationCount }] = await Promise.all([
    admin.from('profiles').select('username, avatar_url, total_matches').eq('id', playerId).maybeSingle(),
    admin
      .from('tournament_registrations')
      .select('id', { count: 'exact', head: true })
      .eq('player_id', playerId)
      .eq('payment_status', 'paid'),
  ])
  return computeQuestStatus({
    hasUsername: !!profile?.username,
    hasAvatar: !!profile?.avatar_url,
    hasPaidRegistration: (registrationCount ?? 0) > 0,
    totalMatches: profile?.total_matches ?? 0,
  })
}

export async function getQuestStatus(): Promise<
  { ok: true; status: QuestStatus; alreadyClaimed: boolean } | { ok: false; error: string }
> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Please log in.' }

  const admin = createAdminClient()
  const status = await fetchStatus(admin, user.id)

  const { data: achievement } = await admin.from('achievements').select('id').eq('slug', BATTLE_READY_SLUG).maybeSingle()
  let alreadyClaimed = false
  if (achievement) {
    const { data: unlocked } = await admin
      .from('player_achievements')
      .select('id')
      .eq('player_id', user.id)
      .eq('achievement_id', achievement.id)
      .maybeSingle()
    alreadyClaimed = !!unlocked
  }

  return { ok: true, status, alreadyClaimed }
}

export async function claimBattleReadyBadge(): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Please log in.' }

  const admin = createAdminClient()
  // Re-verify server-side — never trust the client's cached quest state
  // (Global Constraints: a stale second tab could call claim early).
  const status = await fetchStatus(admin, user.id)
  if (!status.allComplete) return { ok: false, error: 'Complete all 3 quest steps first.' }

  const { data: achievement } = await admin
    .from('achievements')
    .select('id, name, xp_reward, coin_reward')
    .eq('slug', BATTLE_READY_SLUG)
    .maybeSingle()
  if (!achievement) return { ok: false, error: 'Reward unavailable right now.' }

  const { error: insertErr } = await admin
    .from('player_achievements')
    .insert({ player_id: user.id, achievement_id: achievement.id })
  if (insertErr) {
    // UNIQUE(player_id, achievement_id) — already claimed (double-click or
    // another tab beat this call). Not a failure from the caller's
    // perspective; they already hold the badge. Mirrors unlock()'s own
    // race handling in lib/achievements/unlock.ts.
    return { ok: true }
  }

  await awardXP(admin, user.id, achievement.xp_reward, 'achievement_unlocked', achievement.id)
  await recordCoinTransaction(admin, user.id, achievement.coin_reward, 'achievement_unlocked', achievement.id)
  await notifyInApp({
    playerId: user.id,
    type: 'achievement_unlocked',
    title: 'Achievement unlocked!',
    body: `${achievement.name} — +${achievement.xp_reward} XP, +${achievement.coin_reward} SX Coins.`,
    link: '/dashboard',
  })
  void pushToPlayer(
    user.id,
    'achievement_unlocked',
    { title: 'Achievement unlocked!', body: `${achievement.name} — +${achievement.xp_reward} XP, +${achievement.coin_reward} SX Coins.` },
    { url: '/dashboard' },
  )

  return { ok: true }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors (confirms `achievement_unlocked` is a valid member of both `NotificationType` and `PushNotificationType`, and that every primitive signature above matches the real ones in `lib/membership/xp.ts` / `lib/coins/service.ts` / `lib/notifications/{inbox,push}.ts`).

- [ ] **Step 3: Commit**

```bash
git add lib/guide/actions.ts
git commit -m "feat(guide): add getQuestStatus/claimBattleReadyBadge server actions"
```

---

### Task 4: Export shared onboarding copy from `FourPillars`/`HowItWorks`

**Files:**
- Modify: `components/home/FourPillars.tsx`
- Modify: `components/home/HowItWorks.tsx`

**Interfaces:**
- Produces: `export const PILLARS` (from `FourPillars.tsx`, shape `{ emoji, accent, name, body, href }[]`), `export const STEPS` (from `HowItWorks.tsx`, shape `{ num, icon, title, body }[]`) — Task 7's `GuidePanel` visitor-tour slides 2 and 3 import these directly, per the spec's "reusing the copy already established... rather than writing new copy" (spec §GuidePanel, Anonymous — Visitor Tour, slides 2–3).

- [ ] **Step 1: Export `PILLARS`**

```ts
// components/home/FourPillars.tsx — change the existing declaration:
const PILLARS = [
```
to:
```ts
// components/home/FourPillars.tsx
// Exported so the Guide System's visitor tour (components/guide/GuidePanel.tsx)
// can render the same four pillars without re-authoring the copy.
export const PILLARS = [
```

- [ ] **Step 2: Export `STEPS`**

```ts
// components/home/HowItWorks.tsx — change the existing declaration:
const STEPS = [
```
to:
```ts
// components/home/HowItWorks.tsx
// Exported so the Guide System's visitor tour (components/guide/GuidePanel.tsx)
// can render a condensed version without re-authoring the copy.
export const STEPS = [
```

- [ ] **Step 3: Typecheck and build**

Run: `npx tsc --noEmit -p . && npm run build`
Expected: no errors — both exports are additive (the `as const` arrays keep their existing local usage in `FourPillars`/`HowItWorks` unchanged).

- [ ] **Step 4: Commit**

```bash
git add components/home/FourPillars.tsx components/home/HowItWorks.tsx
git commit -m "feat(guide): export PILLARS/STEPS for reuse in the visitor tour"
```

---

### Task 5: `components/guide/Spotlight.tsx` — reusable contextual overlay

**Files:**
- Create: `components/guide/Spotlight.tsx`

**Interfaces:**
- Consumes: nothing beyond React/`react-dom`'s `createPortal` (already used in `components/shared/NotificationDrawer.tsx` for the same "portal to `document.body`, dim + backdrop" shape).
- Produces: `Spotlight({ targetId, title, body, onDismiss }: { targetId: string; title: string; body: string; onDismiss: () => void })` — Task 7's `GuidePanel` renders this when a quest step's target element is present on the current page.

- [ ] **Step 1: Write the implementation**

```tsx
// components/guide/Spotlight.tsx
'use client'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Image from 'next/image'

// Dim-overlay + cutout-highlight + mascot callout, positioned via
// getBoundingClientRect() on a target element already present in the DOM.
// Same-page only (spec §Spotlight) — the caller (GuidePanel) only renders
// this when document.getElementById(targetId) already exists; if the
// element genuinely isn't there when this mounts, dismiss immediately
// rather than showing a broken/blank overlay.
export function Spotlight({
  targetId,
  title,
  body,
  onDismiss,
}: {
  targetId: string
  title: string
  body: string
  onDismiss: () => void
}) {
  const [rect, setRect] = useState<DOMRect | null>(null)

  useEffect(() => {
    const el = document.getElementById(targetId)
    if (!el) {
      onDismiss()
      return
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    function measure() {
      setRect(el!.getBoundingClientRect())
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onDismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDismiss])

  if (!rect) return null

  const calloutTop = Math.min(rect.bottom + 16, window.innerHeight - 180)
  const calloutLeft = Math.max(16, Math.min(rect.left, window.innerWidth - 304))

  return createPortal(
    <div className="fixed inset-0 z-[70]" onClick={onDismiss}>
      {/* The cutout: a transparent box whose huge box-shadow dims everything
          else on the page in one element, instead of a separate overlay +
          clip-path. Same purple glow as the rest of the Phase 1 system. */}
      <div
        className="absolute rounded-xl ring-4 ring-sx-purple"
        style={{
          top: rect.top - 8,
          left: rect.left - 8,
          width: rect.width + 16,
          height: rect.height + 16,
          boxShadow: '0 0 0 9999px rgba(0,0,0,0.75), 0 0 24px rgba(124,58,237,0.5)',
        }}
        onClick={(e) => e.stopPropagation()}
      />
      <div
        className="absolute w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-sx-purple/40 bg-sx-surface p-4 shadow-[0_0_20px_rgba(124,58,237,0.3)]"
        style={{ top: calloutTop, left: calloutLeft }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center gap-2">
          <div className="relative h-7 w-7 shrink-0 overflow-hidden rounded-full border-2 border-sx-purple/50 bg-sx-bg">
            <Image src="/mascot/mascot-bubble.png" alt="Sentinel" fill sizes="28px" className="object-cover object-top" />
          </div>
          <p className="text-sm font-bold text-white">{title}</p>
        </div>
        <p className="mb-3 text-xs leading-snug text-sx-gray">{body}</p>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-lg bg-sx-purple px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-sx-purple-light"
        >
          Got it
        </button>
      </div>
    </div>,
    document.body,
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/guide/Spotlight.tsx
git commit -m "feat(guide): add reusable Spotlight overlay"
```

---

### Task 6: Add spotlight target ids to the 3 real pages

**Files:**
- Modify: `app/dashboard/settings/page.tsx`
- Modify: `app/(public)/tournaments/page.tsx`
- Modify: `app/dashboard/matches/page.tsx`

**Interfaces:**
- Produces: three stable DOM anchors — `#guide-target-profile`, `#guide-target-tournaments`, `#guide-target-matches` — that Task 7's `GuidePanel` looks up via `document.getElementById` to decide "Show me" (Spotlight) vs "Take me there" (plain link) per quest step.

- [ ] **Step 1: Mark the profile form**

In `app/dashboard/settings/page.tsx`, wrap the existing `<ProfileForm .../>` call:

```tsx
        <ProfileForm
```
becomes:
```tsx
        <div id="guide-target-profile">
        <ProfileForm
```
and its closing `/>` gains a matching `</div>` immediately after.

- [ ] **Step 2: Mark the tournaments list column**

In `app/(public)/tournaments/page.tsx`, the left-column wrapper:

```tsx
        {/* ── Left column ───────────────────────────────────── */}
        <div className="min-w-0 lg:order-first">
```
becomes:
```tsx
        {/* ── Left column ───────────────────────────────────── */}
        <div id="guide-target-tournaments" className="min-w-0 lg:order-first">
```

- [ ] **Step 3: Mark the active-fixtures section**

In `app/dashboard/matches/page.tsx`, the "Active" section:

```tsx
      <section>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-sx-gray">Active</h2>
```
becomes:
```tsx
      <section id="guide-target-matches">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-sx-gray">Active</h2>
```

- [ ] **Step 4: Typecheck and build**

Run: `npx tsc --noEmit -p . && npm run build`
Expected: no errors — these are additive `id` attributes on existing elements, no logic change.

- [ ] **Step 5: Commit**

```bash
git add "app/dashboard/settings/page.tsx" "app/(public)/tournaments/page.tsx" "app/dashboard/matches/page.tsx"
git commit -m "feat(guide): add spotlight target ids to profile/tournaments/matches pages"
```

---

### Task 7: `components/guide/GuidePanel.tsx` — visitor tour + quest checklist

**Files:**
- Create: `components/guide/GuidePanel.tsx`

**Interfaces:**
- Consumes: `PILLARS`, `STEPS` (Task 4); `getQuestStatus`, `claimBattleReadyBadge` (Task 3); `QuestStatus` (Task 1); `Spotlight` (Task 5); target ids `guide-target-profile`/`guide-target-tournaments`/`guide-target-matches` (Task 6); `Avatar` (`@/components/shared/Avatar`, props `{avatarUrl, displayName, username, size, className?}`).
- Produces: `GuidePanel({ isLoggedIn, username, avatarUrl, onClose }: { isLoggedIn: boolean; username: string | null; avatarUrl: string | null; onClose: () => void })` — Task 8's `GuideLauncher` renders this when open.

- [ ] **Step 1: Write the implementation**

No dedicated test file (client component, no jsdom in this repo's vitest config — Global Constraints). Verified via typecheck/build + the manual pass in Task 9's Step 4.

```tsx
// components/guide/GuidePanel.tsx
'use client'
import { useEffect, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import { Avatar } from '@/components/shared/Avatar'
import { PILLARS } from '@/components/home/FourPillars'
import { STEPS } from '@/components/home/HowItWorks'
import { getQuestStatus, claimBattleReadyBadge } from '@/lib/guide/actions'
import type { QuestStatus } from '@/lib/guide/quest-status'
import { Spotlight } from './Spotlight'

type QuestKey = 'profileComplete' | 'firstTournamentEntered' | 'firstMatchCompleted'

const QUEST_STEPS: Array<{ key: QuestKey; label: string; href: string; targetId: string; spotlightBody: string }> = [
  {
    key: 'profileComplete',
    label: 'Complete your profile',
    href: '/dashboard/settings',
    targetId: 'guide-target-profile',
    spotlightBody: 'Set your username and avatar right here.',
  },
  {
    key: 'firstTournamentEntered',
    label: 'Enter your first tournament',
    href: '/tournaments',
    targetId: 'guide-target-tournaments',
    spotlightBody: 'Pick any open tournament below and register to compete.',
  },
  {
    key: 'firstMatchCompleted',
    label: 'Complete your first match',
    href: '/dashboard/matches',
    targetId: 'guide-target-matches',
    spotlightBody: 'Your active fixtures show up here once you register.',
  },
]

export function GuidePanel({
  isLoggedIn,
  username,
  avatarUrl,
  onClose,
}: {
  isLoggedIn: boolean
  username: string | null
  avatarUrl: string | null
  onClose: () => void
}) {
  const router = useRouter()
  const [visitorSlide, setVisitorSlide] = useState(0)
  const [status, setStatus] = useState<QuestStatus | null>(null)
  const [alreadyClaimed, setAlreadyClaimed] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [claimError, setClaimError] = useState<string | null>(null)
  const [spotlightStep, setSpotlightStep] = useState<(typeof QUEST_STEPS)[number] | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (!isLoggedIn) return
    let cancelled = false
    getQuestStatus().then((res) => {
      if (cancelled) return
      if (!res.ok) {
        setLoadError(true)
        return
      }
      setStatus(res.status)
      setAlreadyClaimed(res.alreadyClaimed)
    })
    return () => {
      cancelled = true
    }
  }, [isLoggedIn])

  function handleClaim() {
    startTransition(async () => {
      const res = await claimBattleReadyBadge()
      if (!res.ok) {
        setClaimError(res.error)
        return
      }
      setAlreadyClaimed(true)
      router.refresh()
    })
  }

  function targetOnPage(targetId: string): boolean {
    return typeof document !== 'undefined' && !!document.getElementById(targetId)
  }

  const doneCount = status
    ? [status.profileComplete, status.firstTournamentEntered, status.firstMatchCompleted].filter(Boolean).length
    : 0

  const panel = (
    <div className="fixed inset-0 z-[60]">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="absolute bottom-0 right-0 flex max-h-[85vh] w-full flex-col overflow-y-auto rounded-t-2xl border-t border-sx-purple/30 bg-sx-bg shadow-2xl sm:bottom-6 sm:right-6 sm:max-h-[70vh] sm:w-96 sm:rounded-2xl sm:border">
        <div className="flex items-center justify-between border-b border-sx-border px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full border-2 border-sx-purple/50 bg-sx-bg">
              <Image src="/mascot/mascot-bubble.png" alt="Sentinel" fill sizes="32px" className="object-cover object-top" />
            </div>
            <p className="text-sm font-bold text-white">Sentinel Guide</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close guide"
            className="text-slate-400 transition-colors hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 p-4">
          {!isLoggedIn ? (
            <VisitorTour
              slide={visitorSlide}
              onNext={() => setVisitorSlide((s) => Math.min(3, s + 1))}
              onBack={() => setVisitorSlide((s) => Math.max(0, s - 1))}
            />
          ) : loadError ? (
            <p className="py-8 text-center text-sm text-sx-gray">Couldn&apos;t load your progress. Try again shortly.</p>
          ) : !status ? (
            <p className="py-8 text-center text-sm text-sx-gray">Loading your quest…</p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2.5">
                <Avatar avatarUrl={avatarUrl} displayName={null} username={username} size={32} />
                <p className="text-sm font-bold text-white">Hey {username ?? 'Gamer'}! 👋</p>
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="font-bold uppercase text-white">Battle Ready Quest</span>
                  <span className="text-sx-gray">{doneCount}/3</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full rounded-full bg-sx-purple transition-all"
                    style={{ width: `${(doneCount / 3) * 100}%` }}
                  />
                </div>
              </div>

              <ul className="space-y-2">
                {QUEST_STEPS.map((step) => {
                  const done = status[step.key]
                  return (
                    <li
                      key={step.key}
                      className="flex items-center justify-between gap-3 rounded-xl border border-sx-border bg-sx-surface p-3"
                    >
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                            done ? 'bg-sx-green text-white' : 'bg-slate-700 text-sx-gray'
                          }`}
                        >
                          {done ? '✓' : ''}
                        </span>
                        <span className={`text-sm ${done ? 'text-sx-gray line-through' : 'text-white'}`}>{step.label}</span>
                      </div>
                      {!done &&
                        (targetOnPage(step.targetId) ? (
                          <button
                            type="button"
                            onClick={() => setSpotlightStep(step)}
                            className="shrink-0 text-xs font-bold text-sx-purple-text hover:underline"
                          >
                            Show me
                          </button>
                        ) : (
                          <Link
                            href={step.href}
                            onClick={onClose}
                            className="shrink-0 text-xs font-bold text-sx-purple-text hover:underline"
                          >
                            Take me there
                          </Link>
                        ))}
                    </li>
                  )
                })}
              </ul>

              {status.allComplete &&
                (alreadyClaimed ? (
                  <p className="rounded-xl border border-sx-green/40 bg-sx-green/10 p-3 text-center text-sm font-bold text-sx-green">
                    Badge earned ✓
                  </p>
                ) : (
                  <div>
                    <button
                      type="button"
                      onClick={handleClaim}
                      disabled={pending}
                      className="w-full rounded-xl bg-sx-purple px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-sx-purple-light disabled:opacity-60"
                    >
                      {pending ? 'Claiming…' : '🏆 Claim Your Badge'}
                    </button>
                    {claimError && <p className="mt-2 text-xs text-red-400">{claimError}</p>}
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <>
      {createPortal(panel, document.body)}
      {spotlightStep && (
        <Spotlight
          targetId={spotlightStep.targetId}
          title={spotlightStep.label}
          body={spotlightStep.spotlightBody}
          onDismiss={() => setSpotlightStep(null)}
        />
      )}
    </>
  )
}

function VisitorTour({ slide, onNext, onBack }: { slide: number; onNext: () => void; onBack: () => void }) {
  return (
    <div className="flex min-h-[220px] flex-col">
      <div className="flex-1">
        {slide === 0 && (
          <div className="space-y-2 py-4 text-center">
            <p className="font-display text-xl font-black uppercase text-white">What is SentinelX?</p>
            <p className="text-sm leading-relaxed text-sx-gray">
              Nigeria&apos;s home of mobile esports — compete in tournaments, watch live finals, connect with the
              community, and trade gaming accounts safely, all in one place.
            </p>
          </div>
        )}
        {slide === 1 && (
          <div className="space-y-2 py-2">
            <p className="mb-2 text-center font-display text-lg font-black uppercase text-white">The Four Pillars</p>
            {PILLARS.map((p) => (
              <div key={p.name} className="flex items-center gap-2.5 rounded-lg border border-sx-border bg-sx-surface p-2.5">
                <span className="text-lg">{p.emoji}</span>
                <div>
                  <p className="text-sm font-bold text-white">{p.name}</p>
                  <p className="text-xs text-sx-gray">{p.body}</p>
                </div>
              </div>
            ))}
          </div>
        )}
        {slide === 2 && (
          <div className="space-y-1.5 py-2">
            <p className="mb-2 text-center font-display text-lg font-black uppercase text-white">How Tournaments Work</p>
            {STEPS.map((s) => (
              <div key={s.num} className="flex items-center gap-2.5 rounded-lg border border-sx-border bg-sx-surface p-2">
                <span className="text-base">{s.icon}</span>
                <p className="text-xs font-semibold text-white">{s.title}</p>
              </div>
            ))}
          </div>
        )}
        {slide === 3 && (
          <div className="space-y-3 py-6 text-center">
            <p className="font-display text-xl font-black uppercase text-white">Ready to Compete?</p>
            <p className="text-sm text-sx-gray">Create your free account and enter your first tournament today.</p>
            <Link
              href="/signup"
              className="inline-block rounded-lg bg-sx-purple px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-sx-purple-light"
            >
              Sign Up Free →
            </Link>
          </div>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-sx-border pt-3">
        <button type="button" onClick={onBack} disabled={slide === 0} className="text-xs font-bold text-sx-gray disabled:opacity-30">
          ← Back
        </button>
        <div className="flex gap-1">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={`h-1.5 w-1.5 rounded-full ${i === slide ? 'bg-sx-purple' : 'bg-slate-700'}`} />
          ))}
        </div>
        {slide < 3 ? (
          <button type="button" onClick={onNext} className="text-xs font-bold text-sx-purple-text">
            Next →
          </button>
        ) : (
          <span className="w-8" />
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors — confirms `status[step.key]` indexing (`QuestKey`) matches `QuestStatus`'s real field names, and `PILLARS`/`STEPS`'s exported shapes match what's destructured here (`p.emoji`/`p.name`/`p.body`, `s.num`/`s.icon`/`s.title`).

- [ ] **Step 3: Commit**

```bash
git add components/guide/GuidePanel.tsx
git commit -m "feat(guide): add GuidePanel (visitor tour + quest checklist)"
```

---

### Task 8: `components/guide/GuideLauncher.tsx` + mount in `app/layout.tsx`

**Files:**
- Create: `components/guide/GuideLauncher.tsx`
- Modify: `app/layout.tsx`

**Interfaces:**
- Consumes: `GuidePanel` (Task 7); `navSession.isLoggedIn`/`navSession.username`/`navSession.avatarUrl` (`lib/nav/session.ts`, already computed in `app/layout.tsx`).
- Produces: `GuideLauncher({ isLoggedIn, username, avatarUrl }: { isLoggedIn: boolean; username: string | null; avatarUrl: string | null })`, mounted once site-wide.

- [ ] **Step 1: Write the implementation**

```tsx
// components/guide/GuideLauncher.tsx
'use client'
import { useEffect, useState } from 'react'
import Image from 'next/image'
import { GuidePanel } from './GuidePanel'

const SEEN_KEY = 'sx-guide-seen'

// Site-wide floating launcher (spec §GuideLauncher) — replaces SentinelBubble
// outright (see Task 9). Mounted once in app/layout.tsx, sibling to
// SiteHeader/SiteFooter, so it survives client-side navigation without
// remounting.
export function GuideLauncher({
  isLoggedIn,
  username,
  avatarUrl,
}: {
  isLoggedIn: boolean
  username: string | null
  avatarUrl: string | null
}) {
  const [open, setOpen] = useState(false)
  // Defaults to "seen" so the pulse never flashes for one frame before the
  // localStorage check resolves — same guard SentinelBubble used for its
  // own dismiss flag.
  const [seen, setSeen] = useState(true)

  useEffect(() => {
    // Spec error-handling: localStorage unavailable (e.g. some private-
    // browsing modes throw on access, not just return null) must degrade
    // to "pulse always shows" — cosmetic only, never a functional break.
    try {
      setSeen(localStorage.getItem(SEEN_KEY) === '1')
    } catch {
      setSeen(false)
    }
  }, [])

  function toggle() {
    if (!seen) {
      try {
        localStorage.setItem(SEEN_KEY, '1')
      } catch {
        // Same degradation — dismiss still works for this session via
        // `setSeen(true)` below, it just won't persist across a reload.
      }
      setSeen(true)
    }
    setOpen((o) => !o)
  }

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        aria-label="Open Sentinel guide"
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full border-2 border-sx-purple/50 bg-sx-surface shadow-[0_0_20px_rgba(124,58,237,0.3)] transition-transform hover:scale-105"
      >
        <div className="relative h-10 w-10 overflow-hidden rounded-full">
          <Image
            src="/mascot/mascot-bubble.png"
            alt="Sentinel guide"
            fill
            sizes="40px"
            className={`object-cover object-top ${seen ? '' : 'animate-idle-pulse'}`}
          />
        </div>
      </button>
      {open && <GuidePanel isLoggedIn={isLoggedIn} username={username} avatarUrl={avatarUrl} onClose={() => setOpen(false)} />}
    </>
  )
}
```

- [ ] **Step 2: Mount it in `app/layout.tsx`**

```tsx
// app/layout.tsx — add the import alongside the existing shared-component imports:
import { ServiceWorkerRegistration } from '@/components/pwa/ServiceWorkerRegistration'
```
becomes:
```tsx
import { ServiceWorkerRegistration } from '@/components/pwa/ServiceWorkerRegistration'
import { GuideLauncher } from '@/components/guide/GuideLauncher'
```

```tsx
// app/layout.tsx — mount as a sibling of the header/main/footer flex column,
// same level as <Analytics />:
        <Analytics />
        <JsonLd data={buildOrganizationJsonLd()} />
        <JsonLd data={buildWebsiteJsonLd()} />
```
becomes:
```tsx
        <GuideLauncher isLoggedIn={navSession.isLoggedIn} username={navSession.username} avatarUrl={navSession.avatarUrl} />

        <Analytics />
        <JsonLd data={buildOrganizationJsonLd()} />
        <JsonLd data={buildWebsiteJsonLd()} />
```

- [ ] **Step 3: Typecheck and build**

Run: `npx tsc --noEmit -p . && npm run build`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/guide/GuideLauncher.tsx app/layout.tsx
git commit -m "feat(guide): add GuideLauncher, mount site-wide in layout"
```

---

### Task 9: Remove `SentinelBubble` (subsumed by `GuideLauncher`, not left running alongside)

**Files:**
- Modify: `app/page.tsx`
- Modify: `app/(public)/tournaments/page.tsx`
- Modify: `app/(public)/games/page.tsx`
- Modify: `app/(public)/rankings/page.tsx`
- Delete: `components/ui/SentinelBubble.tsx`

**Interfaces:**
- None — pure removal. `GuideLauncher` (Task 8) is already mounted site-wide by this point, so no page loses guidance.

- [ ] **Step 1: Remove from `app/page.tsx`**

Delete the import line:
```tsx
import { SentinelBubble } from '@/components/ui/SentinelBubble'
```
and the mount:
```tsx
      <SentinelBubble variant="home" />
```

- [ ] **Step 2: Remove from `app/(public)/tournaments/page.tsx`**

Delete the import line:
```tsx
import { SentinelBubble } from '@/components/ui/SentinelBubble'
```
and the mount:
```tsx
      <SentinelBubble variant="tournaments" />
```

- [ ] **Step 3: Remove from `app/(public)/games/page.tsx`**

Delete the import line:
```tsx
import { SentinelBubble } from '@/components/ui/SentinelBubble'
```
and the mount:
```tsx
      <SentinelBubble variant="games" />
```

- [ ] **Step 4: Remove from `app/(public)/rankings/page.tsx`**

Delete the import line:
```tsx
import { SentinelBubble } from '@/components/ui/SentinelBubble'
```
and the mount:
```tsx
      <SentinelBubble variant="leaderboards" />
```

- [ ] **Step 5: Delete the component file**

```bash
git rm components/ui/SentinelBubble.tsx
```

(Leave the two unrelated code comments that merely *reference* `SentinelBubble` as a prior-art pattern — `components/shared/MobileNavSheet.tsx:28` and `components/coins/CoinDisclaimerTooltip.tsx:6-7` — they're prose, not imports, and stay accurate as historical context after the file is gone.)

- [ ] **Step 6: Typecheck, lint, and build**

Run: `npx tsc --noEmit -p . && npm run lint && npm run build`
Expected: no errors, no unused-import warnings on any of the 4 modified pages.

- [ ] **Step 7: Commit**

```bash
git add "app/page.tsx" "app/(public)/tournaments/page.tsx" "app/(public)/games/page.tsx" "app/(public)/rankings/page.tsx"
git commit -m "feat(guide): remove SentinelBubble, subsumed by GuideLauncher"
```

---

### Task 10: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm run test`
Expected: all tests pass, including the 6 new `quest-status.test.ts` cases from Task 1.

- [ ] **Step 2: Typecheck, lint, build**

Run: `npx tsc --noEmit -p . && npm run lint && npm run build`
Expected: clean on all three.

- [ ] **Step 3: Manual responsive + flow pass**

At 375px, 768px, and 1280px widths, on the deployed/dev site:
- `GuideLauncher` button renders bottom-right on every page, pulses on first visit, stops pulsing after one open (persists across a reload).
- Logged-out: opening it shows the 4-slide visitor tour; Next/Back/dot-indicator all work; slide 2 shows the same 4 pillars as the homepage; slide 4's "Sign Up Free" link goes to `/signup`.
- Logged-in, quest incomplete: shows the 3-step checklist with the live 0–3 progress bar; on `/tournaments`, the "Enter your first tournament" row shows "Show me" (not "Take me there") and clicking it spotlights the tournament list; on any other page it shows "Take me there" instead. Same check on `/dashboard/settings` (profile) and `/dashboard/matches` (matches).
- Spotlight dismisses via the "Got it" button, clicking outside, and Escape.
- Logged-in, quest complete (test account with a completed profile + a paid registration + `total_matches >= 1`): "Claim Your Badge" appears; clicking it awards +100 XP / +50 SX Coins (confirm via the header's coin balance updating after `router.refresh()`), the button becomes "Badge earned ✓", and the `battle_ready` achievement now shows unlocked on `/players/[username]`.
- Clicking claim again (or opening the panel again) shows "Badge earned ✓" immediately, no duplicate award (check `sx_coin_transactions` — only one `achievement_unlocked` row with `reference_id` = the `battle_ready` achievement id for that player).
- `SentinelBubble` no longer appears anywhere (home, tournaments, games, rankings).

- [ ] **Step 4: Report**

Summarize: test count, lint/build status, and confirmation of each manual-pass item above (or note anything that couldn't be verified, e.g. if Chrome automation is unreliable on localhost per prior session notes — verify via the deployed URL instead in that case).
