# Player Profile & Settings — Gap-Fill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended for this plan) or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the already-built `/players/[username]` page and the not-yet-built `/dashboard/settings` page up to the approved Phase 3 profile/settings spec, without discarding the substantial profile-page implementation that already exists.

**Architecture:** This is a **gap-fill plan, not a rebuild**. Investigation found `app/(public)/players/[username]/page.tsx` already implements most of the spec (hero, stats, achievements trophy wall, match history, cosmetics, friend/challenge buttons, owner-only coin balance, JSON-LD SEO). Real gaps: no Season Rank anywhere, no XP/membership bar or Community Posts section on the profile, no owner-only "Edit Profile" button, the achievement query wrongly filters to `phase='phase2'` only (Phase 3 achievements never show), and locked achievements currently leak their name+description via a tooltip (the spec explicitly forbids that — "mystery = motivation"). `/dashboard/settings` doesn't exist at all; `/dashboard/profile` + `ProfileEditForm` is a thinner predecessor that this plan supersedes and redirects.

**Tech Stack:** Next.js 14 App Router Server Components, Supabase (Postgres + Storage + Auth), Tailwind, zod, vitest.

**Spec:** `docs/superpowers/specs/2026-08-16-player-profile-settings-design.md`

## Global Constraints

- Mobile-first: every new component must work at 375px width (CLAUDE.md rule 1).
- RLS: `profiles_own_update` (`USING (auth.uid() = id)`, migration 001) already covers writes to the two new columns — **no new RLS policy needed**, confirmed by inspection.
- `notification_prefs` JSONB merge on save: `profiles SET notification_prefs = notification_prefs || $patch::jsonb` — **never** overwrite the full object (preserves keys other specs may add later, e.g. the separate notification-center spec's `push` key, which is already baked into the migration's DEFAULT below so it round-trips even though this plan builds no push UI).
- **No toast library exists in this codebase** (confirmed: no `sonner`, no toast usage anywhere). Password-change and other confirmations use the codebase's existing inline `{state?.success && <p className="text-emerald-400">…</p>}` convention (see `ProfileEditForm.tsx`, `resetPassword`) — do not add a new dependency for this.
- **Country field stays free text**, matching every other country input in this codebase (registration `reg_*` fields, existing `ProfileEditForm`). No country-list module exists; inventing one is out of scope for this pass.
- Avatar upload reuses the **existing** `avatars` Storage bucket and client-side-direct-upload pattern from `ProfileEditForm.tsx` (bucket already has owner-scoped RLS from migration 018) — the spec's phrasing about reusing "the community post image pattern" is imprecise; the avatar-specific pattern is bucket-correct and is what this plan reuses, adding 400×400 WebP compression on top.
- KYC "Verify Now →" links to the **existing** `/dashboard/wallet/payment-methods` page (`KycForm` + `submitKyc`) rather than duplicating that UI.
- Password change reuses the **existing** `requestReset` Server Action from `lib/auth/actions.ts` — no new password-reset logic.
- Component test convention in this codebase: **pure logic functions get vitest unit tests; React components do not** (confirmed — every existing `*.test.ts` file tests a `lib/**` pure function, none render components). This plan follows that convention.
- Followers/following/likes are explicitly **out of scope** for this plan (user deferred it to a future brainstorming pass).

---

## File Structure

```
supabase/migrations/062_profile_settings.sql       ← notification_prefs + username_changed_at

lib/players/achievement-rarity.ts                  ← NEW: pure rarity/showcase helpers
lib/players/achievement-rarity.test.ts             ← NEW

components/player/AchievementsGrid.tsx              ← MODIFY: fix locked-achievement privacy leak
components/player/AchievementShowcase.tsx           ← NEW: top-3-by-rarity strip + View All toggle
components/dashboard/XPProgressPanel.tsx             ← MODIFY: optional coinBalance prop
components/player/ProfileCommunityPosts.tsx          ← NEW
components/player/ProfileHeader.tsx                  ← MODIFY: Edit Profile button + Season Rank pill
components/player/ProfileStats.tsx                   ← MODIFY: + Total Wins, Goals Scored tiles
app/(public)/players/[username]/page.tsx             ← MODIFY: wire all of the above in

lib/profile/schema.ts                                ← MODIFY: + username field
lib/profile/actions.ts                               ← MODIFY: updateProfile handles one-time username change
lib/avatars/compress.ts                              ← NEW: client-side canvas compression to 400×400 WebP

components/settings/ProfileForm.tsx                  ← NEW
lib/settings/notification-prefs.ts                   ← NEW: schema + updateWhatsappPrefs + updateAchievementSharingPrefs
components/settings/NotificationPrefsForm.tsx         ← NEW
components/settings/AchievementSharingForm.tsx        ← NEW
lib/settings/account.ts                              ← NEW: deleteAccount Server Action
components/settings/AccountSection.tsx                ← NEW

app/dashboard/settings/page.tsx                       ← NEW: Server Component shell
app/dashboard/profile/page.tsx                        ← MODIFY: becomes a redirect to /dashboard/settings
components/dashboard/ProfileEditForm.tsx               ← DELETE (fully superseded by components/settings/ProfileForm.tsx)
components/dashboard/QuickActions.tsx                  ← MODIFY: link → /dashboard/settings
lib/dashboard/nav.ts                                   ← MODIFY: link → /dashboard/settings

ROADMAP.md                                            ← MODIFY: new Phase 3 row
```

---

### Task 1: Migration 062 — `notification_prefs` + `username_changed_at`

**Files:**
- Create: `supabase/migrations/062_profile_settings.sql`

**Interfaces:**
- Produces: `profiles.notification_prefs jsonb NOT NULL DEFAULT {...}`, `profiles.username_changed_at timestamptz` (nullable) — consumed by Tasks 6–13.

- [ ] **Step 1: Write the migration**

```sql
-- 062_profile_settings.sql
-- Player Profile & Settings (Phase 3): notification preferences JSONB +
-- one-time username change tracking. RLS: profiles_own_update (migration
-- 001, USING (auth.uid() = id), no column restriction) already permits the
-- player to write both new columns — no new policy needed.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notification_prefs jsonb NOT NULL DEFAULT '{
    "whatsapp": {
      "match_reminder": true,
      "result_confirmed": true,
      "prize_credited": true,
      "challenge_completed": false,
      "achievement_unlocked": false,
      "registration_confirmed": true
    },
    "push": {
      "match_reminder": true,
      "result_confirmed": true,
      "achievement_unlocked": true,
      "challenge_completed": true,
      "new_announcement": true,
      "tournament_announced": true,
      "wager_settled": true,
      "referral_converted": true,
      "post_comment": true,
      "post_reaction": false,
      "bracket_released": true,
      "match_assigned": true,
      "prize_credited": true
    },
    "achievement_sharing": {
      "tournament": true,
      "milestone": true,
      "streak": true,
      "social": false,
      "other": false
    }
  }'::jsonb;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username_changed_at timestamptz;
```

- [ ] **Step 2: Apply via Supabase MCP** (per [[project_supabase_connectivity_gotcha]] — check MCP reachability first; fall back to CLI `supabase db push` if MCP is down)

Apply the migration to the live project, then regenerate types:
```bash
npx supabase gen types typescript --project-id <project-id> > lib/supabase/types.ts
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/062_profile_settings.sql lib/supabase/types.ts
git commit -m "feat(db): add notification_prefs + username_changed_at to profiles"
```

---

### Task 2: Achievement rarity helpers

**Files:**
- Create: `lib/players/achievement-rarity.ts`
- Test: `lib/players/achievement-rarity.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces: `AchievementCell` type, `buildAchievementCells()`, `topShowcase()` — consumed by Task 3 and Task 6.

- [ ] **Step 1: Write the failing test**

```ts
// lib/players/achievement-rarity.test.ts
import { describe, it, expect } from 'vitest'
import { buildAchievementCells, topShowcase, type AchievementMeta } from './achievement-rarity'

const ACHIEVEMENTS: AchievementMeta[] = [
  { id: 'a1', slug: 'first-win', name: 'First Win', description: 'Win your first match', category: 'matches' },
  { id: 'a2', slug: 'rare-one', name: 'Rare One', description: 'Do the rare thing', category: 'season' },
  { id: 'a3', slug: 'locked-one', name: 'Locked One', description: 'Not unlocked', category: 'profile' },
]

describe('buildAchievementCells', () => {
  it('marks unlocked achievements with their unlock time, locked with null', () => {
    const cells = buildAchievementCells(
      ACHIEVEMENTS,
      [
        { achievement_id: 'a1', unlocked_at: '2026-08-01T00:00:00Z' },
        { achievement_id: 'a2', unlocked_at: '2026-08-10T00:00:00Z' },
      ],
      new Map([['a1', 50], ['a2', 2], ['a3', 0]]),
    )
    expect(cells.find((c) => c.slug === 'first-win')).toMatchObject({ unlocked: true, unlockCount: 50 })
    expect(cells.find((c) => c.slug === 'rare-one')).toMatchObject({ unlocked: true, unlockCount: 2 })
    expect(cells.find((c) => c.slug === 'locked-one')).toMatchObject({ unlocked: false, unlockedAt: null, unlockCount: 0 })
  })
})

describe('topShowcase', () => {
  it('returns only unlocked cells, rarest (fewest holders) first', () => {
    const cells = buildAchievementCells(
      ACHIEVEMENTS,
      [
        { achievement_id: 'a1', unlocked_at: '2026-08-01T00:00:00Z' },
        { achievement_id: 'a2', unlocked_at: '2026-08-10T00:00:00Z' },
      ],
      new Map([['a1', 50], ['a2', 2], ['a3', 0]]),
    )
    const top = topShowcase(cells, 3)
    expect(top.map((c) => c.slug)).toEqual(['rare-one', 'first-win'])
  })

  it('breaks a rarity tie by most recently unlocked first', () => {
    const cells = buildAchievementCells(
      ACHIEVEMENTS,
      [
        { achievement_id: 'a1', unlocked_at: '2026-08-01T00:00:00Z' },
        { achievement_id: 'a2', unlocked_at: '2026-08-10T00:00:00Z' },
      ],
      new Map([['a1', 5], ['a2', 5], ['a3', 0]]),
    )
    const top = topShowcase(cells, 3)
    expect(top.map((c) => c.slug)).toEqual(['rare-one', 'first-win'])
  })

  it('caps at n', () => {
    const many: AchievementMeta[] = Array.from({ length: 5 }, (_, i) => ({
      id: `id${i}`, slug: `slug${i}`, name: `N${i}`, description: 'd', category: 'matches',
    }))
    const unlocks = many.map((a) => ({ achievement_id: a.id, unlocked_at: '2026-08-01T00:00:00Z' }))
    const counts = new Map(many.map((a) => [a.id, 1]))
    const cells = buildAchievementCells(many, unlocks, counts)
    expect(topShowcase(cells, 3)).toHaveLength(3)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/players/achievement-rarity.test.ts`
Expected: FAIL — `Cannot find module './achievement-rarity'`

- [ ] **Step 3: Write the implementation**

```ts
// lib/players/achievement-rarity.ts

export interface AchievementMeta {
  id: string
  slug: string
  name: string
  description: string
  category: string
}

export interface PlayerUnlockRow {
  achievement_id: string
  unlocked_at: string
}

export interface AchievementCell extends AchievementMeta {
  unlocked: boolean
  unlockedAt: string | null
  /** Total players who hold this achievement, across the whole platform — the rarity signal. */
  unlockCount: number
}

// Attaches per-player unlock state + a global rarity count to each achievement.
// `unlockCounts` is a Map<achievement_id, totalHolders> computed by the caller
// from a full player_achievements scan (see profile page wiring).
export function buildAchievementCells(
  achievements: AchievementMeta[],
  playerUnlocks: PlayerUnlockRow[],
  unlockCounts: Map<string, number>,
): AchievementCell[] {
  const unlockedAt = new Map(playerUnlocks.map((u) => [u.achievement_id, u.unlocked_at]))
  return achievements.map((a) => ({
    ...a,
    unlocked: unlockedAt.has(a.id),
    unlockedAt: unlockedAt.get(a.id) ?? null,
    unlockCount: unlockCounts.get(a.id) ?? 0,
  }))
}

// Top N *unlocked* achievements, rarest (fewest global holders) first, ties
// broken by most recently unlocked. Locked achievements never appear here —
// the showcase strip only celebrates what the player has actually earned.
export function topShowcase(cells: AchievementCell[], n = 3): AchievementCell[] {
  return cells
    .filter((c) => c.unlocked)
    .sort((a, b) => {
      if (a.unlockCount !== b.unlockCount) return a.unlockCount - b.unlockCount
      return new Date(b.unlockedAt!).getTime() - new Date(a.unlockedAt!).getTime()
    })
    .slice(0, n)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/players/achievement-rarity.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/players/achievement-rarity.ts lib/players/achievement-rarity.test.ts
git commit -m "feat(profile): pure achievement rarity/showcase helpers"
```

---

### Task 3: Fix achievement privacy leak + build the showcase component

**Files:**
- Modify: `components/player/AchievementsGrid.tsx`
- Create: `components/player/AchievementShowcase.tsx`

**Interfaces:**
- Consumes: `AchievementCell`, `topShowcase()` from Task 2.
- Produces: `<AchievementShowcase cells={...} />` — consumed by Task 6 (page wiring).

- [ ] **Step 1: Fix `AchievementsGrid` — stop leaking locked name/description**

Currently locked cells still render `a.name` and expose `a.description` via the `title` tooltip on every cell. Per spec §2.4: "no name or description revealed — mystery = motivation."

```tsx
// components/player/AchievementsGrid.tsx
import { Medal } from 'lucide-react'
import type { AchievementCell } from '@/lib/players/achievement-rarity'

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
            title={a.unlocked ? a.description : undefined}
            className={`flex flex-col items-center gap-2 rounded-xl border p-4 text-center ${
              a.unlocked ? 'border-sx-purple/40 bg-sx-surface' : 'border-sx-border bg-sx-surface opacity-40'
            }`}
          >
            {a.unlocked ? (
              <>
                <Medal className="h-8 w-8 text-sx-purple-text" />
                <p className="text-xs font-semibold text-white">{a.name}</p>
              </>
            ) : (
              <>
                <span className="text-2xl text-sx-gray">🔒</span>
                <p className="text-xs font-semibold text-sx-gray">Locked</p>
              </>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Write `AchievementShowcase`** — top-3-by-rarity strip, "View All →" expands the (now-fixed) full grid

```tsx
// components/player/AchievementShowcase.tsx
'use client'
import { useState } from 'react'
import { Medal } from 'lucide-react'
import { topShowcase, type AchievementCell } from '@/lib/players/achievement-rarity'
import { AchievementsGrid } from './AchievementsGrid'

export function AchievementShowcase({ achievements }: { achievements: AchievementCell[] }) {
  const [expanded, setExpanded] = useState(false)
  const unlockedCount = achievements.filter((a) => a.unlocked).length
  const top = topShowcase(achievements, 3)

  if (expanded) {
    return (
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-widest text-white">
            Achievements ({unlockedCount} unlocked)
          </h2>
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="text-xs font-semibold text-sx-purple-text hover:text-sx-purple-light"
          >
            Show less
          </button>
        </div>
        <AchievementsGrid achievements={achievements} />
      </section>
    )
  }

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-widest text-white">
          Achievements ({unlockedCount} unlocked)
        </h2>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-xs font-semibold text-sx-purple-text hover:text-sx-purple-light"
        >
          View All →
        </button>
      </div>
      {top.length === 0 ? (
        <p className="text-sm text-sx-gray">No achievements unlocked yet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {top.map((a) => (
            <div key={a.slug} className="flex items-start gap-3 rounded-xl border border-sx-purple/40 bg-sx-surface p-4">
              <Medal className="h-8 w-8 shrink-0 text-sx-purple-text" />
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-white">{a.name}</p>
                <p className="truncate text-xs text-sx-gray">{a.description}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add components/player/AchievementsGrid.tsx components/player/AchievementShowcase.tsx
git commit -m "fix(profile): stop leaking locked achievement names, add rarity showcase"
```

---

### Task 4: XP bar coin balance + Community Posts component

**Files:**
- Modify: `components/dashboard/XPProgressPanel.tsx`
- Create: `components/player/ProfileCommunityPosts.tsx`

**Interfaces:**
- Produces: `<XPProgressPanel xp coinBalance? />`, `<ProfileCommunityPosts posts={ProfilePost[]} username />` — consumed by Task 6.

- [ ] **Step 1: Add optional `coinBalance` to `XPProgressPanel`**

```tsx
// components/dashboard/XPProgressPanel.tsx
import { computeTier, TIER_XP_THRESHOLDS, type MembershipTier } from '@/lib/membership/tiers'

const NEXT_TIER: Record<MembershipTier, MembershipTier | null> = {
  recruit: 'guardian', guardian: 'elite', elite: 'sentinel', sentinel: 'legend', legend: null,
}
const TIER_LABEL: Record<MembershipTier, string> = {
  recruit: 'Recruit', guardian: 'Guardian', elite: 'Elite', sentinel: 'Sentinel', legend: 'Legend',
}

// coinBalance is optional and owner-only — callers must never pass it when
// rendering another player's profile (see profile page wiring, Task 6).
export function XPProgressPanel({ xp, coinBalance }: { xp: number; coinBalance?: number }) {
  const tier = computeTier(xp)
  const next = NEXT_TIER[tier]
  const floor = TIER_XP_THRESHOLDS[tier]
  const ceiling = next ? TIER_XP_THRESHOLDS[next] : null
  const pct = ceiling ? Math.min(100, Math.round(((xp - floor) / (ceiling - floor)) * 100)) : 100

  return (
    <div className="rounded-xl border border-sx-border bg-sx-surface p-4">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="font-bold uppercase text-white">👑 {TIER_LABEL[tier]}</span>
        <span className="text-sx-gray">{xp.toLocaleString()} XP{ceiling ? ` / ${ceiling.toLocaleString()}${next ? ` to ${TIER_LABEL[next]}` : ''}` : ' (max tier)'}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-800">
        <div className="h-full rounded-full bg-sx-purple transition-all" style={{ width: `${pct}%` }} />
      </div>
      {coinBalance != null && (
        <p className="mt-2 text-sm font-bold text-white">🪙 {coinBalance.toLocaleString()} SX Coins</p>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Write `ProfileCommunityPosts`**

```tsx
// components/player/ProfileCommunityPosts.tsx
import Link from 'next/link'
import { formatRelativeTime } from '@/lib/format'

export interface ProfilePost {
  id: string
  content: string
  postType: string
  createdAt: string
}

const TYPE_ICON: Record<string, string> = {
  manual: '💬',
  match_result: '⚽',
  achievement: '🏅',
  announcement: '📣',
}

export function ProfileCommunityPosts({ posts, username }: { posts: ProfilePost[]; username: string }) {
  return (
    <section id="posts" className="scroll-mt-24">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-widest text-white">Community Posts</h2>
        <Link href={`/community?author=${username}`} className="text-xs font-semibold text-sx-purple-text hover:text-sx-purple-light">
          View all on Community →
        </Link>
      </div>
      {posts.length === 0 ? (
        <p className="text-sm text-sx-gray">No community posts yet.</p>
      ) : (
        <div className="space-y-2">
          {posts.map((p) => (
            <div key={p.id} className="rounded-xl border border-sx-border bg-sx-surface p-4">
              <div className="flex items-center gap-2 text-xs text-sx-gray">
                <span>{TYPE_ICON[p.postType] ?? '💬'}</span>
                <span>{formatRelativeTime(p.createdAt)}</span>
              </div>
              <p className="mt-1.5 line-clamp-3 text-sm text-white">{p.content}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/XPProgressPanel.tsx components/player/ProfileCommunityPosts.tsx
git commit -m "feat(profile): owner-only coin display on XP bar, community posts section"
```

---

### Task 5: Profile header + stats grid additions

**Files:**
- Modify: `components/player/ProfileHeader.tsx`
- Modify: `components/player/ProfileStats.tsx`

**Interfaces:**
- Consumes: `ProfileView` (existing, from `lib/players/profile.ts`) — Task 6 extends it with `seasonRank`/`seasonPoints`.
- Produces: `ProfileHeader` gains `isOwner: boolean` and `seasonRank: number | null` props.

- [ ] **Step 1: Add owner-only "Edit Profile" button + Season Rank pill to `ProfileHeader`**

```tsx
// components/player/ProfileHeader.tsx  (full replacement)
import Link from 'next/link'
import { HexAvatar } from '@/components/shared/HexAvatar'
import { TierBadge } from '@/components/player/TierBadge'
import { MembershipBadge } from './MembershipBadge'
import { AddFriendButton } from '@/components/player/AddFriendButton'
import { ChallengeButton } from '@/components/player/ChallengeButton'
import { formatMonthYear } from '@/lib/format'
import type { ProfileView } from '@/lib/players/profile'
import type { FriendshipStatus } from '@/lib/friends/list'
import type { MembershipTier } from '@/lib/membership/tiers'

export function ProfileHeader({
  profile,
  viewerId,
  friendshipStatus,
  coinBalance,
  achievements,
  avatarBorderClass,
  profileThemeClass,
  usernameColourClass,
}: {
  profile: ProfileView
  viewerId: string | null
  friendshipStatus: FriendshipStatus
  coinBalance?: number
  achievements?: string[]
  avatarBorderClass?: string
  profileThemeClass?: string
  usernameColourClass?: string
}) {
  const name = profile.displayName ?? profile.username
  const since = formatMonthYear(profile.createdAt)
  const isOwner = viewerId === profile.id

  return (
    <header
      className={`relative overflow-hidden rounded-xl border border-sx-border p-6 sm:p-8 ${profileThemeClass ?? 'bg-sx-surface'}`}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-8 -top-8 h-48 w-48 rounded-full bg-sx-purple/20 blur-[50px]"
      />
      <div className="relative flex flex-col items-center gap-4 text-center sm:flex-row sm:items-start sm:gap-6 sm:text-left">
        <HexAvatar
          src={profile.avatarUrl}
          username={profile.displayName ?? profile.username}
          tier={(profile.membershipTier ?? 'recruit') as MembershipTier}
          achievements={achievements}
          size="xl"
          avatarBorderClass={avatarBorderClass}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
            <h1 className={`truncate font-display text-2xl font-black sm:text-3xl ${usernameColourClass ?? 'text-white'}`}>
              {name}
            </h1>
            {isOwner && (
              <Link
                href="/dashboard/settings"
                className="rounded-lg border border-sx-border px-2.5 py-1 text-xs font-semibold text-sx-gray hover:border-sx-purple/50 hover:text-white"
              >
                Edit Profile
              </Link>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm text-sx-gray sm:justify-start">
            {profile.country && <span>📍 {profile.country}</span>}
            {since && <span>📅 Joined {since}</span>}
            <span title="SX Score reliability tier">
              <TierBadge tier={profile.sentinelTier} />
            </span>
            <span title="XP membership level">
              <MembershipBadge tier={profile.membershipTier} />
            </span>
            <span className="font-semibold text-sx-purple-text">
              {profile.seasonRank != null ? `Season Rank #${profile.seasonRank}` : 'Season: Unranked'}
            </span>
            {coinBalance != null && (
              <span className="rounded-full border border-sx-border bg-sx-bg px-2.5 py-0.5 text-[11px] font-bold text-white">
                🪙 {coinBalance.toLocaleString()}
              </span>
            )}
          </div>
          {profile.bio && (
            <p className="mt-3 whitespace-pre-line text-sm italic text-sx-gray">&ldquo;{profile.bio}&rdquo;</p>
          )}
          {viewerId && !isOwner && (
            <div className="mt-4 flex flex-wrap justify-center gap-2 sm:justify-start">
              <FriendStatusAction status={friendshipStatus} profileId={profile.id} />
              <ChallengeButton opponentId={profile.id} />
            </div>
          )}
        </div>
      </div>
    </header>
  )
}

function FriendStatusAction({ status, profileId }: { status: FriendshipStatus; profileId: string }) {
  if (status === 'friends') {
    return <p className="text-sm font-semibold text-sx-green">✓ Friends</p>
  }
  if (status === 'pending_sent') {
    return <p className="text-sm text-sx-gray">Friend request sent</p>
  }
  if (status === 'pending_received') {
    return <p className="text-sm text-sx-gray">They sent you a friend request — check your dashboard</p>
  }
  return <AddFriendButton recipientId={profileId} />
}
```

Note: this replaces the old all-time "Ranked #N" pill with the spec's "Season Rank" pill (§2.1). All-time rank stays visible in `ProfileStats`' existing "Top N% of players" sub-label — nothing is lost, just relocated to match the spec.

- [ ] **Step 2: Add Total Wins + Goals Scored tiles to `ProfileStats`**

```tsx
// components/player/ProfileStats.tsx
import { winPercent } from '@/lib/players/profile'
import type { ProfileView } from '@/lib/players/profile'

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border border-sx-border bg-sx-surface p-4 text-center">
      <p className="font-display text-2xl font-black text-white">{value}</p>
      <p className="mt-0.5 text-[11px] uppercase tracking-wide text-sx-gray">{label}</p>
      {sub && <p className="mt-1 text-[11px] text-sx-purple-text">{sub}</p>}
    </div>
  )
}

export function ProfileStats({ profile }: { profile: ProfileView }) {
  const topPercent =
    profile.rank != null && profile.totalRankedPlayers
      ? Math.max(1, Math.ceil((profile.rank / profile.totalRankedPlayers) * 100))
      : null

  return (
    <section id="stats" className="mb-8 scroll-mt-24">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <Stat
          label="SX Score"
          value={profile.sxScore}
          sub={topPercent ? `Top ${topPercent}% of players` : undefined}
        />
        <Stat label="Win Rate" value={winPercent(profile.wins, profile.totalMatches)} />
        <Stat label="Total Wins" value={profile.wins} />
        <Stat label="Goals Scored" value={profile.goalsScored} />
        <Stat label="Titles Won" value={profile.totalTitles} />
        <Stat label="Tournaments" value={profile.tournamentsPlayed} sub="Participated" />
        <Stat label="Matches Played" value={profile.totalMatches} />
        <Stat label="Current Streak" value={profile.currentStreak} sub={profile.currentStreak > 0 ? 'Wins' : undefined} />
      </div>
    </section>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add components/player/ProfileHeader.tsx components/player/ProfileStats.tsx
git commit -m "feat(profile): owner edit button, season rank pill, wins/goals stat tiles"
```

---

### Task 6: Wire everything into the profile page

**Files:**
- Modify: `lib/players/profile.ts` (add `seasonRank: number | null` to `ProfileView`)
- Modify: `app/(public)/players/[username]/page.tsx`

**Interfaces:**
- Consumes: `getSeasonLeaderboard` (`lib/seasons/data.ts`, existing, signature `(admin, seasonId) => Promise<SeasonLeaderboardRow[]>`), `buildAchievementCells`/`topShowcase` (Task 2), `AchievementShowcase` (Task 3), `XPProgressPanel`/`ProfileCommunityPosts` (Task 4), `SeasonStandingCard` (existing, `components/dashboard/SeasonStandingCard.tsx`).
- Produces: fully wired page — nothing downstream depends on this task.

- [ ] **Step 1: Add `seasonRank` to `ProfileView`**

Find the `ProfileView` interface in `lib/players/profile.ts` and add one field next to the existing `rank`:

```ts
export interface ProfileView {
  // ...existing fields unchanged...
  rank: number | null
  seasonRank: number | null
  // ...
}
```

- [ ] **Step 2: Extend the page's data fetching**

In `app/(public)/players/[username]/page.tsx`, add three things to the existing `Promise.all` block (season leaderboard, all-phase achievements with rarity counts, community posts) and one sequential fetch (active season lookup, needed before the season leaderboard call — same pattern as `app/dashboard/page.tsx`).

Replace the achievements query (currently `.eq('phase', 'phase2')`) and player_achievements query, and add new queries, inside the existing `Promise.all`:

```ts
// Replace this existing line inside the Promise.all array:
//   supabase.from('achievements').select('id, slug, name, description').eq('phase', 'phase2').order('sort_order'),
//   supabase.from('player_achievements').select('achievement_id').eq('player_id', p.id),
// with:
supabase.from('achievements').select('id, slug, name, description, category').order('sort_order'),
supabase.from('player_achievements').select('achievement_id, unlocked_at').eq('player_id', p.id),
// and add these two new entries to the same Promise.all array:
supabase.from('player_achievements').select('achievement_id'),
supabase
  .from('community_posts')
  .select('id, content, post_type, created_at')
  .eq('author_id', p.id)
  .eq('is_deleted', false)
  .order('created_at', { ascending: false })
  .limit(5),
```

Destructure the two new results (name them `rawAllUnlocks` and `rawProfilePosts`) alongside the existing destructured array — match positions exactly to the array above.

Before the season leaderboard call, resolve the active season (sequential, not in the `Promise.all` — it gates whether the season calls run at all, same as `app/dashboard/page.tsx`):

```ts
const { data: activeSeason } = await supabase.from('seasons').select('id').eq('status', 'active').maybeSingle()

let seasonRank: number | null = null
let seasonPoints = 0
let pointsAtRankSixteen = 0
let monthlyRank: number | null = null
let monthlyPoints = 0
const isOwner = !!user && user.id === p.id
if (activeSeason) {
  const admin = createAdminClient()
  const seasonBoard = await getSeasonLeaderboard(admin, activeSeason.id)
  const idx = seasonBoard.findIndex((r) => r.playerId === p.id)
  seasonRank = idx >= 0 ? idx + 1 : null
  seasonPoints = idx >= 0 ? seasonBoard[idx].points : 0
  pointsAtRankSixteen = seasonBoard[15]?.points ?? 0
  // Monthly board is only needed for the owner-only Season Standing card —
  // skip the extra query entirely for public visitors.
  if (isOwner) {
    const monthlyBoard = await getMonthlyLeaderboard(admin, activeSeason.id, new Date())
    const monthlyIdx = monthlyBoard.findIndex((r) => r.playerId === p.id)
    monthlyRank = monthlyIdx >= 0 ? monthlyIdx + 1 : null
    monthlyPoints = monthlyIdx >= 0 ? monthlyBoard[monthlyIdx].points : 0
  }
}
```

Add the import: `import { getSeasonLeaderboard, getMonthlyLeaderboard } from '@/lib/seasons/data'`.

Set `seasonRank` on the assembled `profile: ProfileView` object (alongside the existing `rank:` line).

- [ ] **Step 3: Build achievement cells + community posts view models**

```ts
import { buildAchievementCells, type AchievementCell } from '@/lib/players/achievement-rarity'

// Global rarity counts — how many players hold each achievement, across the
// whole platform. Table is small (≈30 achievements); a full scan matches the
// existing convention (Hall of Fame does the same over all eligible players).
const unlockCounts = new Map<string, number>()
for (const row of (rawAllUnlocks ?? []) as { achievement_id: string }[]) {
  unlockCounts.set(row.achievement_id, (unlockCounts.get(row.achievement_id) ?? 0) + 1)
}

const achievementCells: AchievementCell[] = buildAchievementCells(
  (rawAchievements ?? []) as { id: string; slug: string; name: string; description: string; category: string }[],
  (rawPlayerAchievements ?? []) as { achievement_id: string; unlocked_at: string }[],
  unlockCounts,
)
const unlockedSlugs = achievementCells.filter((a) => a.unlocked).map((a) => a.slug)

const profilePosts = ((rawProfilePosts ?? []) as { id: string; content: string; post_type: string; created_at: string }[]).map((r) => ({
  id: r.id,
  content: r.content,
  postType: r.post_type,
  createdAt: r.created_at,
}))
```

Delete the old `unlockedAchievementIds`/`achievementCells` block that filtered on `phase='phase2'` — this replaces it. `AchievementsGrid` now takes `AchievementCell[]` (from Task 3) instead of its old inline shape — remove the now-unused local type if the file defined one.

- [ ] **Step 4: Render the new sections**

Replace the `<ProfileAchievements titles={titles} />` / `<AchievementsGrid achievements={achievementCells} />` pair with the new showcase, and add the XP bar, Season Standing (owner-only), and Community Posts sections:

```tsx
import { AchievementShowcase } from '@/components/player/AchievementShowcase'
import { XPProgressPanel } from '@/components/dashboard/XPProgressPanel'
import { SeasonStandingCard } from '@/components/dashboard/SeasonStandingCard'
import { ProfileCommunityPosts } from '@/components/player/ProfileCommunityPosts'
```

```tsx
<ProfileHeader
  profile={profile}
  viewerId={user?.id ?? null}
  friendshipStatus={friendship}
  coinBalance={coinBalance ?? undefined}
  achievements={unlockedSlugs}
  avatarBorderClass={cosmetics.avatarBorder ? AVATAR_BORDER_CLASSES[cosmetics.avatarBorder] : undefined}
  profileThemeClass={cosmetics.profileTheme ? PROFILE_THEME_CLASSES[cosmetics.profileTheme] : undefined}
  usernameColourClass={cosmetics.usernameColour ? USERNAME_COLOUR_CLASSES[cosmetics.usernameColour] : undefined}
/>
<ProfileStats profile={profile} />
<XPProgressPanel xp={p.xp} coinBalance={isOwner ? (coinBalance ?? 0) : undefined} />
<ProfileGamesRow games={gamesPlayed} />

<div className="grid gap-8 lg:grid-cols-3">
  <ProfileAchievements titles={titles} />
  <CareerStatsRadar />
  <ProfileRecentActivity matches={matches} />
</div>

<AchievementShowcase achievements={achievementCells} />

<ProfileMatchHistory matches={matches} username={params.username} />

<ProfileCommunityPosts posts={profilePosts} username={params.username} />

{isOwner && (
  <SeasonStandingCard
    seasonRank={seasonRank}
    seasonPoints={seasonPoints}
    pointsAtRankSixteen={pointsAtRankSixteen}
    monthlyRank={monthlyRank}
    monthlyPoints={monthlyPoints}
  />
)}
```

Keep `ProfileAchievements` (tournament-titles trophy wall) as-is — it is a distinct concept from the general achievement showcase and both are in the spec's design language (the visual bible shows both a "Trophies & Badges" wall and a titles list). Remove the now-orphaned old `<AchievementsGrid achievements={achievementCells} />` line at the bottom of the file (superseded by `AchievementShowcase`, which renders `AchievementsGrid` internally when expanded).

- [ ] **Step 5: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: no new errors.

Run: `npm run build`
Expected: clean build.

- [ ] **Step 6: Commit**

```bash
git add lib/players/profile.ts app/"(public)"/players/"[username]"/page.tsx
git commit -m "feat(profile): wire season rank, XP bar, achievement showcase, community posts"
```

---

### Task 7: Settings schema + username one-change action + avatar compression

**Files:**
- Modify: `lib/profile/schema.ts`
- Modify: `lib/profile/actions.ts`
- Create: `lib/avatars/compress.ts`

**Interfaces:**
- Consumes: `usernameSchema` (`lib/auth/schema.ts`, existing).
- Produces: `updateProfile()` now accepts an optional `username` field; `compressImageToWebp(file, size) => Promise<Blob>` — consumed by Task 8.

- [ ] **Step 1: Extend the schema**

```ts
// lib/profile/schema.ts
import { z } from 'zod'
import { usernameSchema } from '@/lib/auth/schema'

export const profileEditSchema = z.object({
  displayName: z.string().trim().min(1, 'Display name is required').max(60, 'Display name is too long'),
  username: z.union([z.literal(''), usernameSchema]),
  whatsapp: z.union([
    z.literal(''),
    z.string().trim().regex(/^\+?[0-9]{10,15}$/, 'Enter a valid WhatsApp number'),
  ]),
  country: z.union([z.literal(''), z.string().trim().max(60, 'Country is too long')]),
  bio: z.union([z.literal(''), z.string().trim().max(280, 'Bio must be 280 characters or fewer')]),
})

export type ProfileEditInput = z.infer<typeof profileEditSchema>
```

An empty-string `username` means "the form's username field was locked/unchanged" — the action below only attempts a change when it receives a non-empty, different value.

- [ ] **Step 2: Extend `updateProfile` — one-time username change + 23505 handling**

```ts
// lib/profile/actions.ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkAndUnlockAchievements } from '@/lib/achievements/unlock'
import { profileEditSchema } from './schema'

export type ProfileEditState = { error?: string; success?: boolean } | undefined

export async function updateProfile(
  _prev: ProfileEditState,
  formData: FormData,
): Promise<ProfileEditState> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const parsed = profileEditSchema.safeParse({
    displayName: formData.get('displayName') ?? '',
    username: formData.get('username') ?? '',
    whatsapp: formData.get('whatsapp') ?? '',
    country: formData.get('country') ?? '',
    bio: formData.get('bio') ?? '',
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const d = parsed.data

  const avatarUrl = formData.get('avatarUrl')

  const update: Record<string, unknown> = {
    display_name: d.displayName,
    whatsapp_number: d.whatsapp || null,
    country: d.country || null,
    bio: d.bio || null,
  }
  if (typeof avatarUrl === 'string' && avatarUrl) update.avatar_url = avatarUrl

  // Username: server-side one-change enforcement (spec §6). A locked/unchanged
  // field submits '' and is skipped entirely — this branch only runs when the
  // player actually typed a new username.
  if (d.username) {
    const { data: current } = await supabase
      .from('profiles')
      .select('username, username_changed_at')
      .eq('id', user.id)
      .maybeSingle()
    if (current && current.username !== d.username) {
      if (current.username_changed_at) {
        return { error: 'Username has already been changed once.' }
      }
      update.username = d.username
      update.username_changed_at = new Date().toISOString()
    }
  }

  const { error } = await supabase.from('profiles').update(update).eq('id', user.id)
  if (error) {
    if (error.code === '23505') return { error: 'That username is already taken.' }
    console.error('updateProfile: update failed', error)
    return { error: 'Could not save your profile. Please try again.' }
  }

  await checkAndUnlockAchievements(createAdminClient(), user.id, { type: 'profile_updated' })

  revalidatePath('/dashboard')
  revalidatePath('/dashboard/settings')
  revalidatePath('/players/[username]', 'page')
  revalidatePath('/', 'layout')
  return { success: true }
}
```

- [ ] **Step 3: Write the avatar compression helper**

Client-only (uses `HTMLCanvasElement`/`Image`), not unit-tested — same convention as the rest of the avatar upload flow, which is browser-only and untested today.

```ts
// lib/avatars/compress.ts
'use client'

// Downscales/crops an image file to a size×size square WebP blob, matching
// the spec's "compress to 400×400px square WebP before upload" (§4.1).
export async function compressImageToWebp(file: File, size = 400, quality = 0.85): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const side = Math.min(bitmap.width, bitmap.height)
  const sx = (bitmap.width - side) / 2
  const sy = (bitmap.height - side) / 2

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas not supported')
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size)

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Compression failed'))),
      'image/webp',
      quality,
    )
  })
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors (existing `ProfileEditForm.tsx` still compiles against the extended schema since `username` defaults to `''` via `formData.get('username') ?? ''` when the field is absent from its form).

- [ ] **Step 5: Commit**

```bash
git add lib/profile/schema.ts lib/profile/actions.ts lib/avatars/compress.ts
git commit -m "feat(settings): one-time username change + avatar compression helper"
```

---

### Task 8: `components/settings/ProfileForm.tsx`

**Files:**
- Create: `components/settings/ProfileForm.tsx`

**Interfaces:**
- Consumes: `updateProfile` (Task 7), `compressImageToWebp` (Task 7), `HexAvatar` (existing).
- Produces: `<ProfileForm profile={...} />` — consumed by Task 12.

- [ ] **Step 1: Write the component**

```tsx
// components/settings/ProfileForm.tsx
'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { createClient } from '@/lib/supabase/client'
import { updateProfile, type ProfileEditState } from '@/lib/profile/actions'
import { compressImageToWebp } from '@/lib/avatars/compress'
import { HexAvatar } from '@/components/shared/HexAvatar'
import type { MembershipTier } from '@/lib/membership/tiers'

export interface SettingsProfile {
  displayName: string | null
  username: string
  usernameChangedAt: string | null
  avatarUrl: string | null
  membershipTier: MembershipTier
  whatsapp: string | null
  country: string | null
  bio: string | null
}

export function ProfileForm({ profile }: { profile: SettingsProfile }) {
  const [state, formAction] = useFormState<ProfileEditState, FormData>(updateProfile, undefined)
  const [avatarUrl, setAvatarUrl] = useState(profile.avatarUrl)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const usernameLocked = !!profile.usernameChangedAt
  const [usernameValue, setUsernameValue] = useState(profile.username)

  async function onAvatarFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    setUploadError(null)
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      setUploading(false)
      setUploadError('Please log in.')
      return
    }
    try {
      const compressed = await compressImageToWebp(file)
      const path = `${user.id}/${crypto.randomUUID()}.webp`
      const { error } = await supabase.storage.from('avatars').upload(path, compressed, {
        upsert: false,
        contentType: 'image/webp',
      })
      if (error) throw error
      const { data } = supabase.storage.from('avatars').getPublicUrl(path)
      setAvatarUrl(data.publicUrl)
    } catch {
      setUploadError('Avatar upload failed. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <section className="rounded-2xl border border-sx-border bg-sx-surface p-5">
      <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-white">Profile</h2>
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="avatarUrl" value={avatarUrl ?? ''} />
        <div className="flex items-center gap-4">
          <HexAvatar src={avatarUrl} username={profile.displayName ?? profile.username} tier={profile.membershipTier} size="lg" />
          <label className="cursor-pointer text-sm font-semibold text-sx-purple-text hover:text-sx-purple-light">
            {uploading ? 'Uploading…' : 'Upload new photo'}
            <input type="file" accept="image/*" onChange={onAvatarFile} className="hidden" disabled={uploading} />
          </label>
        </div>
        <p className="text-xs text-sx-gray">Supported: JPG, PNG · Compressed to 400×400</p>
        {uploadError && <p className="text-xs text-red-400">{uploadError}</p>}

        <Field label="Display Name" name="displayName" defaultValue={profile.displayName ?? ''} required />

        <div className="space-y-1.5">
          <label htmlFor="username" className="text-sm font-medium text-sx-gray">Username</label>
          {usernameLocked ? (
            <p className="flex items-center gap-1.5 rounded-lg border border-sx-border bg-sx-bg px-3 py-2 text-sm text-sx-gray">
              🔒 @{profile.username} — Contact support to change username.
            </p>
          ) : (
            <>
              <input
                id="username"
                name="username"
                type="text"
                value={usernameValue}
                onChange={(e) => setUsernameValue(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-sx-purple focus:outline-none"
              />
              <p className="text-xs text-amber-400">⚠ Username can only be changed once.</p>
            </>
          )}
        </div>

        <Field label="Bio" name="bio" defaultValue={profile.bio ?? ''} textarea maxLength={280} />
        <Field label="Country" name="country" defaultValue={profile.country ?? ''} />
        <Field label="WhatsApp" name="whatsapp" defaultValue={profile.whatsapp ?? ''} type="tel" placeholder="+2348012345678" />

        {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
        {state?.success && <p className="text-sm text-emerald-400">Profile updated.</p>}
        <button
          type="submit"
          disabled={uploading}
          className="rounded-lg bg-sx-purple px-5 py-2.5 text-sm font-bold text-white hover:bg-sx-purple-light disabled:opacity-50"
        >
          Save Changes
        </button>
      </form>
    </section>
  )
}

function Field({
  label, name, defaultValue, required, textarea, maxLength, type = 'text', placeholder,
}: {
  label: string; name: string; defaultValue: string; required?: boolean
  textarea?: boolean; maxLength?: number; type?: string; placeholder?: string
}) {
  const cls = 'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-sx-purple focus:outline-none'
  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="text-sm font-medium text-sx-gray">{label}</label>
      {textarea ? (
        <textarea id={name} name={name} rows={3} maxLength={maxLength} defaultValue={defaultValue} className={cls} />
      ) : (
        <input id={name} name={name} type={type} required={required} defaultValue={defaultValue} placeholder={placeholder} className={cls} />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/settings/ProfileForm.tsx
git commit -m "feat(settings): profile form with username lock + avatar compression"
```

---

### Task 9: Notification prefs + achievement sharing actions

**Files:**
- Create: `lib/settings/notification-prefs.ts`

**Interfaces:**
- Produces: `updateWhatsappPrefs()`, `updateAchievementSharingPrefs()` — consumed by Task 10.

- [ ] **Step 1: Write the schema + two merge-patch actions**

```ts
// lib/settings/notification-prefs.ts
'use server'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

const whatsappPrefsSchema = z.object({
  match_reminder: z.boolean(),
  result_confirmed: z.boolean(),
  prize_credited: z.boolean(),
  challenge_completed: z.boolean(),
  achievement_unlocked: z.boolean(),
  registration_confirmed: z.boolean(),
})

const achievementSharingSchema = z.object({
  tournament: z.boolean(),
  milestone: z.boolean(),
  streak: z.boolean(),
  social: z.boolean(),
  other: z.boolean(),
})

export type PrefsState = { error?: string; success?: boolean } | undefined

function boolFromForm(formData: FormData, key: string): boolean {
  return formData.get(key) === 'on'
}

// Merge-patch only the `whatsapp` key of notification_prefs — the `||`
// jsonb operator preserves every other key (push, achievement_sharing, and
// any future ones) untouched (spec §4.2 / Global Constraints).
export async function updateWhatsappPrefs(_prev: PrefsState, formData: FormData): Promise<PrefsState> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const parsed = whatsappPrefsSchema.safeParse({
    match_reminder: boolFromForm(formData, 'match_reminder'),
    result_confirmed: boolFromForm(formData, 'result_confirmed'),
    prize_credited: boolFromForm(formData, 'prize_credited'),
    challenge_completed: boolFromForm(formData, 'challenge_completed'),
    achievement_unlocked: boolFromForm(formData, 'achievement_unlocked'),
    registration_confirmed: boolFromForm(formData, 'registration_confirmed'),
  })
  if (!parsed.success) return { error: 'Invalid preferences.' }

  const { error } = await supabase.rpc('jsonb_merge_notification_prefs' as never, {
    p_id: user.id,
    p_key: 'whatsapp',
    p_patch: parsed.data,
  } as never)
  if (error) {
    console.error('updateWhatsappPrefs failed', error)
    return { error: 'Could not save your preferences. Please try again.' }
  }
  revalidatePath('/dashboard/settings')
  return { success: true }
}

export async function updateAchievementSharingPrefs(_prev: PrefsState, formData: FormData): Promise<PrefsState> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const parsed = achievementSharingSchema.safeParse({
    tournament: boolFromForm(formData, 'tournament'),
    milestone: boolFromForm(formData, 'milestone'),
    streak: boolFromForm(formData, 'streak'),
    social: boolFromForm(formData, 'social'),
    other: boolFromForm(formData, 'other'),
  })
  if (!parsed.success) return { error: 'Invalid preferences.' }

  const { error } = await supabase.rpc('jsonb_merge_notification_prefs' as never, {
    p_id: user.id,
    p_key: 'achievement_sharing',
    p_patch: parsed.data,
  } as never)
  if (error) {
    console.error('updateAchievementSharingPrefs failed', error)
    return { error: 'Could not save your preferences. Please try again.' }
  }
  revalidatePath('/dashboard/settings')
  return { success: true }
}
```

This calls a small Postgres helper function (added below) rather than a client-side read-then-write, so the merge is atomic under concurrent saves — two tabs saving different sub-keys at once can never clobber each other, which a JS-side `{...current, ...patch}` read-modify-write could.

- [ ] **Step 2: Add the merge function to migration 062**

Append to `supabase/migrations/062_profile_settings.sql` (same file from Task 1 — if Task 1 already ran and this plan is being executed strictly in order, append and re-apply is fine since `CREATE OR REPLACE FUNCTION` is idempotent; if executing task-by-task with review gates, add this block to the same migration file before it was first applied):

```sql
-- Atomic single-key merge into profiles.notification_prefs — avoids a
-- client-side read-modify-write race between concurrent saves of different
-- sub-keys (whatsapp vs achievement_sharing).
CREATE OR REPLACE FUNCTION public.jsonb_merge_notification_prefs(p_id uuid, p_key text, p_patch jsonb)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
AS $$
  UPDATE public.profiles
  SET notification_prefs = jsonb_set(notification_prefs, ARRAY[p_key], COALESCE(notification_prefs -> p_key, '{}'::jsonb) || p_patch)
  WHERE id = p_id;
$$;
```

`SECURITY INVOKER` (the default, stated explicitly) means this runs as the calling (authenticated) role — `profiles_own_update` RLS still applies, so a player can only ever merge their own row.

- [ ] **Step 3: Commit**

```bash
git add lib/settings/notification-prefs.ts supabase/migrations/062_profile_settings.sql
git commit -m "feat(settings): atomic jsonb merge actions for notification prefs"
```

---

### Task 10: Notification & achievement-sharing toggle forms

**Files:**
- Create: `components/settings/NotificationPrefsForm.tsx`
- Create: `components/settings/AchievementSharingForm.tsx`

**Interfaces:**
- Consumes: `updateWhatsappPrefs`, `updateAchievementSharingPrefs` (Task 9).
- Produces: both components — consumed by Task 12.

- [ ] **Step 1: Write `NotificationPrefsForm`**

```tsx
// components/settings/NotificationPrefsForm.tsx
'use client'
import { useFormState } from 'react-dom'
import { updateWhatsappPrefs, type PrefsState } from '@/lib/settings/notification-prefs'

export interface WhatsappPrefs {
  match_reminder: boolean
  result_confirmed: boolean
  prize_credited: boolean
  challenge_completed: boolean
  achievement_unlocked: boolean
  registration_confirmed: boolean
}

const LABELS: [keyof WhatsappPrefs, string][] = [
  ['match_reminder', 'Match reminders (1h before kickoff)'],
  ['result_confirmed', 'Result confirmed'],
  ['prize_credited', 'Prize credited to wallet'],
  ['challenge_completed', 'Weekly challenge completed'],
  ['achievement_unlocked', 'Achievement unlocked'],
  ['registration_confirmed', 'Registration confirmed'],
]

export function NotificationPrefsForm({ prefs, whatsappNumber }: { prefs: WhatsappPrefs; whatsappNumber: string | null }) {
  const [state, formAction] = useFormState<PrefsState, FormData>(updateWhatsappPrefs, undefined)

  return (
    <section className="rounded-2xl border border-sx-border bg-sx-surface p-5">
      <h2 className="text-sm font-bold uppercase tracking-wide text-white">Notifications</h2>
      <p className="mt-1 text-xs text-sx-gray">
        {whatsappNumber ? `Sent to your WhatsApp number: ${whatsappNumber}` : 'No WhatsApp number set — notifications are paused.'}
        {' '}(Update in Profile settings above)
      </p>
      <form action={formAction} className="mt-4 space-y-3 border-t border-sx-border pt-4">
        {LABELS.map(([key, label]) => (
          <label key={key} className="flex items-center justify-between text-sm text-white">
            {label}
            <input type="checkbox" name={key} defaultChecked={prefs[key]} className="h-5 w-5 accent-sx-purple" />
          </label>
        ))}
        {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
        {state?.success && <p className="text-sm text-emerald-400">Saved.</p>}
        <button type="submit" className="rounded-lg bg-sx-purple px-5 py-2.5 text-sm font-bold text-white hover:bg-sx-purple-light">
          Save Changes
        </button>
      </form>
    </section>
  )
}
```

- [ ] **Step 2: Write `AchievementSharingForm`**

```tsx
// components/settings/AchievementSharingForm.tsx
'use client'
import { useFormState } from 'react-dom'
import { updateAchievementSharingPrefs, type PrefsState } from '@/lib/settings/notification-prefs'

export interface AchievementSharingPrefs {
  tournament: boolean
  milestone: boolean
  streak: boolean
  social: boolean
  other: boolean
}

const LABELS: [keyof AchievementSharingPrefs, string][] = [
  ['tournament', 'Tournament wins'],
  ['milestone', 'Milestone achievements (100 matches, etc.)'],
  ['streak', 'Streak achievements'],
  ['social', 'Social achievements (reactions, posts)'],
  ['other', 'All other achievements'],
]

export function AchievementSharingForm({ prefs }: { prefs: AchievementSharingPrefs }) {
  const [state, formAction] = useFormState<PrefsState, FormData>(updateAchievementSharingPrefs, undefined)

  return (
    <section className="rounded-2xl border border-sx-border bg-sx-surface p-5">
      <h2 className="text-sm font-bold uppercase tracking-wide text-white">Achievement Sharing</h2>
      <p className="mt-1 text-xs text-sx-gray">
        When you unlock an achievement, auto-post it to the community feed for others to celebrate.
      </p>
      <form action={formAction} className="mt-4 space-y-3 border-t border-sx-border pt-4">
        {LABELS.map(([key, label]) => (
          <label key={key} className="flex items-center justify-between text-sm text-white">
            {label}
            <input type="checkbox" name={key} defaultChecked={prefs[key]} className="h-5 w-5 accent-sx-purple" />
          </label>
        ))}
        {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
        {state?.success && <p className="text-sm text-emerald-400">Saved.</p>}
        <button type="submit" className="rounded-lg bg-sx-purple px-5 py-2.5 text-sm font-bold text-white hover:bg-sx-purple-light">
          Save Changes
        </button>
      </form>
    </section>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add components/settings/NotificationPrefsForm.tsx components/settings/AchievementSharingForm.tsx
git commit -m "feat(settings): notification + achievement-sharing toggle forms"
```

---

### Task 11: Delete account action + Account & Security section

**Files:**
- Create: `lib/settings/account.ts`
- Create: `components/settings/AccountSection.tsx`

**Interfaces:**
- Consumes: `requestReset` (`lib/auth/actions.ts`, existing).
- Produces: `deleteAccount()`, `<AccountSection email kycVerified requestResetAction />` — consumed by Task 12.

- [ ] **Step 1: Write `deleteAccount`**

```ts
// lib/settings/account.ts
'use server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export type DeleteAccountState = { error?: string } | undefined

// profiles.id REFERENCES auth.users(id) ON DELETE CASCADE (migration 001) —
// deleting the auth user cascades the profile row and everything FK'd to it.
// This is the only place in the codebase that calls auth.admin.deleteUser;
// there is no undo.
export async function deleteAccount(_prev: DeleteAccountState, formData: FormData): Promise<DeleteAccountState> {
  if (formData.get('confirm') !== 'DELETE') {
    return { error: 'Type DELETE to confirm.' }
  }
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const admin = createAdminClient()
  const { error } = await admin.auth.admin.deleteUser(user.id)
  if (error) {
    console.error('deleteAccount failed', error)
    return { error: 'Could not delete your account. Please try again or contact support.' }
  }
  return undefined
}
```

- [ ] **Step 2: Write `AccountSection`** — password reset reuses the existing action; delete flow is a two-step client modal

```tsx
// components/settings/AccountSection.tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useFormState } from 'react-dom'
import Link from 'next/link'
import { requestReset, type ActionState } from '@/lib/auth/actions'
import { deleteAccount, type DeleteAccountState } from '@/lib/settings/account'
import { createClient } from '@/lib/supabase/client'

export function AccountSection({ email, kycVerified }: { email: string; kycVerified: boolean }) {
  return (
    <section className="rounded-2xl border border-sx-border bg-sx-surface p-5">
      <h2 className="text-sm font-bold uppercase tracking-wide text-white">Account</h2>
      <div className="mt-3 space-y-3 border-t border-sx-border pt-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-sx-gray">Email</span>
          <span className="text-white">{email}</span>
        </div>
        <ChangePasswordButton email={email} />
      </div>

      <div className="mt-5 border-t border-sx-border pt-3">
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-sx-gray">KYC Status</h3>
        {kycVerified ? (
          <p className="text-sm font-semibold text-emerald-400">✅ Account Verified — withdrawal enabled</p>
        ) : (
          <div className="flex items-center justify-between">
            <p className="text-sm text-amber-400">⚠ Not yet verified — verify to unlock withdrawals</p>
            <Link href="/dashboard/wallet/payment-methods" className="text-xs font-semibold text-sx-purple-text hover:text-sx-purple-light">
              Verify Now →
            </Link>
          </div>
        )}
      </div>

      <div className="mt-5 border-t border-red-900/40 pt-3">
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-red-400">Danger Zone</h3>
        <DeleteAccountButton />
      </div>
    </section>
  )
}

function ChangePasswordButton({ email }: { email: string }) {
  // requestReset's ActionState.success is the message string itself (not a
  // boolean) — render it directly rather than a hardcoded string.
  const [state, formAction] = useFormState<ActionState, FormData>(requestReset, undefined)
  return (
    <form action={formAction} className="space-y-1.5">
      <input type="hidden" name="email" value={email} />
      <div className="flex items-center justify-between">
        <span className="text-sx-gray">Password</span>
        <button type="submit" className="text-xs font-semibold text-sx-purple-text hover:text-sx-purple-light">
          Change Password →
        </button>
      </div>
      {state?.error && <p className="text-xs text-red-400">{state.error}</p>}
      {state?.success && <p className="text-xs text-emerald-400">{state.success}</p>}
    </form>
  )
}

function DeleteAccountButton() {
  const [open, setOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const router = useRouter()
  const [state, formAction] = useFormState<DeleteAccountState, FormData>(async (prev, fd) => {
    const result = await deleteAccount(prev, fd)
    if (!result?.error) {
      await createClient().auth.signOut()
      router.push('/')
    }
    return result
  }, undefined)

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-red-900/50 px-4 py-2 text-sm font-bold text-red-400 hover:bg-red-950/30"
      >
        Delete Account
      </button>
    )
  }

  return (
    <form action={formAction} className="space-y-2 rounded-xl border border-red-900/50 bg-red-950/10 p-4">
      <p className="text-sm text-white">This permanently deletes your account and all associated data. Type <strong>DELETE</strong> to confirm.</p>
      <input
        type="text"
        name="confirm"
        value={confirmText}
        onChange={(e) => setConfirmText(e.target.value)}
        className="w-full rounded-lg border border-red-900/50 bg-slate-950 px-3 py-2 text-sm text-white"
      />
      {state?.error && <p className="text-xs text-red-400">{state.error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={confirmText !== 'DELETE'}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-500 disabled:opacity-40"
        >
          Permanently Delete
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-sx-border px-4 py-2 text-sm text-sx-gray">
          Cancel
        </button>
      </div>
    </form>
  )
}
```

`lib/auth/actions.ts` already exports `ActionState` (`{ error?: string; success?: string } | undefined`) alongside `requestReset` — reused as-is, no new export needed.

- [ ] **Step 3: Commit**

```bash
git add lib/settings/account.ts components/settings/AccountSection.tsx
git commit -m "feat(settings): account section with password reset, KYC link, delete account"
```

---

### Task 12: `/dashboard/settings` page + retire `/dashboard/profile`

**Files:**
- Create: `app/dashboard/settings/page.tsx`
- Modify: `app/dashboard/profile/page.tsx` (becomes a redirect)
- Delete: `components/dashboard/ProfileEditForm.tsx`
- Modify: `components/dashboard/QuickActions.tsx`
- Modify: `lib/dashboard/nav.ts`

**Interfaces:**
- Consumes: `ProfileForm` (Task 8), `NotificationPrefsForm`/`AchievementSharingForm` (Task 10), `AccountSection` (Task 11).

- [ ] **Step 1: Write the settings page**

```tsx
// app/dashboard/settings/page.tsx
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { DashboardShell } from '@/components/dashboard/DashboardShell'
import { ProfileForm } from '@/components/settings/ProfileForm'
import { NotificationPrefsForm } from '@/components/settings/NotificationPrefsForm'
import { AchievementSharingForm } from '@/components/settings/AchievementSharingForm'
import { AccountSection } from '@/components/settings/AccountSection'
import type { MembershipTier } from '@/lib/membership/tiers'

export const metadata: Metadata = { title: 'Settings · SentinelX Esports', robots: { index: false, follow: false } }

export default async function DashboardSettingsPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/dashboard/settings')

  const [{ data: profile }, { data: kyc }] = await Promise.all([
    supabase
      .from('profiles')
      .select('display_name, username, username_changed_at, avatar_url, membership_tier, whatsapp_number, country, bio, notification_prefs, kyc_verified')
      .eq('id', user.id)
      .maybeSingle(),
    createAdminClient().from('player_kyc').select('kyc_status').eq('player_id', user.id).maybeSingle(),
  ])

  const prefs = (profile?.notification_prefs ?? {}) as {
    whatsapp?: Record<string, boolean>
    achievement_sharing?: Record<string, boolean>
  }

  return (
    <DashboardShell>
      <h1 className="mb-4 text-lg font-bold text-white">Settings</h1>
      <div className="space-y-5">
        <ProfileForm
          profile={{
            displayName: profile?.display_name ?? null,
            username: profile?.username ?? '',
            usernameChangedAt: profile?.username_changed_at ?? null,
            avatarUrl: profile?.avatar_url ?? null,
            membershipTier: (profile?.membership_tier ?? 'recruit') as MembershipTier,
            whatsapp: profile?.whatsapp_number ?? null,
            country: profile?.country ?? null,
            bio: profile?.bio ?? null,
          }}
        />
        <NotificationPrefsForm
          prefs={{
            match_reminder: prefs.whatsapp?.match_reminder ?? true,
            result_confirmed: prefs.whatsapp?.result_confirmed ?? true,
            prize_credited: prefs.whatsapp?.prize_credited ?? true,
            challenge_completed: prefs.whatsapp?.challenge_completed ?? false,
            achievement_unlocked: prefs.whatsapp?.achievement_unlocked ?? false,
            registration_confirmed: prefs.whatsapp?.registration_confirmed ?? true,
          }}
          whatsappNumber={profile?.whatsapp_number ?? null}
        />
        <AchievementSharingForm
          prefs={{
            tournament: prefs.achievement_sharing?.tournament ?? true,
            milestone: prefs.achievement_sharing?.milestone ?? true,
            streak: prefs.achievement_sharing?.streak ?? true,
            social: prefs.achievement_sharing?.social ?? false,
            other: prefs.achievement_sharing?.other ?? false,
          }}
        />
        <AccountSection email={user.email ?? ''} kycVerified={kyc?.kyc_status === 'verified' || !!profile?.kyc_verified} />
      </div>
    </DashboardShell>
  )
}
```

- [ ] **Step 2: Redirect the old route**

```tsx
// app/dashboard/profile/page.tsx  (full replacement)
import { redirect } from 'next/navigation'

export default function DashboardProfilePage() {
  redirect('/dashboard/settings')
}
```

- [ ] **Step 3: Delete the superseded form**

```bash
git rm components/dashboard/ProfileEditForm.tsx
```

- [ ] **Step 4: Update the two nav references**

In `components/dashboard/QuickActions.tsx`, change the last tile:
```ts
{ href: '/dashboard/settings', icon: '⚙', label: 'Settings' },
```

In `lib/dashboard/nav.ts`, change the last item:
```ts
{ label: 'Settings', href: '/dashboard/settings' },
```

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: clean build, no dangling imports of `ProfileEditForm`.

- [ ] **Step 6: Commit**

```bash
git add app/dashboard/settings/page.tsx app/dashboard/profile/page.tsx components/dashboard/QuickActions.tsx lib/dashboard/nav.ts
git commit -m "feat(settings): assemble /dashboard/settings, retire /dashboard/profile"
```

---

### Task 13: Full verification + ROADMAP update

**Files:**
- Modify: `ROADMAP.md`

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass (existing suite + the new `achievement-rarity.test.ts`).

- [ ] **Step 2: Typecheck + lint + build**

```bash
npx tsc --noEmit
npx eslint .
npm run build
```
Expected: all clean.

- [ ] **Step 3: Live smoke-check** (per [[project_supabase_connectivity_gotcha]] — use MCP if CLI is unreachable)

Confirm on the deployed/staging URL: `/players/<a-real-username>` renders with Season Rank pill, XP bar, achievement showcase (locked cells show 🔒 with no name), community posts section; `/dashboard/settings` renders all four sections for a logged-in player; `/dashboard/profile` redirects to `/dashboard/settings`.

- [ ] **Step 4: Add the ROADMAP entry**

Add a new row/section to `ROADMAP.md` under a "Phase 3" heading (create one if it doesn't exist yet, alongside the existing Social Feed entry):

```markdown
| — | Player Profile & Settings — season rank, XP bar, achievement showcase (rarity-sorted), community posts, `/dashboard/settings` (profile/notifications/achievement-sharing/account) | `/players/[username]`, `/dashboard/settings` | ✅ |
```

- [ ] **Step 5: Merge to main and push**

Per [[feedback_always_push]]: merge the feature branch to `main` and push `origin/main` once verification is complete — no separate confirmation needed.

```bash
git checkout main
git merge --no-ff <feature-branch>
git push origin main
```

---

## Self-Review Notes

- **Spec coverage:** §2.1 hero (Edit button, Season Rank pill — Task 5/6) ✓; §2.2 stats grid (Task 5) ✓; §2.3 XP bar (Task 4/6) ✓; §2.4 achievement showcase incl. locked-privacy fix (Task 2/3) ✓; §2.5 recent matches (already built, untouched) ✓; §2.6 community posts (Task 4/6) ✓; §2.7 season standing owner-only (Task 6) ✓; §3 data requirements (Task 6) ✓; §4.1 profile form incl. avatar compression + username lock (Task 7/8) ✓; §4.2 notification prefs (Task 9/10) ✓; §4.3 achievement sharing (Task 9/10) ✓; §4.4 account & security (Task 11) ✓; §5 component structure — deliberately uses `components/player/` + `components/settings/` instead of the spec's `components/profile/`, see Global Constraints ✓ (documented deviation); §6 username one-change (Task 7) ✓; §7 out-of-scope items (visibility, blocking, following, verified checkmark, store themes) — none built, followers/likes also explicitly deferred per user ✓.
- **Placeholder scan:** no TBD/TODO markers; every step has real, complete code.
- **Type consistency:** `AchievementCell` (Task 2) is the one shape used by `AchievementsGrid`, `AchievementShowcase`, and the page (Task 3, 6) — no divergent local redefinition. `ProfileView.seasonRank` (Task 6) matches the field name read in `ProfileHeader` (Task 5). `WhatsappPrefs`/`AchievementSharingPrefs` keys in Task 10's forms match the migration's JSONB default keys and Task 9's zod schemas exactly.
