# HexAvatar + Dashboard + Hall of Fame Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the hexagonal tier-avatar system, then rebuild the player Dashboard and the Hall of Fame page around it, per the three approved specs.

**Architecture:** Build the shared `HexAvatar` primitive and its pure helpers first (everything else depends on it), wire it into the handful of existing pages that show avatars today, then build the Dashboard's new top-of-page sections as small Server Components fed by one `Promise.all` (keeping every pre-existing dashboard section — wallet, marketplace, referrals, friends, etc. — intact below them), then rebuild the Hall of Fame page's section components in its grandeur order, adding a runner-up-aware champion query.

**Tech Stack:** Next.js 14 App Router (Server Components by default), TypeScript, Tailwind, Supabase, Vitest.

**Spec:**
- `docs/superpowers/specs/2026-08-15-hex-avatar-design.md`
- `docs/superpowers/specs/2026-08-15-dashboard-overhaul-design.md`
- `docs/superpowers/specs/2026-08-15-hall-of-fame-overhaul-design.md`

## Global Constraints

- `tournament_type` already exists on `tournaments` (migration 047) with values `'community_club' | 'masters' | 'champions_cup' | 'open'` — **no migration needed**, despite the dashboard spec's note to check.
- The real dashboard file is `app/dashboard/page.tsx`, **not** `app/(protected)/dashboard/page.tsx` as the spec header says — there is no route-group split in this codebase. Use the real path everywhere.
- `next.config.mjs` has no `images.remotePatterns` — `next/image` cannot load Supabase Storage avatar URLs (this is why the existing `components/shared/Avatar.tsx` uses a plain `<img>`, not `next/image`). `HexAvatar` must do the same — use `<img>`, not `next/image`, contradicting the spec's pseudo-code.
- `HexAvatar` needs an `onError` handler to fall back to initials on a broken image (spec §5.4) — that requires `'use client'`. This is a deliberate, scoped exception to "Server Components only": `HexAvatar` is a tiny leaf UI primitive (like a shadcn/ui atom), not a page section; every page/section that renders it stays a Server Component.
- Reuse existing infra instead of duplicating it: `lib/membership/tiers.ts` (`MembershipTier`, `computeTier`, `TIER_XP_THRESHOLDS`), `lib/format.ts` (`formatNaira`, `formatDate`, `formatDateTime`, `formatMonthYear`), `lib/seasons/data.ts` (`getSeasonLeaderboard`, `getMonthlyLeaderboard`), `lib/tournaments/bracket.ts` (`ROUND_LABELS`, `getChampion`, `getThirdPlace`), `components/player/TierBadge.tsx` (SX Score reliability tier — different from `MembershipTier`), `components/shared/EmptyState.tsx`, `lib/dashboard/fixtures.ts` (existing fixtures bucketing — untouched, still powers the preserved "Active/Completed matches" sections).
- Achievement decoration slugs (`first_champion`, `champion_3x`, `masters_champion`, `champions_cup_champion`, `win_streak_5`, `matches_100`) all exist today in `supabase/migrations/053_achievements.sql` — confirmed, no new seed data needed.
- Decoration badges render as an emoji-in-circle (👑🔥⭐💎⚡🛡), not custom SVGs — matches this codebase's existing emoji-heavy icon convention everywhere else (award cards, banners, nav) instead of introducing a new SVG asset pipeline.
- No component snapshot-test infrastructure exists in this repo (`vitest` only, no `@testing-library`). Follow the existing convention: unit-test every pure `lib/*.ts` helper (`.test.ts` next to it), do **not** attempt to add component-level tests where none of the ~150 existing components have them. Verify components by `npm run build` (typecheck) + manual browser check via the `run` skill.
- `components/dashboard/WalletPanel.tsx` already renders `KycForm` internally — moving the Wallet section to its own page is a prop-passthrough move, not a rebuild.
- The player-profile `avatar_border` store cosmetic (`lib/store/cosmetics.ts` → `AVATAR_BORDER_CLASSES`, shipped in commit `bfb2832`, immediately before this spec) is a Tailwind `ring-*`/`shadow-*` class currently applied to the circular `<Avatar>`. `HexAvatar` must accept and apply this class too (as an `avatarBorderClass?: string` prop on the outer wrapper) so equipped cosmetics don't silently stop rendering — the ring will hug the rectangular bounding box rather than the hex silhouette exactly; that's a disclosed, acceptable transitional look, not a follow-up blocker.
- HexAvatar's site-wide replacement scope is exactly the 9 locations in spec §6's table — not literally every rounded avatar in the app. Locations outside that table (`AccountMenu`, `BottomTabBar`, `ProfileEditForm`'s upload preview, `community/PostCard`, `FriendsPanel`) are chrome/utility contexts the spec doesn't list and stay circular.
- `tournaments.prize_pool` (a real column) is the source for Masters/Champions Cup prize amounts — never hardcode `₦50,000`/`₦10,000`. There is no runner-up-prize column anywhere in the schema, so runner-up rows show the player's name only, never a fabricated amount.

---

## Part A — HexAvatar Foundation

### Task A1: Tailwind animations + legend gradient CSS

**Files:**
- Modify: `tailwind.config.ts`
- Modify: `app/globals.css`

**Interfaces:**
- Produces: Tailwind classes `animate-sentinel-pulse`, `animate-legend-glow` for A4; CSS class `.hexavatar-legend-border` (animated conic-gradient) for A4.

- [ ] **Step 1: Add keyframes/animation to `tailwind.config.ts`**

In the `theme.extend` block, extend the existing `keyframes`/`animation` objects (don't replace — `pulse-dot` must survive):

```ts
      keyframes: {
        "pulse-dot": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.35" },
        },
        sentinelPulse: {
          '0%, 100%': { filter: 'drop-shadow(0 0 16px rgba(245,158,11,0.75))' },
          '50%':      { filter: 'drop-shadow(0 0 24px rgba(245,158,11,1))' },
        },
        legendGlow: {
          '0%':   { filter: 'drop-shadow(0 0 20px rgba(239,68,68,0.8))' },
          '50%':  { filter: 'drop-shadow(0 0 24px rgba(245,158,11,0.9))' },
          '100%': { filter: 'drop-shadow(0 0 20px rgba(239,68,68,0.8))' },
        },
      },
      animation: {
        "pulse-dot": "pulse-dot 1.6s ease-in-out infinite",
        'sentinel-pulse': 'sentinelPulse 3s ease-in-out infinite',
        'legend-glow': 'legendGlow 6s linear infinite',
      },
```

- [ ] **Step 2: Add the rotating conic-gradient border for Legend tier to `app/globals.css`**

Tailwind can't animate `conic-gradient` natively — add a plain CSS block at the end of the file (after the existing `@layer base` block, top-level so `@property` is valid):

```css
/* HexAvatar — Legend tier animated border (see docs/superpowers/specs/2026-08-15-hex-avatar-design.md §5.3) */
@property --legend-angle {
  syntax: '<angle>';
  initial-value: 0deg;
  inherits: false;
}
.hexavatar-legend-border {
  background: conic-gradient(from var(--legend-angle), #EF4444, #F59E0B, #EF4444);
  animation: hexavatar-legend-spin 6s linear infinite;
}
@keyframes hexavatar-legend-spin {
  to { --legend-angle: 360deg; }
}
```

- [ ] **Step 3: Verify build picks up the config**

Run: `npm run build 2>&1 | tail -30`
Expected: build succeeds (Tailwind config changes don't error; nothing references the new classes yet so no visual check possible until A4).

- [ ] **Step 4: Commit**

```bash
git add tailwind.config.ts app/globals.css
git commit -m "feat(hexavatar): add tier glow animations and legend gradient border CSS"
```

---

### Task A2: `lib/avatars/size.ts` — size constants

**Files:**
- Create: `lib/avatars/size.ts`
- Test: `lib/avatars/size.test.ts`

**Interfaces:**
- Produces: `HexAvatarSize` type, `SIZE_PX`, `BORDER_WIDTH_PX`, `hexHeight(widthPx: number): number` — consumed by A4.

- [ ] **Step 1: Write the failing test**

```ts
// lib/avatars/size.test.ts
import { describe, it, expect } from 'vitest'
import { SIZE_PX, BORDER_WIDTH_PX, hexHeight } from './size'

describe('hexHeight', () => {
  it('is width * 0.866 for every size key', () => {
    for (const width of Object.values(SIZE_PX)) {
      expect(hexHeight(width)).toBeCloseTo(width * 0.866, 5)
    }
  })
})

describe('SIZE_PX', () => {
  it('matches the spec sizes', () => {
    expect(SIZE_PX).toEqual({ xs: 28, sm: 40, md: 56, lg: 80, xl: 112 })
  })
})

describe('BORDER_WIDTH_PX', () => {
  it('matches the tier table', () => {
    expect(BORDER_WIDTH_PX).toEqual({ recruit: 2, guardian: 3, elite: 3, sentinel: 4, legend: 4 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/avatars/size.test.ts`
Expected: FAIL — `Cannot find module './size'`

- [ ] **Step 3: Write the implementation**

```ts
// lib/avatars/size.ts
import type { MembershipTier } from '@/lib/membership/tiers'

export type HexAvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

// Avatar hex diameter (width) in px per size key — spec §4.
export const SIZE_PX: Record<HexAvatarSize, number> = {
  xs: 28,
  sm: 40,
  md: 56,
  lg: 80,
  xl: 112,
}

// Tier frame border width in px — spec §2.
export const BORDER_WIDTH_PX: Record<MembershipTier, number> = {
  recruit: 2,
  guardian: 3,
  elite: 3,
  sentinel: 4,
  legend: 4,
}

// Height of a flat-top regular hexagon = width * (√3/2).
export function hexHeight(widthPx: number): number {
  return widthPx * 0.866
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/avatars/size.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/avatars/size.ts lib/avatars/size.test.ts
git commit -m "feat(hexavatar): add size and border-width constants"
```

---

### Task A3: `lib/avatars/decorations.ts` — achievement decoration priority logic

**Files:**
- Create: `lib/avatars/decorations.ts`
- Test: `lib/avatars/decorations.test.ts`

**Interfaces:**
- Produces: `AchievementDecoration` type, `resolveDecorations(slugs: string[]): { topRight: AchievementDecoration | null; bottomRight: AchievementDecoration | null }` — consumed by A4.

- [ ] **Step 1: Write the failing test**

```ts
// lib/avatars/decorations.test.ts
import { describe, it, expect } from 'vitest'
import { resolveDecorations } from './decorations'

describe('resolveDecorations', () => {
  it('returns both null for an empty list', () => {
    expect(resolveDecorations([])).toEqual({ topRight: null, bottomRight: null })
  })

  it('picks the single matching decoration for each slot', () => {
    const r = resolveDecorations(['first_champion', 'win_streak_5'])
    expect(r.topRight?.slug).toBe('first_champion')
    expect(r.bottomRight?.slug).toBe('win_streak_5')
  })

  it('applies top-right priority: champions_cup_champion > masters_champion > champion_3x > first_champion', () => {
    expect(
      resolveDecorations(['first_champion', 'champion_3x', 'masters_champion', 'champions_cup_champion']).topRight
        ?.slug,
    ).toBe('champions_cup_champion')
    expect(resolveDecorations(['first_champion', 'champion_3x', 'masters_champion']).topRight?.slug).toBe(
      'masters_champion',
    )
    expect(resolveDecorations(['first_champion', 'champion_3x']).topRight?.slug).toBe('champion_3x')
  })

  it('applies bottom-right priority: win_streak_5 > matches_100', () => {
    expect(resolveDecorations(['matches_100', 'win_streak_5']).bottomRight?.slug).toBe('win_streak_5')
    expect(resolveDecorations(['matches_100']).bottomRight?.slug).toBe('matches_100')
  })

  it('ignores unknown slugs', () => {
    expect(resolveDecorations(['some_unrelated_slug'])).toEqual({ topRight: null, bottomRight: null })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/avatars/decorations.test.ts`
Expected: FAIL — `Cannot find module './decorations'`

- [ ] **Step 3: Write the implementation**

```ts
// lib/avatars/decorations.ts
// Achievement decoration badges layered on a HexAvatar's frame — spec §3.
// A player can show at most one badge per slot (top-right / bottom-right).

export type DecorationSlot = 'topRight' | 'bottomRight'

export interface AchievementDecoration {
  slug: string
  emoji: string
  colourClass: string // Tailwind background classes for the badge circle
  slot: DecorationSlot
}

// Ordered highest-priority-first within each slot — spec §3.
const TOP_RIGHT_PRIORITY: AchievementDecoration[] = [
  { slug: 'champions_cup_champion', emoji: '💎', colourClass: 'bg-gradient-to-br from-cyan-400 to-amber-400', slot: 'topRight' },
  { slug: 'masters_champion', emoji: '⭐', colourClass: 'bg-amber-500', slot: 'topRight' },
  { slug: 'champion_3x', emoji: '🔥', colourClass: 'bg-gradient-to-br from-orange-500 to-amber-400', slot: 'topRight' },
  { slug: 'first_champion', emoji: '👑', colourClass: 'bg-amber-500', slot: 'topRight' },
]
const BOTTOM_RIGHT_PRIORITY: AchievementDecoration[] = [
  { slug: 'win_streak_5', emoji: '⚡', colourClass: 'bg-sx-purple', slot: 'bottomRight' },
  { slug: 'matches_100', emoji: '🛡', colourClass: 'bg-slate-500', slot: 'bottomRight' },
]

export function resolveDecorations(slugs: string[]): {
  topRight: AchievementDecoration | null
  bottomRight: AchievementDecoration | null
} {
  const unlocked = new Set(slugs)
  return {
    topRight: TOP_RIGHT_PRIORITY.find((d) => unlocked.has(d.slug)) ?? null,
    bottomRight: BOTTOM_RIGHT_PRIORITY.find((d) => unlocked.has(d.slug)) ?? null,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/avatars/decorations.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/avatars/decorations.ts lib/avatars/decorations.test.ts
git commit -m "feat(hexavatar): add achievement decoration priority logic"
```

---

### Task A4: `components/shared/HexAvatar.tsx` — the component

**Files:**
- Create: `components/shared/HexAvatar.tsx`

**Interfaces:**
- Consumes: `MembershipTier` from `lib/membership/tiers.ts`; `SIZE_PX`, `BORDER_WIDTH_PX`, `hexHeight`, `HexAvatarSize` from `lib/avatars/size.ts`; `resolveDecorations` from `lib/avatars/decorations.ts`.
- Produces: `HexAvatar` component — `{ src, username, tier, achievements?, size?, avatarBorderClass?, className? }` — consumed by every task in Parts A (site-wide replacement), B (Dashboard), C (Hall of Fame).

- [ ] **Step 1: Write the component**

```tsx
// components/shared/HexAvatar.tsx
'use client'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { MembershipTier } from '@/lib/membership/tiers'
import { SIZE_PX, BORDER_WIDTH_PX, hexHeight, type HexAvatarSize } from '@/lib/avatars/size'
import { resolveDecorations } from '@/lib/avatars/decorations'

const HEX_CLIP = 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)'

const TIER_BORDER_COLOUR: Record<MembershipTier, string> = {
  recruit: '#64748B',
  guardian: '#3B82F6',
  elite: '#7C3AED',
  sentinel: '#F59E0B',
  legend: '', // uses .hexavatar-legend-border conic-gradient instead of a flat colour
}

const TIER_GLOW_CLASS: Record<MembershipTier, string> = {
  recruit: '',
  guardian: 'drop-shadow-[0_0_8px_rgba(59,130,246,0.6)]',
  elite: 'drop-shadow-[0_0_12px_rgba(124,58,237,0.7)]',
  sentinel: 'drop-shadow-[0_0_16px_rgba(245,158,11,0.75)] animate-sentinel-pulse',
  legend: 'drop-shadow-[0_0_20px_rgba(239,68,68,0.8)] animate-legend-glow',
}

export interface HexAvatarProps {
  src: string | null
  username: string
  tier: MembershipTier
  /** Unlocked achievement slugs already in scope on the parent page — decorations are derived from these. */
  achievements?: string[]
  size?: HexAvatarSize
  /** Equipped `avatar_border` store cosmetic (a `ring-*`/`shadow-*` Tailwind class) — see lib/store/cosmetics.ts. */
  avatarBorderClass?: string
  className?: string
}

export function HexAvatar({
  src,
  username,
  tier,
  achievements = [],
  size = 'md',
  avatarBorderClass,
  className,
}: HexAvatarProps) {
  const [errored, setErrored] = useState(false)
  const widthPx = SIZE_PX[size]
  const heightPx = hexHeight(widthPx)
  const borderPx = BORDER_WIDTH_PX[tier]
  const showImage = src && !errored
  const initials = username.slice(0, 2).toUpperCase()
  const { topRight, bottomRight } = resolveDecorations(achievements)
  const badgeSize = Math.max(14, Math.round(widthPx * 0.28))

  return (
    <div
      className={cn('relative inline-block shrink-0', TIER_GLOW_CLASS[tier], avatarBorderClass, className)}
      style={{ width: widthPx, height: heightPx }}
    >
      {/* Outer hex — the tier-coloured "border" */}
      <div
        className={cn('absolute inset-0', tier === 'legend' && 'hexavatar-legend-border')}
        style={{ clipPath: HEX_CLIP, backgroundColor: tier === 'legend' ? undefined : TIER_BORDER_COLOUR[tier] }}
      />
      {/* Inner hex — the avatar, inset by the tier's border width */}
      <div className="absolute overflow-hidden" style={{ clipPath: HEX_CLIP, inset: borderPx }}>
        {showImage ? (
          // eslint-disable-next-line @next/next/no-img-element -- Supabase Storage URLs aren't in next.config's image domains
          <img
            src={src}
            alt={username}
            width={widthPx}
            height={heightPx}
            className="h-full w-full object-cover"
            onError={() => setErrored(true)}
          />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center bg-sx-surface font-display font-bold text-white"
            style={{ fontSize: Math.round(widthPx * 0.32) }}
          >
            {initials}
          </div>
        )}
      </div>

      {topRight && (
        <span
          className={cn(
            'absolute right-0 top-0 flex -translate-y-1/3 translate-x-1/3 items-center justify-center rounded-full ring-2 ring-white',
            topRight.colourClass,
          )}
          style={{ width: badgeSize, height: badgeSize, fontSize: Math.round(badgeSize * 0.6) }}
          title={topRight.slug}
        >
          {topRight.emoji}
        </span>
      )}
      {bottomRight && (
        <span
          className={cn(
            'absolute bottom-0 right-0 flex translate-y-1/3 translate-x-1/3 items-center justify-center rounded-full ring-2 ring-white',
            bottomRight.colourClass,
          )}
          style={{ width: badgeSize, height: badgeSize, fontSize: Math.round(badgeSize * 0.6) }}
          title={bottomRight.slug}
        >
          {bottomRight.emoji}
        </span>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Check `lib/utils.ts` has a `cn` helper**

Run: `grep -n "export function cn" lib/utils.ts`
Expected: a match (shadcn/ui projects always have this — if missing, add the standard `clsx` + `tailwind-merge` implementation before proceeding).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors from `components/shared/HexAvatar.tsx`.

- [ ] **Step 4: Commit**

```bash
git add components/shared/HexAvatar.tsx
git commit -m "feat(hexavatar): add HexAvatar component with tier frames and decorations"
```

---

### Task A5: Wire HexAvatar into `ProfileHeader.tsx` (player profile, `xl`)

**Files:**
- Modify: `components/player/ProfileHeader.tsx`
- Modify: `app/(public)/players/[username]/page.tsx`

**Interfaces:**
- Consumes: `HexAvatar` from A4.

- [ ] **Step 1: Pass unlocked achievement slugs from the page to `ProfileHeader`**

In `app/(public)/players/[username]/page.tsx`, the page already builds `achievementCells` (with `.slug` and `.unlocked`) from `rawAchievements`/`rawPlayerAchievements` — no new query needed. Add a derived list right after `achievementCells` is built:

```ts
  const unlockedSlugs = achievementCells.filter((a) => a.unlocked).map((a) => a.slug)
```

Then pass it into `<ProfileHeader ... achievements={unlockedSlugs} />`.

- [ ] **Step 2: Replace the `<Avatar>` in `ProfileHeader.tsx`**

```tsx
import { HexAvatar } from '@/components/shared/HexAvatar'
import type { MembershipTier } from '@/lib/membership/tiers'
```

Add `achievements` to the props type (`achievements?: string[]`), then replace:

```tsx
        <Avatar
          avatarUrl={profile.avatarUrl}
          displayName={profile.displayName}
          username={profile.username}
          size={80}
          className={`border-2 border-sx-purple/50 text-3xl ${avatarBorderClass ?? ''}`}
        />
```

with:

```tsx
        <HexAvatar
          src={profile.avatarUrl}
          username={profile.displayName ?? profile.username}
          tier={(profile.membershipTier ?? 'recruit') as MembershipTier}
          achievements={achievements}
          size="xl"
          avatarBorderClass={avatarBorderClass}
        />
```

Remove the now-unused `import { Avatar } from '@/components/shared/Avatar'` line if `Avatar` isn't referenced elsewhere in the file.

- [ ] **Step 3: Typecheck and build**

Run: `npx tsc --noEmit && npm run build 2>&1 | tail -30`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/player/ProfileHeader.tsx "app/(public)/players/[username]/page.tsx"
git commit -m "feat(hexavatar): replace player profile avatar with HexAvatar (xl)"
```

---

### Task A6: Wire HexAvatar into `LeaderboardTable.tsx` (rankings rows, `xs`)

**Files:**
- Modify: `components/rankings/LeaderboardTable.tsx`

**Interfaces:**
- Consumes: `HexAvatar` from A4. `RankedPlayer` (from `lib/rankings/leaderboard.ts`) already carries `avatarUrl` and `membershipTier` — no query change needed.

- [ ] **Step 1: Replace the inline initials circle**

```tsx
import { HexAvatar } from '@/components/shared/HexAvatar'
import type { MembershipTier } from '@/lib/membership/tiers'
```

Replace:

```tsx
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-bold text-white">
                        {initial}
                      </div>
```

with:

```tsx
                      <HexAvatar
                        src={pl.avatarUrl}
                        username={name}
                        tier={(pl.membershipTier ?? 'recruit') as MembershipTier}
                        size="xs"
                      />
```

Remove the now-unused `const initial = (name[0] ?? '?').toUpperCase()` line.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/rankings/LeaderboardTable.tsx
git commit -m "feat(hexavatar): replace rankings row avatar with HexAvatar (xs)"
```

---

### Task A7: Wire HexAvatar into `PlayerCard.tsx` (players directory rows, `xs`)

**Files:**
- Modify: `components/player/PlayerCard.tsx`
- Modify: `app/(public)/players/page.tsx`

**Interfaces:**
- Consumes: `HexAvatar` from A4.
- Produces: `PlayerCardData.membershipTier: string` — new required field.

- [ ] **Step 1: Check how `PlayerCardData` rows are built today**

Run: `grep -n "membership_tier\|PlayerCardData" "app/(public)/players/page.tsx"`
If `membership_tier` isn't already selected from `profiles`, add it to that page's select list and to the object literal that builds each `PlayerCardData`.

- [ ] **Step 2: Update `PlayerCardData` and swap the avatar**

```tsx
import { HexAvatar } from '@/components/shared/HexAvatar'
import type { MembershipTier } from '@/lib/membership/tiers'

export interface PlayerCardData {
  username: string
  display_name: string | null
  avatar_url: string | null
  sx_score: number
  sentinel_tier: string | null
  membership_tier: string
}
```

Replace:

```tsx
      <Avatar
        avatarUrl={player.avatar_url}
        displayName={player.display_name}
        username={player.username}
        size={44}
      />
```

with:

```tsx
      <HexAvatar
        src={player.avatar_url}
        username={player.display_name ?? player.username}
        tier={(player.membership_tier ?? 'recruit') as MembershipTier}
        size="xs"
      />
```

- [ ] **Step 3: Typecheck and build**

Run: `npx tsc --noEmit && npm run build 2>&1 | tail -30`
Expected: no errors (a compile error here means the `app/(public)/players/page.tsx` query/mapping wasn't updated in Step 1 — fix it there).

- [ ] **Step 4: Commit**

```bash
git add components/player/PlayerCard.tsx "app/(public)/players/page.tsx"
git commit -m "feat(hexavatar): replace players-directory avatar with HexAvatar (xs)"
```

---

### Task A8: Wire HexAvatar into Match Centre (`md`)

**Files:**
- Modify: `app/(public)/matches/[id]/page.tsx`

**Interfaces:**
- Consumes: `HexAvatar` from A4.

- [ ] **Step 1: Extend the match query and `ProfileRef` type**

```ts
type ProfileRef = { username: string | null; display_name: string | null; avatar_url: string | null; membership_tier: string | null } | null
```

Update `MATCH_SELECT`'s two profile embeds:

```ts
  'player_a:profiles!matches_player_a_id_fkey(username, display_name, avatar_url, membership_tier), ' +
  'player_b:profiles!matches_player_b_id_fkey(username, display_name, avatar_url, membership_tier)'
```

- [ ] **Step 2: Render HexAvatar above each player name**

```tsx
import { HexAvatar } from '@/components/shared/HexAvatar'
import type { MembershipTier } from '@/lib/membership/tiers'
```

Replace the existing block:

```tsx
          <p className="flex-1 text-right text-lg font-bold text-white">{nameOf(m.player_a)}</p>
          <span className="...">
            {showScore ? `${m.score_a} – ${m.score_b}` : 'vs'}
          </span>
          <p className="flex-1 text-left text-lg font-bold text-white">{nameOf(m.player_b)}</p>
```

with (keep whatever wrapping `<div>`/className the score badge already has — only the two player cells change shape, from a `<p>` to a small avatar+name stack):

```tsx
          <div className="flex flex-1 flex-col items-center gap-2 sm:flex-row sm:justify-end">
            <HexAvatar
              src={m.player_a?.avatar_url ?? null}
              username={nameOf(m.player_a)}
              tier={(m.player_a?.membership_tier ?? 'recruit') as MembershipTier}
              size="md"
            />
            <p className="text-lg font-bold text-white">{nameOf(m.player_a)}</p>
          </div>
          <span className="...">
            {showScore ? `${m.score_a} – ${m.score_b}` : 'vs'}
          </span>
          <div className="flex flex-1 flex-col items-center gap-2 sm:flex-row">
            <HexAvatar
              src={m.player_b?.avatar_url ?? null}
              username={nameOf(m.player_b)}
              tier={(m.player_b?.membership_tier ?? 'recruit') as MembershipTier}
              size="md"
            />
            <p className="text-lg font-bold text-white">{nameOf(m.player_b)}</p>
          </div>
```

Keep the middle `<span>`'s existing className exactly as it was — only the two side cells are being touched.

- [ ] **Step 3: Typecheck and build**

Run: `npx tsc --noEmit && npm run build 2>&1 | tail -30`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "app/(public)/matches/[id]/page.tsx"
git commit -m "feat(hexavatar): add player avatars to Match Centre (md)"
```

---

### Task A9: Wire HexAvatar into Admin players list (`xs`)

**Files:**
- Modify: `app/admin/players/page.tsx`

**Interfaces:**
- Consumes: `HexAvatar` from A4.

- [ ] **Step 1: Add `avatar_url` to the query**

```ts
  const { data: players } = await admin
    .from('profiles')
    .select('id, username, display_name, avatar_url, sx_score, membership_tier, total_matches')
    .order('username')
```

- [ ] **Step 2: Add an avatar column**

```tsx
import { HexAvatar } from '@/components/shared/HexAvatar'
import type { MembershipTier } from '@/lib/membership/tiers'
```

Replace the `Player` cell:

```tsx
                <td className="py-2">{p.display_name ?? p.username}</td>
```

with:

```tsx
                <td className="flex items-center gap-2 py-2">
                  <HexAvatar
                    src={p.avatar_url}
                    username={p.display_name ?? p.username ?? '?'}
                    tier={(p.membership_tier ?? 'recruit') as MembershipTier}
                    size="xs"
                  />
                  {p.display_name ?? p.username}
                </td>
```

- [ ] **Step 3: Typecheck and build**

Run: `npx tsc --noEmit && npm run build 2>&1 | tail -30`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/admin/players/page.tsx
git commit -m "feat(hexavatar): add avatars to admin players list (xs)"
```

---

## Part B — Dashboard Overhaul

### Task B1: `lib/dashboard/command-centre.ts` — pure display helpers

**Files:**
- Create: `lib/dashboard/command-centre.ts`
- Test: `lib/dashboard/command-centre.test.ts`

**Interfaces:**
- Consumes: `MembershipTier`, `computeTier`, `TIER_XP_THRESHOLDS` from `lib/membership/tiers.ts`.
- Produces: `winRatePercent`, `xpToNextTierLabel`, `streakMilestonePreview`, `seasonQualifyProgress` — consumed by B4 (Hero), B10 (SeasonStandingCard), B11 (ProgressCard).

- [ ] **Step 1: Write the failing test**

```ts
// lib/dashboard/command-centre.test.ts
import { describe, it, expect } from 'vitest'
import { winRatePercent, xpToNextTierLabel, streakMilestonePreview, seasonQualifyProgress } from './command-centre'

describe('winRatePercent', () => {
  it('rounds to the nearest whole percent', () => {
    expect(winRatePercent(3, 4)).toBe(75)
  })
  it('is 0 for zero matches', () => {
    expect(winRatePercent(0, 0)).toBe(0)
  })
})

describe('xpToNextTierLabel', () => {
  it('reports XP remaining to the next tier', () => {
    expect(xpToNextTierLabel(4380)).toBe('620 XP to Elite')
  })
  it('reports MAX at Legend', () => {
    expect(xpToNextTierLabel(60000)).toBe('MAX — LEGEND')
  })
})

describe('streakMilestonePreview', () => {
  it('previews +50 coins on day 6 (tomorrow is day 7)', () => {
    expect(streakMilestonePreview(6)).toBe('+50 coins tomorrow')
  })
  it('previews +200 coins on day 29 (tomorrow is day 30)', () => {
    expect(streakMilestonePreview(29)).toBe('+200 coins tomorrow')
  })
  it('is null off-milestone', () => {
    expect(streakMilestonePreview(3)).toBeNull()
  })
})

describe('seasonQualifyProgress', () => {
  it('reports points needed when outside the top 16', () => {
    expect(seasonQualifyProgress(20, 340, 500)).toEqual({ qualified: false, pointsNeeded: 160 })
  })
  it('reports qualified with no points needed inside the top 16', () => {
    expect(seasonQualifyProgress(12, 340, 500)).toEqual({ qualified: true, pointsNeeded: 0 })
  })
  it('treats a null rank as not qualified', () => {
    expect(seasonQualifyProgress(null, 0, 500)).toEqual({ qualified: false, pointsNeeded: 500 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/dashboard/command-centre.test.ts`
Expected: FAIL — `Cannot find module './command-centre'`

- [ ] **Step 3: Write the implementation**

```ts
// lib/dashboard/command-centre.ts
import { computeTier, TIER_XP_THRESHOLDS, type MembershipTier } from '@/lib/membership/tiers'

const NEXT_TIER: Record<MembershipTier, MembershipTier | null> = {
  recruit: 'guardian',
  guardian: 'elite',
  elite: 'sentinel',
  sentinel: 'legend',
  legend: null,
}
const TIER_LABEL: Record<MembershipTier, string> = {
  recruit: 'Recruit',
  guardian: 'Guardian',
  elite: 'Elite',
  sentinel: 'Sentinel',
  legend: 'Legend',
}

export function winRatePercent(wins: number, totalMatches: number): number {
  return totalMatches > 0 ? Math.round((wins / totalMatches) * 100) : 0
}

// "620 XP to Elite" / "MAX — LEGEND" — hero XP bar label, spec §2 Section 1.
export function xpToNextTierLabel(xp: number): string {
  const tier = computeTier(xp)
  const next = NEXT_TIER[tier]
  if (!next) return 'MAX — LEGEND'
  return `${(TIER_XP_THRESHOLDS[next] - xp).toLocaleString()} XP to ${TIER_LABEL[next]}`
}

// Login-streak coin-bonus preview shown one day ahead of a milestone —
// spec §2 Section 5: "+50 coins tomorrow" on day 6, "+200 coins tomorrow" on day 29.
// (Milestone reward days themselves — 7 and 30 — live in the login-streak reward
// logic; this only previews them a day early.)
export function streakMilestonePreview(currentStreak: number): string | null {
  const tomorrow = currentStreak + 1
  if (tomorrow === 7) return '+50 coins tomorrow'
  if (tomorrow === 30) return '+200 coins tomorrow'
  return null
}

// Season Standing card's qualification bar — spec §2 Section 4.
export function seasonQualifyProgress(
  rank: number | null,
  currentPoints: number,
  pointsOfRankSixteen: number,
): { qualified: boolean; pointsNeeded: number } {
  if (rank != null && rank <= 16) return { qualified: true, pointsNeeded: 0 }
  return { qualified: false, pointsNeeded: Math.max(0, pointsOfRankSixteen - currentPoints) }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/dashboard/command-centre.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard/command-centre.ts lib/dashboard/command-centre.test.ts
git commit -m "feat(dashboard): add command-centre display helpers"
```

---

### Task B2: `lib/dashboard/countdown.ts` — next-match countdown formatter

**Files:**
- Create: `lib/dashboard/countdown.ts`
- Test: `lib/dashboard/countdown.test.ts`

**Interfaces:**
- Consumes: `formatDate` from `lib/format.ts`.
- Produces: `formatCountdown(scheduledAtIso: string, now: Date): string` — consumed by B3 (`CountdownChip`).

- [ ] **Step 1: Write the failing test**

```ts
// lib/dashboard/countdown.test.ts
import { describe, it, expect } from 'vitest'
import { formatCountdown } from './countdown'

// now = 2026-08-15T10:00:00Z = 11:00 WAT
const NOW = new Date('2026-08-15T10:00:00Z')

describe('formatCountdown', () => {
  it('shows minutes under an hour away', () => {
    expect(formatCountdown('2026-08-15T10:30:00Z', NOW)).toBe('In 30m')
  })
  it('shows hours and minutes under 6h away', () => {
    expect(formatCountdown('2026-08-15T11:30:00Z', NOW)).toBe('In 1h 30m')
  })
  it('drops the minutes when exactly on the hour', () => {
    expect(formatCountdown('2026-08-15T12:00:00Z', NOW)).toBe('In 2h')
  })
  it('shows "Today <time>" for later today (WAT), 6h+ away', () => {
    // 2026-08-15T21:00:00Z = 22:00 WAT, still 15 Aug in WAT
    expect(formatCountdown('2026-08-15T21:00:00Z', NOW)).toBe('Today 10:00 PM')
  })
  it('shows "Tomorrow <time>" for the next WAT calendar day', () => {
    // 2026-08-16T19:00:00Z = 20:00 WAT on 16 Aug
    expect(formatCountdown('2026-08-16T19:00:00Z', NOW)).toBe('Tomorrow 8:00 PM')
  })
  it('falls back to a plain date further out', () => {
    expect(formatCountdown('2026-08-20T19:00:00Z', NOW)).toBe('20 Aug 2026')
  })
  it('shows "Starting soon" once the scheduled time has passed', () => {
    expect(formatCountdown('2026-08-15T09:00:00Z', NOW)).toBe('Starting soon')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/dashboard/countdown.test.ts`
Expected: FAIL — `Cannot find module './countdown'`

- [ ] **Step 3: Write the implementation**

```ts
// lib/dashboard/countdown.ts
import { formatDate } from '@/lib/format'

const TZ = 'Africa/Lagos'

function watDayKey(d: Date): string {
  return d.toLocaleDateString('sv-SE', { timeZone: TZ })
}
function watTimeLabel(d: Date): string {
  return d.toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true })
}

// Dashboard NextMatchCard's countdown chip text — spec §2 Section 2.
export function formatCountdown(scheduledAtIso: string, now: Date): string {
  const target = new Date(scheduledAtIso)
  const diffMs = target.getTime() - now.getTime()
  if (diffMs <= 0) return 'Starting soon'

  const diffMinutes = Math.floor(diffMs / 60_000)
  if (diffMinutes < 60) return `In ${diffMinutes}m`

  const diffHours = diffMinutes / 60
  if (diffHours < 6) {
    const h = Math.floor(diffHours)
    const m = diffMinutes % 60
    return m > 0 ? `In ${h}h ${m}m` : `In ${h}h`
  }

  const todayKey = watDayKey(now)
  const targetKey = watDayKey(target)
  const tomorrowKey = watDayKey(new Date(now.getTime() + 86_400_000))
  const timeLabel = watTimeLabel(target)

  if (targetKey === todayKey) return `Today ${timeLabel}`
  if (targetKey === tomorrowKey) return `Tomorrow ${timeLabel}`
  return formatDate(scheduledAtIso) ?? 'Upcoming'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/dashboard/countdown.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard/countdown.ts lib/dashboard/countdown.test.ts
git commit -m "feat(dashboard): add next-match countdown formatter"
```

---

### Task B3: `components/dashboard/CountdownChip.tsx` — the one client component

**Files:**
- Create: `components/dashboard/CountdownChip.tsx`

**Interfaces:**
- Consumes: `formatCountdown` from B2.
- Produces: `CountdownChip({ scheduledAt: string })` — consumed by B8 (`NextMatchCard`).

- [ ] **Step 1: Write the component**

```tsx
// components/dashboard/CountdownChip.tsx
'use client'
import { useEffect, useState } from 'react'
import { formatCountdown } from '@/lib/dashboard/countdown'

// The only client component in the Dashboard overhaul (spec §4) — everything
// else stays server-rendered. Ticks every 30s; a full-minute countdown
// doesn't need finer granularity than that.
export function CountdownChip({ scheduledAt }: { scheduledAt: string }) {
  const [label, setLabel] = useState(() => formatCountdown(scheduledAt, new Date()))

  useEffect(() => {
    const tick = () => setLabel(formatCountdown(scheduledAt, new Date()))
    tick()
    const id = setInterval(tick, 30_000)
    return () => clearInterval(id)
  }, [scheduledAt])

  return <span className="text-xs font-bold uppercase tracking-wide text-sx-purple-text">{label}</span>
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/CountdownChip.tsx
git commit -m "feat(dashboard): add CountdownChip client component"
```

---

### Task B4: `components/dashboard/HeroIdentityPanel.tsx`

**Files:**
- Create: `components/dashboard/HeroIdentityPanel.tsx`

**Interfaces:**
- Consumes: `HexAvatar` (A4), `xpToNextTierLabel` (B1), `TIER_XP_THRESHOLDS`/`computeTier`/`MembershipTier` (`lib/membership/tiers.ts`).
- Produces: `HeroIdentityPanel` — consumed by B14 (`app/dashboard/page.tsx`).

- [ ] **Step 1: Write the component**

```tsx
// components/dashboard/HeroIdentityPanel.tsx
import { HexAvatar } from '@/components/shared/HexAvatar'
import { computeTier, TIER_XP_THRESHOLDS, type MembershipTier } from '@/lib/membership/tiers'
import { xpToNextTierLabel } from '@/lib/dashboard/command-centre'

const TIER_LABEL: Record<MembershipTier, string> = {
  recruit: 'Recruit',
  guardian: 'Guardian',
  elite: 'Elite',
  sentinel: 'Sentinel',
  legend: 'Legend',
}
const TIER_CHIP_CLASS: Record<MembershipTier, string> = {
  recruit: 'bg-slate-700 text-slate-200',
  guardian: 'bg-blue-500/20 text-blue-300',
  elite: 'bg-sx-purple/20 text-sx-purple-text',
  sentinel: 'bg-amber-500/20 text-amber-300',
  legend: 'bg-gradient-to-r from-red-500/30 to-amber-400/30 text-amber-200',
}
const TIER_BAR_CLASS: Record<MembershipTier, string> = {
  recruit: 'bg-slate-500',
  guardian: 'bg-blue-500',
  elite: 'bg-sx-purple',
  sentinel: 'bg-amber-500',
  legend: 'bg-gradient-to-r from-red-500 to-amber-400',
}

export function HeroIdentityPanel({
  avatarUrl,
  displayName,
  achievements,
  xp,
  sxScore,
  seasonRank,
  loginStreak,
}: {
  avatarUrl: string | null
  displayName: string
  achievements: string[]
  xp: number
  sxScore: number
  seasonRank: number | null
  loginStreak: number
}) {
  const tier = computeTier(xp)
  const next = tier === 'legend' ? null : Object.entries(TIER_XP_THRESHOLDS).find(([, v]) => v > xp)?.[0]
  const floor = TIER_XP_THRESHOLDS[tier]
  const ceiling = next ? TIER_XP_THRESHOLDS[next as MembershipTier] : null
  const pct = ceiling ? Math.min(100, Math.round(((xp - floor) / (ceiling - floor)) * 100)) : 100

  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-sx-border p-6"
      style={{ background: 'radial-gradient(ellipse at top left, rgba(124,58,237,0.3), transparent 70%), #0B0B0F' }}
    >
      <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:items-start sm:text-left">
        <HexAvatar src={avatarUrl} username={displayName} tier={tier} achievements={achievements} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
            <p className="font-display text-3xl font-black uppercase text-white">Welcome back, {displayName}</p>
            <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase ${TIER_CHIP_CLASS[tier]}`}>
              {TIER_LABEL[tier]}
            </span>
          </div>
          {loginStreak >= 2 && <p className="mt-1 text-sm font-semibold text-amber-400">🔥 {loginStreak}-day streak</p>}

          <div className="mt-4 flex justify-center gap-8 border-t border-sx-border pt-4 sm:justify-start">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-sx-gray">SX Score</p>
              <p className="font-display text-xl font-black text-white">{sxScore.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-sx-gray">Season Rank</p>
              <p className="font-display text-xl font-black text-white">{seasonRank != null ? `#${seasonRank}` : 'Unranked'}</p>
            </div>
          </div>

          <div className="mt-4">
            <div className="h-2 overflow-hidden rounded-full bg-slate-800">
              <div className={`h-full rounded-full transition-all ${TIER_BAR_CLASS[tier]}`} style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-1.5 text-xs text-sx-gray">{xpToNextTierLabel(xp)}</p>
          </div>
        </div>
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
git add components/dashboard/HeroIdentityPanel.tsx
git commit -m "feat(dashboard): add HeroIdentityPanel (Section 1)"
```

---

### Task B5: `lib/dashboard/recent-matches.ts` — pure mapper for the last 5 completed matches

**Files:**
- Create: `lib/dashboard/recent-matches.ts`
- Test: `lib/dashboard/recent-matches.test.ts`

**Interfaces:**
- Produces: `RecentMatchRow`, `mapRecentMatches(rows, myPlayerId): RecentMatchRow[]` — consumed by B6 (`RecentMatchesCard`) and B14 (page query mapping).

- [ ] **Step 1: Write the failing test**

```ts
// lib/dashboard/recent-matches.test.ts
import { describe, it, expect } from 'vitest'
import { mapRecentMatches, type RawRecentMatchRow } from './recent-matches'

const base: RawRecentMatchRow = {
  id: 'm1',
  player_a_id: 'me',
  player_b_id: 'opp',
  score_a: 3,
  score_b: 1,
  updated_at: '2026-08-12T00:00:00Z',
  opponentName: 'HIM',
  opponentUsername: 'him',
  tournamentTitle: 'Community Club #2',
}

describe('mapRecentMatches', () => {
  it('marks a win when I am player A with the higher score', () => {
    expect(mapRecentMatches([base], 'me')[0]).toMatchObject({ outcome: 'win', myScore: 3, opponentScore: 1 })
  })
  it('marks a loss when I am player B with the lower score', () => {
    const row = { ...base, player_a_id: 'opp', player_b_id: 'me', score_a: 3, score_b: 1 }
    expect(mapRecentMatches([row], 'me')[0]).toMatchObject({ outcome: 'loss', myScore: 1, opponentScore: 3 })
  })
  it('skips rows with a null score', () => {
    expect(mapRecentMatches([{ ...base, score_a: null }], 'me')).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/dashboard/recent-matches.test.ts`
Expected: FAIL — `Cannot find module './recent-matches'`

- [ ] **Step 3: Write the implementation**

```ts
// lib/dashboard/recent-matches.ts
export interface RawRecentMatchRow {
  id: string
  player_a_id: string | null
  player_b_id: string | null
  score_a: number | null
  score_b: number | null
  updated_at: string | null
  opponentName: string
  opponentUsername: string | null
  tournamentTitle: string
}

export interface RecentMatchRow {
  id: string
  outcome: 'win' | 'loss' | 'draw'
  myScore: number
  opponentScore: number
  opponentName: string
  opponentUsername: string | null
  tournamentTitle: string
  updatedAt: string | null
}

// Section 6 "Recent Matches" — spec §2. Rows without a decided score
// (e.g. a still-pending admin ruling) are skipped rather than guessed at.
export function mapRecentMatches(rows: RawRecentMatchRow[], myPlayerId: string): RecentMatchRow[] {
  return rows.flatMap((r) => {
    if (r.score_a == null || r.score_b == null) return []
    const isA = r.player_a_id === myPlayerId
    const myScore = isA ? r.score_a : r.score_b
    const opponentScore = isA ? r.score_b : r.score_a
    const outcome = myScore > opponentScore ? 'win' : myScore < opponentScore ? 'loss' : 'draw'
    return [
      {
        id: r.id,
        outcome,
        myScore,
        opponentScore,
        opponentName: r.opponentName,
        opponentUsername: r.opponentUsername,
        tournamentTitle: r.tournamentTitle,
        updatedAt: r.updated_at,
      },
    ]
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/dashboard/recent-matches.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard/recent-matches.ts lib/dashboard/recent-matches.test.ts
git commit -m "feat(dashboard): add recent-matches pure mapper"
```

---

### Task B6: `components/dashboard/RecentMatchesCard.tsx`

**Files:**
- Create: `components/dashboard/RecentMatchesCard.tsx`

**Interfaces:**
- Consumes: `RecentMatchRow` from B5; `formatDate` from `lib/format.ts`.
- Produces: `RecentMatchesCard` — consumed by B14.

- [ ] **Step 1: Write the component**

```tsx
// components/dashboard/RecentMatchesCard.tsx
import Link from 'next/link'
import { formatDate } from '@/lib/format'
import type { RecentMatchRow } from '@/lib/dashboard/recent-matches'

const RESULT_PILL: Record<RecentMatchRow['outcome'], string> = {
  win: 'bg-emerald-500/15 text-emerald-400',
  loss: 'bg-red-500/15 text-red-400',
  draw: 'bg-slate-500/15 text-slate-300',
}

export function RecentMatchesCard({ matches, username }: { matches: RecentMatchRow[]; username: string | null }) {
  return (
    <section className="rounded-2xl border border-sx-border bg-sx-surface p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wide text-white">Recent Matches</h2>
        {username && (
          <Link href={`/players/${username}#match-history`} className="text-xs font-semibold text-sx-purple-text hover:text-sx-purple-light">
            View All →
          </Link>
        )}
      </div>
      {matches.length === 0 ? (
        <p className="text-sm text-sx-gray">Your match history will appear here after your first game.</p>
      ) : (
        <div className="divide-y divide-sx-border">
          {matches.map((m) => (
            <div key={m.id} className="flex items-center gap-3 py-2.5 text-sm">
              <span className={`w-12 shrink-0 rounded-full py-0.5 text-center text-[11px] font-bold uppercase ${RESULT_PILL[m.outcome]}`}>
                {m.outcome}
              </span>
              <p className="min-w-0 flex-1 truncate text-white">
                vs{' '}
                {m.opponentUsername ? (
                  <Link href={`/players/${m.opponentUsername}`} className="hover:text-sx-purple-text">
                    {m.opponentName}
                  </Link>
                ) : (
                  m.opponentName
                )}
              </p>
              <p className="shrink-0 font-bold text-white">
                {m.myScore}–{m.opponentScore}
              </p>
              <p className="hidden shrink-0 truncate text-xs text-sx-gray sm:block">{m.tournamentTitle}</p>
              <p className="shrink-0 text-xs text-sx-gray">{formatDate(m.updatedAt)}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/RecentMatchesCard.tsx
git commit -m "feat(dashboard): add RecentMatchesCard (Section 6)"
```

---

### Task B7: `components/dashboard/NextMatchInvitationCard.tsx` — State C (pending invitation)

**Files:**
- Create: `components/dashboard/NextMatchInvitationCard.tsx`

**Interfaces:**
- Consumes: `acceptMastersInvitation`, `declineMastersInvitation`, `InvitationResponseState` from `lib/seasons/player-actions.ts`; `formatNaira` from `lib/format.ts`.
- Produces: `NextMatchInvitationCard` — consumed by B8. Replaces the old `MastersInvitationBanner` usage on the dashboard (component retired in B14's cleanup step).

- [ ] **Step 1: Write the component**

```tsx
// components/dashboard/NextMatchInvitationCard.tsx
'use client'
import { useFormState, useFormStatus } from 'react-dom'
import { acceptMastersInvitation, declineMastersInvitation, type InvitationResponseState } from '@/lib/seasons/player-actions'
import { formatNaira } from '@/lib/format'

function AcceptButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex-1 rounded-xl bg-amber-500 px-5 py-3 text-sm font-bold text-black transition-colors hover:bg-amber-400 disabled:opacity-60"
    >
      {pending ? 'Processing…' : 'Accept & Pay'}
    </button>
  )
}

// Dashboard Section 2, State C — spec §2: replaces the NextMatchCard slot
// entirely (same position, same prominence) when a Masters/Champions Cup
// invitation is pending.
export function NextMatchInvitationCard({
  invitation,
}: {
  invitation: { id: string; rank: number; deadline: string; tournamentTitle: string; fee: number }
}) {
  const [acceptState, acceptAction] = useFormState<InvitationResponseState, FormData>(acceptMastersInvitation, undefined)
  const [declineState, declineAction] = useFormState<InvitationResponseState, FormData>(declineMastersInvitation, undefined)

  if (declineState?.success) return null

  const hoursLeft = Math.max(0, Math.round((new Date(invitation.deadline).getTime() - Date.now()) / 3_600_000))

  return (
    <div
      className="rounded-2xl border border-amber-500/50 bg-sx-surface p-5"
      style={{ boxShadow: '0 0 24px rgba(245,158,11,0.25)' }}
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-amber-300">🏆 You&apos;ve been invited to {invitation.tournamentTitle}!</p>
        <span className="text-xs font-bold uppercase text-amber-400">Expires in {hoursLeft}h</span>
      </div>
      <p className="mt-1 text-sm text-sx-gray">
        You ranked #{invitation.rank} in {new Date().toLocaleDateString('en-US', { month: 'long' })}.{' '}
        {invitation.fee > 0 ? `Entry fee: ${formatNaira(invitation.fee)}.` : 'Free entry.'}
      </p>
      <div className="mt-4 flex gap-2">
        <form action={acceptAction} className="flex-1">
          <input type="hidden" name="invitationId" value={invitation.id} />
          <AcceptButton />
        </form>
        <form action={declineAction}>
          <input type="hidden" name="invitationId" value={invitation.id} />
          <button
            type="submit"
            className="rounded-xl border border-slate-700 px-5 py-3 text-sm font-bold text-slate-300 hover:border-slate-500"
          >
            Decline
          </button>
        </form>
      </div>
      {(acceptState?.error || declineState?.error) && (
        <p className="mt-2 text-xs text-red-400">{acceptState?.error ?? declineState?.error}</p>
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
git add components/dashboard/NextMatchInvitationCard.tsx
git commit -m "feat(dashboard): add NextMatchInvitationCard (Section 2 State C)"
```

---

### Task B8: `components/dashboard/NextMatchCard.tsx` — States A & B

**Files:**
- Create: `components/dashboard/NextMatchCard.tsx`

**Interfaces:**
- Consumes: `HexAvatar` (A4), `CountdownChip` (B3), `NextMatchInvitationCard` (B7), `ROUND_LABELS` from `lib/tournaments/bracket.ts`, `formatFixtureDate` from `lib/format.ts`.
- Produces: `NextMatchCard` — consumed by B14.

- [ ] **Step 1: Write the component**

```tsx
// components/dashboard/NextMatchCard.tsx
import Link from 'next/link'
import { Suspense } from 'react'
import { HexAvatar } from '@/components/shared/HexAvatar'
import { CountdownChip } from '@/components/dashboard/CountdownChip'
import { NextMatchInvitationCard } from '@/components/dashboard/NextMatchInvitationCard'
import { formatCountdown } from '@/lib/dashboard/countdown'
import { ROUND_LABELS } from '@/lib/tournaments/bracket'
import { formatFixtureDate } from '@/lib/format'
import type { MembershipTier } from '@/lib/membership/tiers'

export interface NextMatchData {
  id: string
  status: string
  round: string
  scheduledAt: string | null
  isFullDay: boolean
  tournamentTitle: string
  myAvatarUrl: string | null
  myDisplayName: string
  myTier: MembershipTier
  opponentAvatarUrl: string | null
  opponentDisplayName: string
  opponentTier: MembershipTier
  submitted: boolean
}

export function NextMatchCard({
  match,
  invitation,
}: {
  match: NextMatchData | null
  invitation: { id: string; rank: number; deadline: string; tournamentTitle: string; fee: number } | null
}) {
  // State C — a pending invitation replaces this card entirely, same slot.
  if (invitation) return <NextMatchInvitationCard invitation={invitation} />

  // State B — nothing scheduled.
  if (!match) {
    return (
      <div className="rounded-2xl border border-sx-border bg-sx-surface p-6 text-center">
        <p className="text-lg font-bold text-white">🎮 No match scheduled</p>
        <p className="mt-1 text-sm text-sx-gray">You have no upcoming fixtures. Enter a tournament to compete.</p>
        <Link
          href="/tournaments"
          className="mt-4 inline-block rounded-xl bg-sx-purple px-6 py-3 text-sm font-bold text-white hover:bg-sx-purple-light"
        >
          Browse Tournaments
        </Link>
      </div>
    )
  }

  const isLive = match.status === 'live'
  const needsResult = !isLive && match.scheduledAt != null && new Date(match.scheduledAt) <= new Date() && !match.submitted
  const headerLabel = isLive ? '🔴 LIVE NOW' : needsResult ? '⚠ SUBMIT YOUR RESULT' : '⚔ YOUR NEXT MATCH'
  const ctaLabel = isLive ? 'ENTER MATCH' : needsResult ? 'SUBMIT RESULT' : 'VIEW MATCH'

  return (
    <div
      className="rounded-2xl border border-sx-purple bg-sx-surface p-5"
      style={{ boxShadow: '0 0 24px rgba(124,58,237,0.25)' }}
    >
      <div className="flex items-center justify-between border-b border-sx-border pb-3">
        <p className="text-sm font-bold uppercase tracking-wide text-white">{headerLabel}</p>
        {isLive ? (
          <span className="flex items-center gap-1.5 text-xs font-bold uppercase text-red-400">
            <span className="h-2 w-2 animate-pulse-dot rounded-full bg-red-500" /> LIVE
          </span>
        ) : match.scheduledAt && !needsResult ? (
          <Suspense fallback={<span className="text-xs font-bold uppercase text-sx-purple-text">{formatCountdown(match.scheduledAt, new Date())}</span>}>
            <CountdownChip scheduledAt={match.scheduledAt} />
          </Suspense>
        ) : null}
      </div>

      <div className="flex items-center justify-center gap-4 py-5">
        <div className="flex flex-col items-center gap-1.5">
          <HexAvatar src={match.myAvatarUrl} username={match.myDisplayName} tier={match.myTier} size="sm" />
          <p className="text-xs font-bold text-white">YOU</p>
        </div>
        <span className="text-sm font-bold uppercase text-sx-gray">vs</span>
        <div className="flex flex-col items-center gap-1.5">
          <HexAvatar src={match.opponentAvatarUrl} username={match.opponentDisplayName} tier={match.opponentTier} size="sm" />
          <p className="max-w-[7rem] truncate text-xs font-bold text-white">{match.opponentDisplayName}</p>
        </div>
      </div>

      <div className="border-t border-sx-border pt-3 text-center">
        <p className="text-sm text-white">
          {match.tournamentTitle} · {ROUND_LABELS[match.round] ?? match.round}
        </p>
        <p className="mt-0.5 text-xs text-sx-gray">{formatFixtureDate(match.scheduledAt, match.isFullDay) ?? 'Time TBD'}</p>
      </div>

      <Link
        href={`/matches/${match.id}`}
        className="mt-4 block rounded-xl bg-sx-purple py-3 text-center text-sm font-bold text-white hover:bg-sx-purple-light"
      >
        {ctaLabel}
      </Link>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/NextMatchCard.tsx
git commit -m "feat(dashboard): add NextMatchCard (Section 2, all 3 states)"
```

---

### Task B9: `components/dashboard/StatsRow.tsx`

**Files:**
- Create: `components/dashboard/StatsRow.tsx`

**Interfaces:**
- Consumes: `winRatePercent` from B1.
- Produces: `StatsRow` — consumed by B14.

- [ ] **Step 1: Write the component**

```tsx
// components/dashboard/StatsRow.tsx
import { winRatePercent } from '@/lib/dashboard/command-centre'

export function StatsRow({
  wins,
  totalMatches,
  goalsScored,
  coinBalance,
}: {
  wins: number
  totalMatches: number
  goalsScored: number
  coinBalance: number
}) {
  const stats = [
    { icon: '🎯', label: 'Win Rate', value: `${winRatePercent(wins, totalMatches)}%` },
    { icon: '🏆', label: 'Total Wins', value: wins.toLocaleString() },
    { icon: '⚽', label: 'Goals Scored', value: goalsScored.toLocaleString() },
    { icon: '🪙', label: 'SX Coins', value: coinBalance.toLocaleString() },
  ]
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {stats.map((s) => (
        <div key={s.label} className="relative rounded-xl bg-sx-surface p-4">
          <span className="absolute right-3 top-3 text-lg text-sx-purple-text">{s.icon}</span>
          <p className="font-display text-2xl font-black text-white">{s.value}</p>
          <p className="text-xs text-sx-gray">{s.label}</p>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/StatsRow.tsx
git commit -m "feat(dashboard): add StatsRow (Section 3)"
```

---

### Task B10: `components/dashboard/SeasonStandingCard.tsx`

**Files:**
- Create: `components/dashboard/SeasonStandingCard.tsx`

**Interfaces:**
- Consumes: `seasonQualifyProgress` from B1.
- Produces: `SeasonStandingCard` — consumed by B14.

- [ ] **Step 1: Write the component**

```tsx
// components/dashboard/SeasonStandingCard.tsx
import { seasonQualifyProgress } from '@/lib/dashboard/command-centre'

// Rank threshold for a Masters invitation — presentational copy only; the
// actual invite slot count is computed server-side by lib/seasons/eligibility.ts
// (openSlots is admin/tournament-driven). "Top 16" mirrors the spec's own copy.
const MASTERS_QUALIFY_RANK = 16

export function SeasonStandingCard({
  seasonRank,
  seasonPoints,
  pointsAtRankSixteen,
  monthlyRank,
  monthlyPoints,
}: {
  seasonRank: number | null
  seasonPoints: number
  pointsAtRankSixteen: number
  monthlyRank: number | null
  monthlyPoints: number
}) {
  const { qualified, pointsNeeded } = seasonQualifyProgress(seasonRank, seasonPoints, pointsAtRankSixteen)
  const pct = qualified ? 100 : Math.min(100, pointsAtRankSixteen > 0 ? Math.round((seasonPoints / pointsAtRankSixteen) * 100) : 0)

  return (
    <section className="rounded-2xl border border-sx-border bg-sx-surface p-5">
      <h2 className="text-sm font-bold uppercase tracking-wide text-white">📅 Season 1 Standing</h2>
      <div className="mt-3 flex items-baseline justify-between border-t border-sx-border pt-3">
        <p className="text-white">
          <span className="font-display text-xl font-black">{seasonRank != null ? `#${seasonRank}` : 'Unranked'}</span>{' '}
          Season Rank
        </p>
        <p className="text-sm text-sx-gray">{seasonPoints.toLocaleString()} pts</p>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
        <div className={`h-full rounded-full transition-all ${qualified ? 'bg-amber-500' : 'bg-sx-purple'}`} style={{ width: `${pct}%` }} />
      </div>
      {qualified ? (
        <p className="mt-1.5 text-xs font-semibold text-amber-400">✅ You&apos;re in the top {MASTERS_QUALIFY_RANK} — Masters invitation coming.</p>
      ) : (
        <p className="mt-1.5 text-xs text-sx-gray">
          Top {MASTERS_QUALIFY_RANK} = Masters invite · You need {pointsNeeded.toLocaleString()} more points to qualify
        </p>
      )}

      <div className="mt-4 border-t border-sx-border pt-3 text-sm text-sx-gray">
        This month: <span className="font-bold text-white">{monthlyRank != null ? `#${monthlyRank}` : 'Unranked'}</span> ·{' '}
        {monthlyPoints.toLocaleString()} pts
        <p className="mt-0.5 text-xs">Top {MASTERS_QUALIFY_RANK} this month = Masters invite</p>
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
git add components/dashboard/SeasonStandingCard.tsx
git commit -m "feat(dashboard): add SeasonStandingCard (Section 4)"
```

---

### Task B11: `components/dashboard/ProgressCard.tsx`

**Files:**
- Create: `components/dashboard/ProgressCard.tsx`

**Interfaces:**
- Consumes: `streakMilestonePreview` from B1; `computeTier`, `TIER_XP_THRESHOLDS` from `lib/membership/tiers.ts`; `RecentAchievement` type from `components/dashboard/RecentAchievements.tsx` (reused, not duplicated).
- Produces: `ProgressCard` — consumed by B14.

- [ ] **Step 1: Write the component**

```tsx
// components/dashboard/ProgressCard.tsx
import Link from 'next/link'
import { Medal } from 'lucide-react'
import { computeTier, TIER_XP_THRESHOLDS, type MembershipTier } from '@/lib/membership/tiers'
import { streakMilestonePreview } from '@/lib/dashboard/command-centre'
import type { RecentAchievement } from '@/components/dashboard/RecentAchievements'

const TIER_LABEL: Record<MembershipTier, string> = {
  recruit: 'Recruit',
  guardian: 'Guardian',
  elite: 'Elite',
  sentinel: 'Sentinel',
  legend: 'Legend',
}
const NEXT_TIER: Record<MembershipTier, MembershipTier | null> = {
  recruit: 'guardian', guardian: 'elite', elite: 'sentinel', sentinel: 'legend', legend: null,
}

export function ProgressCard({
  xp,
  coinBalance,
  loginStreak,
  recentAchievements,
}: {
  xp: number
  coinBalance: number
  loginStreak: number
  recentAchievements: RecentAchievement[]
}) {
  const tier = computeTier(xp)
  const next = NEXT_TIER[tier]
  const floor = TIER_XP_THRESHOLDS[tier]
  const ceiling = next ? TIER_XP_THRESHOLDS[next] : null
  const milestonePreview = streakMilestonePreview(loginStreak)

  return (
    <section className="rounded-2xl border border-sx-border bg-sx-surface p-5">
      <h2 className="text-sm font-bold uppercase tracking-wide text-white">⚡ Your Progress</h2>
      <div className="mt-3 border-t border-sx-border pt-3">
        <p className="text-sm font-bold text-white">{TIER_LABEL[tier]}</p>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full rounded-full bg-sx-purple transition-all"
            style={{ width: `${ceiling ? Math.min(100, Math.round(((xp - floor) / (ceiling - floor)) * 100)) : 100}%` }}
          />
        </div>
        <p className="mt-1 text-xs text-sx-gray">
          {xp.toLocaleString()} XP{ceiling ? ` / ${ceiling.toLocaleString()} to ${TIER_LABEL[next!]}` : ' (max tier)'}
        </p>
      </div>

      <div className="mt-4 flex items-center justify-between rounded-xl border border-sx-border bg-sx-bg p-3">
        <p className="font-display text-lg font-black text-white">🪙 {coinBalance.toLocaleString()} coins</p>
        <Link href="/store" className="rounded-lg bg-sx-purple px-3 py-1.5 text-xs font-bold text-white hover:bg-sx-purple-light">
          Visit Store →
        </Link>
      </div>

      {loginStreak >= 2 && (
        <p className="mt-3 text-sm font-semibold text-amber-400">
          🔥 {loginStreak}-day streak {milestonePreview && <span className="text-sx-gray">({milestonePreview})</span>}
        </p>
      )}

      <div className="mt-4 border-t border-sx-border pt-3">
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-sx-gray">Recent Achievements</p>
        {recentAchievements.length === 0 ? (
          <p className="text-sm text-sx-gray">Complete your first match to start earning achievements.</p>
        ) : (
          <div className="space-y-2">
            {recentAchievements.map((a) => (
              <div key={a.name} className="flex items-center gap-2 text-sm text-white">
                <Medal className="h-4 w-4 text-sx-purple-text" /> {a.name}
              </div>
            ))}
          </div>
        )}
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
git add components/dashboard/ProgressCard.tsx
git commit -m "feat(dashboard): add ProgressCard (Section 5)"
```

---

### Task B12: `components/dashboard/QuickActions.tsx`

**Files:**
- Create: `components/dashboard/QuickActions.tsx`

**Interfaces:**
- Produces: `QuickActions` — consumed by B14.

- [ ] **Step 1: Write the component**

```tsx
// components/dashboard/QuickActions.tsx
import Link from 'next/link'
import { formatNaira } from '@/lib/format'

export function QuickActions({
  walletBalance,
  hasSubmittableMatch,
}: {
  walletBalance: number
  hasSubmittableMatch: boolean
}) {
  const tiles = [
    { href: '/tournaments', icon: '🎮', label: 'Enter a Tournament' },
    ...(hasSubmittableMatch ? [{ href: '/dashboard#matches', icon: '📤', label: 'Submit Result' }] : []),
    ...(walletBalance > 0 ? [{ href: '/dashboard/wallet', icon: '💰', label: 'Withdraw Prize', sub: formatNaira(walletBalance) }] : []),
    { href: '#profile', icon: '⚙', label: 'Account Settings' },
  ]

  return (
    <section>
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-white">Quick Actions</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((t) => (
          <Link
            key={t.label}
            href={t.href}
            className="flex flex-col items-center gap-1 rounded-xl bg-sx-surface px-3 py-4 text-center transition-colors hover:bg-sx-purple/20"
          >
            <span className="text-xl">{t.icon}</span>
            <span className="text-xs font-semibold text-white">{t.label}</span>
            {'sub' in t && t.sub && <span className="text-[11px] text-sx-gray">{t.sub}</span>}
          </Link>
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
git add components/dashboard/QuickActions.tsx
git commit -m "feat(dashboard): add QuickActions (Section 7)"
```

---

### Task B13: `app/dashboard/wallet/page.tsx` — new Wallet sub-page

**Files:**
- Create: `app/dashboard/wallet/page.tsx`

**Interfaces:**
- Consumes: `WalletPanel`, `EarningsBreakdownPanel` (existing, unmodified); same data shape currently assembled inline in `app/dashboard/page.tsx`.

- [ ] **Step 1: Write the page — same data-fetching as the Wallet section being removed from the main dashboard in B14, just on its own route**

```tsx
// app/dashboard/wallet/page.tsx
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { WalletPanel, type WalletRequestRow } from '@/components/dashboard/WalletPanel'
import { EarningsBreakdownPanel } from '@/components/dashboard/EarningsBreakdownPanel'
import { getEarningsBreakdown } from '@/lib/wallet/breakdown'
import { listBanks, type Bank } from '@/lib/paystack/server'

export const metadata: Metadata = {
  title: 'Wallet · SentinelX Esports',
  robots: { index: false, follow: false },
}

export default async function DashboardWalletPage({
  searchParams,
}: {
  searchParams: { deposit?: string }
}) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/dashboard/wallet')

  const [walletRes, walletRequestsRes, kycRes, banks, earningsBreakdown] = await Promise.all([
    supabase.from('wallets').select('balance').eq('player_id', user.id).maybeSingle(),
    supabase
      .from('withdrawal_requests')
      .select('id, amount, bank_name, account_number, account_name, status, admin_note, requested_at, resolved_at')
      .eq('player_id', user.id)
      .order('requested_at', { ascending: false }),
    supabase
      .from('player_kyc')
      .select('kyc_status, kyc_failure_reason, payout_bank_name, payout_account_number, payout_account_name')
      .eq('player_id', user.id)
      .maybeSingle(),
    listBanks().catch(() => [] as Bank[]),
    getEarningsBreakdown(createAdminClient(), user.id),
  ])

  const kyc = kycRes.data
  const walletBalance = walletRes.data?.balance ?? 0
  const walletRequests = (walletRequestsRes.data ?? []) as WalletRequestRow[]
  const hasActive = walletRequests.some((w) => w.status === 'pending')
  const payoutAccount =
    kyc?.payout_bank_name && kyc?.payout_account_number && kyc?.payout_account_name
      ? { bankName: kyc.payout_bank_name, accountNumber: kyc.payout_account_number, accountName: kyc.payout_account_name }
      : null

  return (
    <div className="mx-auto max-w-2xl px-4 pb-20">
      <div className="py-8">
        <h1 className="text-2xl font-black text-white">Wallet</h1>
        <p className="mt-1 text-sm text-slate-400">Earnings, deposits, and prize withdrawals.</p>
      </div>

      {searchParams.deposit === 'paid' && (
        <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-400">
          🎉 Wallet funded — your balance is updated below.
        </div>
      )}
      {searchParams.deposit === 'failed' && (
        <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-400">
          Payment was not completed. You can try again below.
        </div>
      )}

      <div className="mb-4">
        <EarningsBreakdownPanel breakdown={earningsBreakdown} />
      </div>
      <WalletPanel
        balance={walletBalance}
        requests={walletRequests}
        hasActive={hasActive}
        kycStatus={kyc?.kyc_status ?? 'unverified'}
        kycFailureReason={kyc?.kyc_failure_reason ?? null}
        banks={banks}
        payoutAccount={payoutAccount}
      />
    </div>
  )
}
```

- [ ] **Step 2: Typecheck and build**

Run: `npx tsc --noEmit && npm run build 2>&1 | tail -30`
Expected: no errors; `/dashboard/wallet` appears in the route list.

- [ ] **Step 3: Commit**

```bash
git add app/dashboard/wallet/page.tsx
git commit -m "feat(dashboard): add /dashboard/wallet sub-page"
```

---

### Task B14: Rewire `app/dashboard/page.tsx`

**Files:**
- Modify: `app/dashboard/page.tsx`

**Interfaces:**
- Consumes: every component from B4, B6, B8, B9, B10, B11, B12 plus `mapRecentMatches` (B5), `getSeasonLeaderboard`/`getMonthlyLeaderboard` (`lib/seasons/data.ts`), `computeTier` (`lib/membership/tiers.ts`).

This task keeps **every existing section** (Referrals, Data Support, Friends, Friendlies, Active/Completed matches + Tournament banners, My Tournaments/Listings/Buy Requests/Orders/Sales, Profile Edit, Sign out) exactly as-is, below the new Sections 1–7. It **removes**: the old `DashboardHeader` render, the old `CollapsibleSection id="progression"` block, the inline `MastersInvitationBanner` render, and the `CollapsibleSection id="wallet"` block (now `/dashboard/wallet`, B13). `DashboardHeader.tsx`, `XPProgressPanel.tsx`, `CoinBalancePanel.tsx`, `LoginStreakBadge.tsx`, `MastersInvitationBanner.tsx` become unused by this page — see Step 4.

- [ ] **Step 1: Extend the profile select and add new `Promise.all` entries**

In the existing `profileRes` query (line ~140), extend the select string to add `sx_score, total_matches, sentinel_tier`:

```ts
    supabase
      .from('profiles')
      .select(
        'username, display_name, avatar_url, whatsapp_number, country, bio, wins, losses, goals_scored, ' +
          'phone_verified_at, xp, membership_tier, login_streak, sx_score, total_matches',
      )
      .eq('id', user.id)
      .maybeSingle(),
```

Add these entries to the same `Promise.all` array (alongside the existing ones — don't remove any):

```ts
    supabase
      .from('matches')
      .select(
        'id, status, round, scheduled_at, is_full_day, ' +
          'tournament:tournaments(title), ' +
          'opponent_a:profiles!matches_player_a_id_fkey(id, display_name, username, avatar_url, membership_tier), ' +
          'opponent_b:profiles!matches_player_b_id_fkey(id, display_name, username, avatar_url, membership_tier)',
      )
      .or(`player_a_id.eq.${user.id},player_b_id.eq.${user.id}`)
      .in('status', ['scheduled', 'live'])
      .order('scheduled_at', { ascending: true })
      .limit(1),
    supabase
      .from('matches')
      .select(
        'id, player_a_id, player_b_id, score_a, score_b, updated_at, ' +
          'tournament:tournaments(title), ' +
          'player_a:profiles!matches_player_a_id_fkey(username, display_name), ' +
          'player_b:profiles!matches_player_b_id_fkey(username, display_name)',
      )
      .or(`player_a_id.eq.${user.id},player_b_id.eq.${user.id}`)
      .eq('status', 'completed')
      .order('updated_at', { ascending: false })
      .limit(5),
    supabase.from('player_achievements').select('achievements(slug)').eq('player_id', user.id),
    supabase.from('seasons').select('id, name').eq('status', 'active').maybeSingle(),
```

Name these new positional results `nextMatchRes`, `recentMatchesRes`, `achievementSlugsRes`, `activeSeasonRes` in the destructuring assignment (append, don't reorder the existing ones).

- [ ] **Step 2: After the `Promise.all`, resolve season standing and next match**

Add this block after the existing post-`Promise.all` unpacking (near where `profile` is derived):

```ts
  const activeSeason = activeSeasonRes.data

  let seasonRank: number | null = null
  let seasonPoints = 0
  let pointsAtRankSixteen = 0
  let monthlyRank: number | null = null
  let monthlyPoints = 0
  if (activeSeason) {
    const [seasonBoard, monthlyBoard] = await Promise.all([
      getSeasonLeaderboard(createAdminClient(), activeSeason.id),
      getMonthlyLeaderboard(createAdminClient(), activeSeason.id, new Date()),
    ])
    const seasonIdx = seasonBoard.findIndex((r) => r.playerId === user.id)
    seasonRank = seasonIdx >= 0 ? seasonIdx + 1 : null
    seasonPoints = seasonIdx >= 0 ? seasonBoard[seasonIdx].points : 0
    pointsAtRankSixteen = seasonBoard[15]?.points ?? 0
    const monthlyIdx = monthlyBoard.findIndex((r) => r.playerId === user.id)
    monthlyRank = monthlyIdx >= 0 ? monthlyIdx + 1 : null
    monthlyPoints = monthlyIdx >= 0 ? monthlyBoard[monthlyIdx].points : 0
  }

  type NextMatchOpponentRef = { id: string; display_name: string | null; username: string | null; avatar_url: string | null; membership_tier: string | null }
  type NextMatchRow = {
    id: string
    status: string
    round: string
    scheduled_at: string | null
    is_full_day: boolean
    tournament: { title: string } | { title: string }[] | null
    opponent_a: NextMatchOpponentRef | NextMatchOpponentRef[] | null
    opponent_b: NextMatchOpponentRef | NextMatchOpponentRef[] | null
  }
  const nextMatchRow = (nextMatchRes.data as unknown as NextMatchRow[] | null)?.[0] ?? null
  const nextMatch: NextMatchData | null = nextMatchRow
    ? (() => {
        const a = Array.isArray(nextMatchRow.opponent_a) ? nextMatchRow.opponent_a[0] : nextMatchRow.opponent_a
        const b = Array.isArray(nextMatchRow.opponent_b) ? nextMatchRow.opponent_b[0] : nextMatchRow.opponent_b
        const t = Array.isArray(nextMatchRow.tournament) ? nextMatchRow.tournament[0] : nextMatchRow.tournament
        const opponent = a?.id === user.id ? b : a
        return {
          id: nextMatchRow.id,
          status: nextMatchRow.status,
          round: nextMatchRow.round,
          scheduledAt: nextMatchRow.scheduled_at,
          isFullDay: nextMatchRow.is_full_day,
          tournamentTitle: t?.title ?? 'Tournament',
          myAvatarUrl: profile?.avatar_url ?? null,
          myDisplayName: displayName,
          myTier: (profile?.membership_tier ?? 'recruit') as MembershipTier,
          opponentAvatarUrl: opponent?.avatar_url ?? null,
          opponentDisplayName: opponent?.display_name ?? opponent?.username ?? 'Opponent',
          opponentTier: (opponent?.membership_tier ?? 'recruit') as MembershipTier,
          submitted: submittedMatchIds.has(nextMatchRow.id),
        }
      })()
    : null

  type RecentRawRef = { username: string | null; display_name: string | null } | { username: string | null; display_name: string | null }[] | null
  type RecentTournamentRef = { title: string } | { title: string }[] | null
  const recentMatchRows = ((recentMatchesRes.data as unknown[] | null) ?? []).map((raw) => {
    const r = raw as {
      id: string
      player_a_id: string | null
      player_b_id: string | null
      score_a: number | null
      score_b: number | null
      updated_at: string | null
      tournament: RecentTournamentRef
      player_a: RecentRawRef
      player_b: RecentRawRef
    }
    const isA = r.player_a_id === user.id
    const opp = isA ? r.player_b : r.player_a
    const oppRow = Array.isArray(opp) ? opp[0] ?? null : opp
    const t = Array.isArray(r.tournament) ? r.tournament[0] : r.tournament
    return {
      id: r.id,
      player_a_id: r.player_a_id,
      player_b_id: r.player_b_id,
      score_a: r.score_a,
      score_b: r.score_b,
      updated_at: r.updated_at,
      opponentName: oppRow?.display_name ?? oppRow?.username ?? 'Opponent',
      opponentUsername: oppRow?.username ?? null,
      tournamentTitle: t?.title ?? 'Tournament',
    }
  })
  const recentMatches = mapRecentMatches(recentMatchRows, user.id)

  const achievementSlugs = ((achievementSlugsRes.data as unknown[] | null) ?? []).flatMap((raw) => {
    const r = raw as { achievements: { slug: string } | { slug: string }[] | null }
    const ref = Array.isArray(r.achievements) ? r.achievements[0] : r.achievements
    return ref?.slug ? [ref.slug] : []
  })

  const hasSubmittableMatch = fixtures.live.length > 0 || fixtures.upcoming.some((f) => f.awaitingMyResult)
```

Add the corresponding imports at the top of the file:

```ts
import { HeroIdentityPanel } from '@/components/dashboard/HeroIdentityPanel'
import { NextMatchCard, type NextMatchData } from '@/components/dashboard/NextMatchCard'
import { StatsRow } from '@/components/dashboard/StatsRow'
import { SeasonStandingCard } from '@/components/dashboard/SeasonStandingCard'
import { ProgressCard } from '@/components/dashboard/ProgressCard'
import { RecentMatchesCard } from '@/components/dashboard/RecentMatchesCard'
import { QuickActions } from '@/components/dashboard/QuickActions'
import { mapRecentMatches } from '@/lib/dashboard/recent-matches'
import { getSeasonLeaderboard, getMonthlyLeaderboard } from '@/lib/seasons/data'
import type { MembershipTier } from '@/lib/membership/tiers'
```

Note: `nextMatch`/`recentMatches` are computed above `pendingInvitationRow` (which already exists further down) — move the existing `pendingInvitations` query block (lines ~507–520) up so `pendingInvitationRow`/`pendingInvitationTournament` are available where the new JSX assembles Section 2. Keep its logic byte-for-byte identical, just relocated.

- [ ] **Step 3: Replace the returned JSX's opening sections**

Replace:

```tsx
      <DashboardHeader
        name={displayName}
        username={profile?.username ?? null}
        avatarUrl={profile?.avatar_url ?? null}
        wins={profile?.wins ?? 0}
        losses={profile?.losses ?? 0}
      />
      <CollapsibleSection id="progression" title="Your Progress" defaultOpen>
        <div className="space-y-3">
          <XPProgressPanel xp={profile?.xp ?? 0} />
          <CoinBalancePanel balance={coinBalance} />
          <LoginStreakBadge streak={profile?.login_streak ?? 0} />
          <RecentAchievements achievements={recentAchievements} />
        </div>
      </CollapsibleSection>
      {pendingInvitationRow && pendingInvitationTournament && (
        <MastersInvitationBanner
          invitation={{
            id: pendingInvitationRow.id,
            rank: pendingInvitationRow.rank_at_invite,
            deadline: pendingInvitationRow.expires_at,
            tournamentTitle: pendingInvitationTournament.title,
            fee: pendingInvitationTournament.registration_fee,
          }}
        />
      )}
```

with:

```tsx
      <div className="space-y-4 py-4">
        <HeroIdentityPanel
          avatarUrl={profile?.avatar_url ?? null}
          displayName={displayName}
          achievements={achievementSlugs}
          xp={profile?.xp ?? 0}
          sxScore={profile?.sx_score ?? 700}
          seasonRank={seasonRank}
          loginStreak={profile?.login_streak ?? 0}
        />
        <NextMatchCard
          match={nextMatch}
          invitation={
            pendingInvitationRow && pendingInvitationTournament
              ? {
                  id: pendingInvitationRow.id,
                  rank: pendingInvitationRow.rank_at_invite,
                  deadline: pendingInvitationRow.expires_at,
                  tournamentTitle: pendingInvitationTournament.title,
                  fee: pendingInvitationTournament.registration_fee,
                }
              : null
          }
        />
        <StatsRow
          wins={profile?.wins ?? 0}
          totalMatches={profile?.total_matches ?? 0}
          goalsScored={profile?.goals_scored ?? 0}
          coinBalance={coinBalance}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <ProgressCard
            xp={profile?.xp ?? 0}
            coinBalance={coinBalance}
            loginStreak={profile?.login_streak ?? 0}
            recentAchievements={recentAchievements}
          />
          <SeasonStandingCard
            seasonRank={seasonRank}
            seasonPoints={seasonPoints}
            pointsAtRankSixteen={pointsAtRankSixteen}
            monthlyRank={monthlyRank}
            monthlyPoints={monthlyPoints}
          />
        </div>
        <RecentMatchesCard matches={recentMatches} username={profile?.username ?? null} />
        <QuickActions walletBalance={walletBalance} hasSubmittableMatch={hasSubmittableMatch} />
      </div>
```

`walletBalance` is already computed further down the file (from `walletRes`) — move that one `const walletBalance = walletRes.data?.balance ?? 0` line up above this new JSX block (it has no other dependency, safe to hoist).

- [ ] **Step 4: Remove the old Wallet `CollapsibleSection` and now-dead imports**

Delete the entire block:

```tsx
      <CollapsibleSection id="wallet" title="Wallet" defaultOpen={walletBalance > 0 || hasActive}>
        {searchParams.deposit === 'paid' && ( ... )}
        {searchParams.deposit === 'failed' && ( ... )}
        <div className="mb-4">
          <EarningsBreakdownPanel breakdown={earningsBreakdown} />
        </div>
        <WalletPanel ... />
      </CollapsibleSection>
```

(Wallet now lives at `/dashboard/wallet`, B13.) Remove these now-unused imports: `DashboardHeader`, `WalletPanel` (type `WalletRequestRow` is now only needed by `app/dashboard/wallet/page.tsx`), `XPProgressPanel`, `CoinBalancePanel`, `LoginStreakBadge`, `MastersInvitationBanner`, `EarningsBreakdownPanel`, `getEarningsBreakdown`, `listBanks`/`Bank` (if no longer used elsewhere in the file — `kycRes`/`banks`/`payoutAccount`/`walletRequestsRes`/`earningsBreakdown` and their queries are also now dead in this file and should be deleted along with their `Promise.all` entries, since KYC/withdrawal management moved to the wallet sub-page). Keep `walletRes` (still needed for `walletBalance`, used by `QuickActions` and `hasActive`... actually `hasActive` was only used by the old Wallet section — remove it too if unused elsewhere).

- [ ] **Step 5: Typecheck and build**

Run: `npx tsc --noEmit && npm run build 2>&1 | tail -60`
Expected: no errors. Fix any leftover unused-import lint failures by deleting the import.

- [ ] **Step 6: Manual verification**

Use the `run` skill to start the dev server, log in as a test player, and open `/dashboard`. Confirm: Hero panel renders with hex avatar and XP bar; Next Match card shows one of its 3 states correctly; Stats row shows 4 tiles; Season Standing + Progress cards render side-by-side on desktop, stacked on mobile; Recent Matches shows real rows or the empty state; Quick Actions tiles work; scrolling down still shows Referrals/Friends/Friendlies/My Tournaments/Listings/Profile Edit/Sign out exactly as before; `/dashboard/wallet` shows the wallet UI that used to be inline.

- [ ] **Step 7: Commit**

```bash
git add app/dashboard/page.tsx
git commit -m "feat(dashboard): rebuild top-of-page as command centre, move wallet to its own page"
```

---

## Part C — Hall of Fame Overhaul

### Task C1: `getRunnerUp` in `lib/tournaments/bracket.ts`

**Files:**
- Modify: `lib/tournaments/bracket.ts`
- Modify: `lib/tournaments/bracket.test.ts` (create if it doesn't exist yet — check first)

**Interfaces:**
- Produces: `getRunnerUp(matches: BracketMatch[]): { id: string; name: string } | null` — consumed by C2.

- [ ] **Step 1: Check for an existing test file**

Run: `find lib/tournaments -name "bracket.test.ts"` (or reuse it if found — append to it rather than creating a duplicate).

- [ ] **Step 2: Write the failing test**

```ts
// (append to lib/tournaments/bracket.test.ts, or create it if absent, importing from vitest same as this repo's other *.test.ts files)
import { describe, it, expect } from 'vitest'
import { getRunnerUp, type BracketMatch } from './bracket'

function final(overrides: Partial<BracketMatch>): BracketMatch {
  return {
    id: 'm1', round: 'final', group_id: null, groupName: null, status: 'completed',
    score_a: 3, score_b: 1, scheduled_at: null, is_full_day: false,
    playerA: { id: 'a', name: 'A' }, playerB: { id: 'b', name: 'B' },
    ...overrides,
  }
}

describe('getRunnerUp', () => {
  it('returns the losing finalist', () => {
    expect(getRunnerUp([final({})])).toEqual({ id: 'b', name: 'B' })
  })
  it('returns null with no completed final', () => {
    expect(getRunnerUp([final({ status: 'scheduled' })])).toBeNull()
  })
  it('returns null on a draw', () => {
    expect(getRunnerUp([final({ score_a: 2, score_b: 2 })])).toBeNull()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run lib/tournaments/bracket.test.ts`
Expected: FAIL — `getRunnerUp` is not exported.

- [ ] **Step 4: Add the implementation**

Append to `lib/tournaments/bracket.ts`, directly after `getChampion`:

```ts
// The losing finalist — spec companion to getChampion, used by the Hall of
// Fame's Masters/Champions Cup runner-up rows.
export function getRunnerUp(matches: BracketMatch[]): { id: string; name: string } | null {
  const final = matches.find((m) => m.round === 'final' && m.status === 'completed')
  if (!final || final.score_a == null || final.score_b == null) return null
  if (final.score_a === final.score_b) return null
  return final.score_a > final.score_b ? final.playerB : final.playerA
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/tournaments/bracket.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/tournaments/bracket.ts lib/tournaments/bracket.test.ts
git commit -m "feat(hall-of-fame): add getRunnerUp bracket helper"
```

---

### Task C2: `lib/hall-of-fame/tournament-results.ts` — champion + runner-up per tournament

**Files:**
- Create: `lib/hall-of-fame/tournament-results.ts`
- Test: `lib/hall-of-fame/tournament-results.test.ts`

**Interfaces:**
- Consumes: `getChampion`, `getRunnerUp`, `BracketMatch` from `lib/tournaments/bracket.ts` (C1).
- Produces: `TournamentResultInput`, `TournamentResultEntry`, `deriveTournamentResults(inputs): TournamentResultEntry[]` — consumed by C10 (page).

- [ ] **Step 1: Write the failing test**

```ts
// lib/hall-of-fame/tournament-results.test.ts
import { describe, it, expect } from 'vitest'
import { deriveTournamentResults, type TournamentResultInput } from './tournament-results'
import type { BracketMatch } from '@/lib/tournaments/bracket'

function finalMatch(overrides: Partial<BracketMatch> = {}): BracketMatch {
  return {
    id: 'm1', round: 'final', group_id: null, groupName: null, status: 'completed',
    score_a: 2, score_b: 0, scheduled_at: null, is_full_day: false,
    playerA: { id: 'p1', name: 'Champ' }, playerB: { id: 'p2', name: 'Runner' },
    ...overrides,
  }
}

const base: TournamentResultInput = {
  tournamentId: 't1', slug: 'august-masters', title: 'August 2026 Masters',
  prizePool: 10000, tournamentEnd: '2026-08-30T00:00:00Z', finalMatch: finalMatch(),
}

describe('deriveTournamentResults', () => {
  it('pairs a champion with a runner-up', () => {
    const [r] = deriveTournamentResults([base])
    expect(r.champion).toEqual({ id: 'p1', name: 'Champ' })
    expect(r.runnerUp).toEqual({ id: 'p2', name: 'Runner' })
  })
  it('skips a tournament with no final yet', () => {
    expect(deriveTournamentResults([{ ...base, finalMatch: null }])).toEqual([])
  })
  it('orders most-recent-first, nulls last', () => {
    const older = { ...base, tournamentId: 't0', tournamentEnd: '2026-07-01T00:00:00Z' }
    const [first, second] = deriveTournamentResults([older, base])
    expect(first.tournamentId).toBe('t1')
    expect(second.tournamentId).toBe('t0')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/hall-of-fame/tournament-results.test.ts`
Expected: FAIL — `Cannot find module './tournament-results'`

- [ ] **Step 3: Write the implementation**

```ts
// lib/hall-of-fame/tournament-results.ts
import { getChampion, getRunnerUp, type BracketMatch } from '@/lib/tournaments/bracket'

export interface TournamentResultInput {
  tournamentId: string
  slug: string
  title: string
  prizePool: number
  tournamentEnd: string | null
  finalMatch: BracketMatch | null
}

export interface TournamentResultEntry {
  tournamentId: string
  slug: string
  title: string
  prizePool: number
  date: string | null
  champion: { id: string; name: string }
  runnerUp: { id: string; name: string } | null
}

// Masters/Champions Cup champion + runner-up per completed tournament —
// reuses getChampion/getRunnerUp so the winner rule is never reimplemented.
// Ordered most-recent-first, nulls last (same convention as awards.ts).
export function deriveTournamentResults(inputs: TournamentResultInput[]): TournamentResultEntry[] {
  return inputs
    .flatMap((inp) => {
      if (!inp.finalMatch) return []
      const champion = getChampion([inp.finalMatch])
      if (!champion) return []
      return [
        {
          tournamentId: inp.tournamentId,
          slug: inp.slug,
          title: inp.title,
          prizePool: inp.prizePool,
          date: inp.tournamentEnd,
          champion,
          runnerUp: getRunnerUp([inp.finalMatch]),
        },
      ]
    })
    .sort((a, b) => {
      if (a.date == null) return b.date == null ? 0 : 1
      if (b.date == null) return -1
      return b.date.localeCompare(a.date)
    })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/hall-of-fame/tournament-results.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/hall-of-fame/tournament-results.ts lib/hall-of-fame/tournament-results.test.ts
git commit -m "feat(hall-of-fame): add champion+runner-up derivation helper"
```

---

### Task C3: `components/hall-of-fame/SectionHeader.tsx`

**Files:**
- Create: `components/hall-of-fame/SectionHeader.tsx`

**Interfaces:**
- Produces: `SectionHeader` — consumed by C5–C9.

- [ ] **Step 1: Write the component**

```tsx
// components/hall-of-fame/SectionHeader.tsx
export function SectionHeader({
  icon,
  title,
  subtitle,
  tone = 'default',
}: {
  icon: string
  title: string
  subtitle: string
  tone?: 'default' | 'gold' | 'purple'
}) {
  const titleClass = tone === 'gold' ? 'text-amber-400' : tone === 'purple' ? 'text-sx-purple-text' : 'text-white'
  return (
    <div className="mb-6">
      <h2 className={`font-display text-2xl font-black uppercase ${titleClass}`}>
        {icon} {title}
      </h2>
      <p className="mt-1 text-sm text-sx-gray">{subtitle}</p>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/hall-of-fame/SectionHeader.tsx
git commit -m "feat(hall-of-fame): add SectionHeader"
```

---

### Task C4: `components/hall-of-fame/HeroSection.tsx`

**Files:**
- Create: `components/hall-of-fame/HeroSection.tsx`

**Interfaces:**
- Produces: `HeroSection` — consumed by C10.

- [ ] **Step 1: Write the component**

```tsx
// components/hall-of-fame/HeroSection.tsx
export function HeroSection() {
  return (
    <div
      className="relative flex h-[280px] w-full items-center overflow-hidden sm:h-[360px]"
      style={{
        background:
          'radial-gradient(ellipse at 20% 50%, rgba(124,58,237,0.35) 0%, transparent 60%),' +
          'radial-gradient(ellipse at 80% 50%, rgba(245,158,11,0.2) 0%, transparent 60%),#0B0B0F',
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute right-4 top-1/2 hidden -translate-y-1/2 animate-float text-[180px] opacity-30 sm:block"
      >
        🏆
      </div>
      <div className="relative mx-auto max-w-3xl px-4 text-center sm:text-left">
        <h1 className="font-display text-5xl font-black uppercase text-white sm:text-8xl">Hall of Fame</h1>
        <p className="mt-2 font-display text-lg italic text-sx-gray sm:text-xl">Where Legends Are Made</p>
        <p className="mt-2 text-sm text-sx-gray">Nigeria&apos;s greatest mobile esports achievers.</p>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add the `animate-float` keyframe**

In `tailwind.config.ts`, add to the same `keyframes`/`animation` objects from Task A1:

```ts
        float: {
          '0%, 100%': { transform: 'translateY(-50%)' },
          '50%': { transform: 'translateY(calc(-50% - 12px))' },
        },
```
```ts
        float: 'float 4s ease-in-out infinite',
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/hall-of-fame/HeroSection.tsx tailwind.config.ts
git commit -m "feat(hall-of-fame): add cinematic HeroSection"
```

---

### Task C5: `components/hall-of-fame/AllTimeAwardCard.tsx`

**Files:**
- Create: `components/hall-of-fame/AllTimeAwardCard.tsx`

**Interfaces:**
- Consumes: `HexAvatar` (A4), `TierBadge` (existing).
- Produces: `AllTimeAwardCard` — consumed by C10. Replaces `components/hall-of-fame/AwardCard.tsx` (deleted in C10's cleanup step — confirmed only used on this page).

- [ ] **Step 1: Write the component**

```tsx
// components/hall-of-fame/AllTimeAwardCard.tsx
import { HexAvatar } from '@/components/shared/HexAvatar'
import { TierBadge } from '@/components/player/TierBadge'
import type { MembershipTier } from '@/lib/membership/tiers'

export function AllTimeAwardCard({
  label,
  icon,
  avatarUrl,
  name,
  membershipTier,
  sentinelTier,
  metricLabel,
  metricValue,
  awardName,
}: {
  label: string
  icon: string
  avatarUrl: string | null
  name: string
  membershipTier: string | null
  sentinelTier: string | null
  metricLabel: string
  metricValue: string | number
  awardName: string
}) {
  return (
    <div
      className="flex-1 rounded-2xl border border-amber-500/40 bg-gradient-to-b from-[#1A1500] to-sx-surface p-6 text-center"
      style={{ boxShadow: '0 0 32px rgba(245,158,11,0.2)' }}
    >
      <p className="text-xs font-bold uppercase tracking-widest text-amber-400">
        {icon} {label}
      </p>
      <div className="mt-4 flex justify-center">
        <HexAvatar src={avatarUrl} username={name} tier={(membershipTier ?? 'recruit') as MembershipTier} size="xl" />
      </div>
      <p className="mt-3 font-display text-xl font-black text-white">{name}</p>
      <TierBadge tier={sentinelTier} />
      <p className="mt-3 font-display text-2xl font-black text-white">{metricValue}</p>
      <p className="text-xs text-sx-gray">{metricLabel}</p>
      <p className="mt-3 text-[11px] font-bold uppercase tracking-widest text-amber-400">{awardName}</p>
    </div>
  )
}

export function AllTimeAwardEmptyCard({ label, icon }: { label: string; icon: string }) {
  return (
    <div className="flex-1 rounded-2xl border border-amber-500/20 bg-sx-surface p-6 text-center opacity-60">
      <p className="text-3xl grayscale">{icon}</p>
      <p className="mt-3 text-sm font-bold text-amber-200/70">{label} awaits its first champion</p>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/hall-of-fame/AllTimeAwardCard.tsx
git commit -m "feat(hall-of-fame): add AllTimeAwardCard (Section 2)"
```

---

### Task C6: `components/hall-of-fame/ChampionsCupCard.tsx`

**Files:**
- Create: `components/hall-of-fame/ChampionsCupCard.tsx`

**Interfaces:**
- Consumes: `HexAvatar` (A4), `TierBadge`, `formatMonthYear` from `lib/format.ts`, `formatNaira` from `lib/format.ts`.
- Produces: `ChampionsCupCard`, `ChampionsCupEmptyCard` — consumed by C10.

- [ ] **Step 1: Write the component**

```tsx
// components/hall-of-fame/ChampionsCupCard.tsx
import Link from 'next/link'
import { HexAvatar } from '@/components/shared/HexAvatar'
import { TierBadge } from '@/components/player/TierBadge'
import { formatMonthYear, formatNaira } from '@/lib/format'

export function ChampionsCupCard({
  avatarUrl,
  name,
  sentinelTier,
  slug,
  title,
  date,
  prizePool,
  seasonName,
}: {
  avatarUrl: string | null
  name: string
  sentinelTier: string | null
  slug: string
  title: string
  date: string | null
  prizePool: number
  seasonName: string | null
}) {
  return (
    <div
      className="rounded-2xl border border-sx-purple/60 bg-gradient-to-r from-sx-purple/20 via-sx-surface to-amber-900/20 p-8 text-center sm:text-left"
      style={{ boxShadow: '0 0 40px rgba(124,58,237,0.25)' }}
    >
      <div className="flex flex-col items-center gap-6 sm:flex-row">
        {/* Champions Cup winner always gets Legend-tier glow — spec §5 */}
        <HexAvatar src={avatarUrl} username={name} tier="legend" size="xl" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
            <p className="text-xs font-bold uppercase tracking-widest text-amber-400">
              {seasonName ?? 'Season'} Champion
            </p>
          </div>
          <p className="mt-1 font-display text-3xl font-black text-white">{name}</p>
          <TierBadge tier={sentinelTier} />
          <p className="mt-3 text-sm text-sx-gray">
            🏆 SentinelX Champions Cup
            <br />
            {formatMonthYear(date) ?? 'Date TBD'} · {formatNaira(prizePool)} Prize
          </p>
          <Link href={`/tournaments/${slug}`} className="mt-3 inline-block text-sm font-bold text-sx-purple-text hover:text-sx-purple-light">
            View Tournament →
          </Link>
        </div>
      </div>
    </div>
  )
}

export function ChampionsCupEmptyCard() {
  return (
    <div className="rounded-2xl border border-sx-purple/30 bg-sx-bg/40 p-10 text-center opacity-70">
      <p className="text-4xl grayscale">🏆</p>
      <p className="mt-3 font-display text-lg font-black text-white">The Champions Cup throne awaits its first legend</p>
      <p className="mt-1 text-sm text-sx-gray">Season 1 Champion crowned in July 2027</p>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/hall-of-fame/ChampionsCupCard.tsx
git commit -m "feat(hall-of-fame): add ChampionsCupCard (Section 3)"
```

---

### Task C7: `components/hall-of-fame/MastersChampionCard.tsx`

**Files:**
- Create: `components/hall-of-fame/MastersChampionCard.tsx`

**Interfaces:**
- Consumes: `HexAvatar` (A4), `TierBadge`, `formatNaira` from `lib/format.ts`.
- Produces: `MastersChampionCard`, `MastersChampionEmptyCard` — consumed by C10.

- [ ] **Step 1: Write the component**

```tsx
// components/hall-of-fame/MastersChampionCard.tsx
import Link from 'next/link'
import { HexAvatar } from '@/components/shared/HexAvatar'
import { TierBadge } from '@/components/player/TierBadge'
import { formatNaira } from '@/lib/format'
import type { MembershipTier } from '@/lib/membership/tiers'

export function MastersChampionCard({
  title,
  avatarUrl,
  name,
  membershipTier,
  sentinelTier,
  slug,
  prizePool,
  runnerUpName,
}: {
  title: string
  avatarUrl: string | null
  name: string
  membershipTier: string | null
  sentinelTier: string | null
  slug: string
  prizePool: number
  runnerUpName: string | null
}) {
  return (
    <div
      className="rounded-xl border border-amber-500/30 bg-gradient-to-b from-[#1A1200] to-sx-surface p-5 text-center"
      style={{ boxShadow: '0 0 20px rgba(245,158,11,0.12)' }}
    >
      <p className="text-xs font-bold uppercase tracking-widest text-amber-400">👑 Masters Champion</p>
      <p className="text-xs text-sx-gray">{title}</p>
      <div className="my-3 flex justify-center border-t border-amber-500/20 pt-3">
        <HexAvatar src={avatarUrl} username={name} tier={(membershipTier ?? 'recruit') as MembershipTier} size="lg" />
      </div>
      <p className="font-display text-lg font-black text-white">{name}</p>
      <TierBadge tier={sentinelTier} />
      <div className="mt-3 border-t border-amber-500/20 pt-3 text-sm text-sx-gray">
        🏆 1st Place · {formatNaira(prizePool)}
        <br />
        <Link href={`/tournaments/${slug}`} className="mt-1 inline-block font-bold text-sx-purple-text hover:text-sx-purple-light">
          View Tournament →
        </Link>
      </div>
      {runnerUpName && <p className="mt-2 text-xs text-sx-gray">🥈 Runner-up: {runnerUpName}</p>}
    </div>
  )
}

export function MastersChampionEmptyCard({ title }: { title: string }) {
  return (
    <div className="rounded-xl border border-amber-500/15 bg-sx-surface p-5 text-center opacity-60">
      <p className="text-2xl grayscale">👑</p>
      <p className="mt-2 text-sm font-bold text-amber-200/70">{title} · Champion to be crowned</p>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/hall-of-fame/MastersChampionCard.tsx
git commit -m "feat(hall-of-fame): add MastersChampionCard (Section 4)"
```

---

### Task C8: `components/hall-of-fame/CommunityClubCard.tsx`

**Files:**
- Create: `components/hall-of-fame/CommunityClubCard.tsx`

**Interfaces:**
- Consumes: `HexAvatar` (A4), `TierBadge`, `formatDate` from `lib/format.ts`.
- Produces: `CommunityClubCard` — consumed by C10.

- [ ] **Step 1: Write the component**

```tsx
// components/hall-of-fame/CommunityClubCard.tsx
import Link from 'next/link'
import { HexAvatar } from '@/components/shared/HexAvatar'
import { TierBadge } from '@/components/player/TierBadge'
import { formatDate } from '@/lib/format'
import type { MembershipTier } from '@/lib/membership/tiers'

export function CommunityClubCard({
  avatarUrl,
  name,
  membershipTier,
  sentinelTier,
  slug,
  title,
  date,
  runnerUpName,
}: {
  avatarUrl: string | null
  name: string
  membershipTier: string | null
  sentinelTier: string | null
  slug: string
  title: string
  date: string | null
  runnerUpName: string | null
}) {
  return (
    <div className="rounded-xl border border-sx-border bg-sx-surface p-4 text-center">
      <div className="flex justify-center">
        <HexAvatar src={avatarUrl} username={name} tier={(membershipTier ?? 'recruit') as MembershipTier} size="md" />
      </div>
      <p className="mt-2 font-bold text-white">{name}</p>
      <TierBadge tier={sentinelTier} />
      <div className="mt-2 border-t border-sx-border pt-2 text-xs text-sx-gray">
        ⚡ {title}
        <br />
        {formatDate(date) ?? 'Date TBD'}
        <br />
        <Link href={`/tournaments/${slug}`} className="mt-1 inline-block font-semibold text-sx-purple-text hover:text-sx-purple-light">
          View →
        </Link>
      </div>
      {runnerUpName && <p className="mt-1.5 text-[11px] text-sx-gray">🥈 {runnerUpName}</p>}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/hall-of-fame/CommunityClubCard.tsx
git commit -m "feat(hall-of-fame): add CommunityClubCard (Section 5)"
```

---

### Task C9: `components/hall-of-fame/BronzeCard.tsx`

**Files:**
- Create: `components/hall-of-fame/BronzeCard.tsx`

**Interfaces:**
- Produces: `BronzeCard` — consumed by C10. Replaces `components/hall-of-fame/PlacementCard.tsx` (deleted in C10's cleanup step — confirmed only used on this page).

- [ ] **Step 1: Write the component**

```tsx
// components/hall-of-fame/BronzeCard.tsx
import Link from 'next/link'
import { formatMonthYear } from '@/lib/format'

export function BronzeCard({
  playerName,
  slug,
  title,
  gameName,
  date,
}: {
  playerName: string
  slug: string
  title: string
  gameName: string | null
  date: string | null
}) {
  const initial = (playerName[0] ?? '?').toUpperCase()
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-xl border border-sx-border bg-sx-surface p-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-700/20 text-lg">🥉</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-700 text-[11px] font-bold text-white">
            {initial}
          </div>
          <p className="truncate font-bold text-white">{playerName}</p>
        </div>
        <Link href={`/tournaments/${slug}`} className="mt-1 block truncate text-sm text-sx-purple-text hover:text-sx-purple-light">
          {title}
        </Link>
        <p className="mt-0.5 text-xs text-sx-gray">
          {gameName ?? 'Third Place'}
          {formatMonthYear(date) ? ` · ${formatMonthYear(date)}` : ''}
        </p>
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
git add components/hall-of-fame/BronzeCard.tsx
git commit -m "feat(hall-of-fame): add BronzeCard (Section 6)"
```

---

### Task C10: Rewrite `app/(public)/hall-of-fame/page.tsx`

**Files:**
- Modify: `app/(public)/hall-of-fame/page.tsx`
- Delete: `components/hall-of-fame/AwardCard.tsx` (superseded by C5, confirmed only used here)
- Delete: `components/hall-of-fame/PlacementCard.tsx` (superseded by C9, confirmed only used here)

**Interfaces:**
- Consumes: every component from C3–C9, `deriveTournamentResults` (C2), plus all existing awards/champions/third-place logic from `lib/hall-of-fame/awards.ts` (unchanged).

- [ ] **Step 1: Add the three new tournament queries alongside the existing ones**

In the existing `Promise.all` (currently 4 entries: `profileRows`, `tournamentRows`, `matchRows`, `activeGames`), add three more entries fetching Masters, Community Club, and Champions Cup tournaments:

```ts
    supabase
      .from('tournaments')
      .select('id, slug, title, tournament_end, prize_pool, season:seasons(name)')
      .eq('tournament_type', 'masters')
      .eq('status', 'completed')
      .order('tournament_end', { ascending: false }),
    supabase
      .from('tournaments')
      .select('id, slug, title, tournament_end, prize_pool')
      .eq('tournament_type', 'community_club')
      .eq('status', 'completed')
      .order('tournament_end', { ascending: false })
      .limit(9),
    supabase
      .from('tournaments')
      .select('id, slug, title, tournament_end, prize_pool, season:seasons(name)')
      .eq('tournament_type', 'champions_cup')
      .eq('status', 'completed')
      .order('tournament_end', { ascending: false })
      .limit(1),
```

Name these `mastersRows`, `communityClubRows`, `championsCupRows` in the destructuring.

- [ ] **Step 2: Fetch finals for these tournament sets and build results**

After the existing `finalByTournament`/`thirdPlaceByTournament` construction, add:

```ts
  const mastersIds = (mastersRows ?? []).map((t) => t.id)
  const communityClubIds = (communityClubRows ?? []).map((t) => t.id)
  const championsCupIds = (championsCupRows ?? []).map((t) => t.id)
  const newTournamentIds = [...mastersIds, ...communityClubIds, ...championsCupIds]

  const { data: newFinalRows } =
    newTournamentIds.length > 0
      ? await supabase
          .from('matches')
          .select(
            'id, tournament_id, round, status, score_a, score_b, ' +
              'player_a:profiles!matches_player_a_id_fkey(id, username, display_name, avatar_url, membership_tier, sentinel_tier), ' +
              'player_b:profiles!matches_player_b_id_fkey(id, username, display_name, avatar_url, membership_tier, sentinel_tier)',
          )
          .in('tournament_id', newTournamentIds)
          .eq('round', 'final')
          .eq('status', 'completed')
      : { data: [] as unknown[] }

  type ProfileWithAvatarRef = {
    id: string
    username: string | null
    display_name: string | null
    avatar_url: string | null
    membership_tier: string | null
    sentinel_tier: string | null
  }
  const newFinalByTournament = new Map<
    string,
    { match: BracketMatch; a: ProfileWithAvatarRef | null; b: ProfileWithAvatarRef | null }
  >()
  const playerInfoById = new Map<string, ProfileWithAvatarRef>()
  for (const raw of (newFinalRows as unknown[] | null) ?? []) {
    const m = raw as {
      id: string; tournament_id: string; round: string; status: string
      score_a: number | null; score_b: number | null
      player_a: ProfileWithAvatarRef | ProfileWithAvatarRef[] | null
      player_b: ProfileWithAvatarRef | ProfileWithAvatarRef[] | null
    }
    const a = Array.isArray(m.player_a) ? m.player_a[0] ?? null : m.player_a
    const b = Array.isArray(m.player_b) ? m.player_b[0] ?? null : m.player_b
    if (a) playerInfoById.set(a.id, a)
    if (b) playerInfoById.set(b.id, b)
    newFinalByTournament.set(m.tournament_id, {
      match: {
        id: m.id, round: m.round, group_id: null, groupName: null, status: m.status,
        score_a: m.score_a, score_b: m.score_b, scheduled_at: null, is_full_day: false,
        playerA: { id: a?.id ?? '', name: a?.display_name ?? a?.username ?? 'TBD' },
        playerB: { id: b?.id ?? '', name: b?.display_name ?? b?.username ?? 'TBD' },
      },
      a, b,
    })
  }

  type SeasonRef = { name: string } | { name: string }[] | null
  const seasonName = (s: SeasonRef) => (Array.isArray(s) ? s[0]?.name : s?.name) ?? null

  const mastersResults = deriveTournamentResults(
    (mastersRows ?? []).map((t) => ({
      tournamentId: t.id, slug: t.slug, title: t.title, prizePool: t.prize_pool,
      tournamentEnd: t.tournament_end, finalMatch: newFinalByTournament.get(t.id)?.match ?? null,
    })),
  )
  const communityClubResults = deriveTournamentResults(
    (communityClubRows ?? []).map((t) => ({
      tournamentId: t.id, slug: t.slug, title: t.title, prizePool: t.prize_pool,
      tournamentEnd: t.tournament_end, finalMatch: newFinalByTournament.get(t.id)?.match ?? null,
    })),
  )
  const championsCupResult = deriveTournamentResults(
    (championsCupRows ?? []).map((t) => ({
      tournamentId: t.id, slug: t.slug, title: t.title, prizePool: t.prize_pool,
      tournamentEnd: t.tournament_end, finalMatch: newFinalByTournament.get(t.id)?.match ?? null,
    })),
  )[0] ?? null
  const championsCupSeasonName = championsCupResult
    ? seasonName((championsCupRows ?? []).find((t) => t.id === championsCupResult.tournamentId)?.season ?? null)
    : null
```

- [ ] **Step 3: Fetch achievement slugs for the Champions Cup champion (decoration on their xl avatar)**

```ts
  const { data: cupChampAchievements } = championsCupResult
    ? await supabase.from('player_achievements').select('achievements(slug)').eq('player_id', championsCupResult.champion.id)
    : { data: [] as unknown[] }
  const cupChampionSlugs = ((cupChampAchievements as unknown[] | null) ?? []).flatMap((raw) => {
    const r = raw as { achievements: { slug: string } | { slug: string }[] | null }
    const ref = Array.isArray(r.achievements) ? r.achievements[0] : r.achievements
    return ref?.slug ? [ref.slug] : []
  })
```

- [ ] **Step 4: Replace the returned JSX with the new grandeur-ordered layout**

Replace the whole `return (...)` block with:

```tsx
  return (
    <>
      <HeroSection />
      <div className="mx-auto max-w-3xl px-4 pb-20">
        <section className="border-b border-amber-500/10 py-16">
          <SectionHeader icon="☀️" title="All-Time Awards" subtitle="The greatest individuals in SentinelX history." tone="gold" />
          <div className="flex flex-col gap-4 sm:flex-row">
            {mvp ? (
              <AllTimeAwardCard
                label="MVP" icon="⭐" avatarUrl={mvp.avatarUrl} name={mvp.displayName ?? mvp.username ?? 'Anonymous'}
                membershipTier={mvp.membershipTier} sentinelTier={mvp.sentinelTier}
                metricLabel="SX Score" metricValue={mvp.sxScore} awardName="All-Time MVP"
              />
            ) : (
              <AllTimeAwardEmptyCard label="MVP" icon="⭐" />
            )}
            {goldenBoot ? (
              <AllTimeAwardCard
                label="Golden Boot" icon="👟" avatarUrl={goldenBoot.avatarUrl} name={goldenBoot.displayName ?? goldenBoot.username ?? 'Anonymous'}
                membershipTier={goldenBoot.membershipTier} sentinelTier={goldenBoot.sentinelTier}
                metricLabel="goals scored" metricValue={categoryStat(goldenBoot.categoryStats, 'football').scored}
                awardName="All-Time Golden Boot"
              />
            ) : (
              <AllTimeAwardEmptyCard label="Golden Boot" icon="👟" />
            )}
          </div>
          {categoryAwards.length > 0 && (
            <div className="mt-4 flex flex-col gap-4 sm:flex-row">
              {categoryAwards.map(({ category, meta, winner }) => (
                <AllTimeAwardCard
                  key={category} label={meta.awardName} icon={meta.awardEmoji}
                  avatarUrl={winner!.avatarUrl} name={winner!.displayName ?? winner!.username ?? 'Anonymous'}
                  membershipTier={winner!.membershipTier} sentinelTier={winner!.sentinelTier}
                  metricLabel={meta.statLabel.toLowerCase()} metricValue={categoryStat(winner!.categoryStats, category).scored}
                  awardName={meta.awardName}
                />
              ))}
            </div>
          )}
        </section>

        <section
          className="border-y border-sx-purple/30 py-16"
          style={{ background: 'linear-gradient(180deg, rgba(124,58,237,0.08) 0%, transparent 100%)' }}
        >
          <SectionHeader
            icon="🏆" title="Champions Cup Legends"
            subtitle="The greatest prize in Nigerian mobile esports. Annual · Invitation Only." tone="purple"
          />
          {championsCupResult ? (
            <ChampionsCupCard
              avatarUrl={playerInfoById.get(championsCupResult.champion.id)?.avatar_url ?? null}
              name={championsCupResult.champion.name}
              sentinelTier={playerInfoById.get(championsCupResult.champion.id)?.sentinel_tier ?? null}
              slug={championsCupResult.slug} title={championsCupResult.title} date={championsCupResult.date}
              prizePool={championsCupResult.prizePool} seasonName={championsCupSeasonName}
            />
          ) : (
            <ChampionsCupEmptyCard />
          )}
        </section>

        <section className="border-t border-amber-500/20 py-16">
          <SectionHeader icon="👑" title="Masters Champions" subtitle="Monthly elite champions — the top 16 per month." tone="gold" />
          {mastersResults.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {mastersResults.map((r) => (
                <MastersChampionCard
                  key={r.tournamentId} title={r.title}
                  avatarUrl={playerInfoById.get(r.champion.id)?.avatar_url ?? null} name={r.champion.name}
                  membershipTier={playerInfoById.get(r.champion.id)?.membership_tier ?? null}
                  sentinelTier={playerInfoById.get(r.champion.id)?.sentinel_tier ?? null}
                  slug={r.slug} prizePool={r.prizePool} runnerUpName={r.runnerUp?.name ?? null}
                />
              ))}
            </div>
          ) : (
            <MastersChampionEmptyCard title="August 2026 Masters" />
          )}
        </section>

        <section className="py-16">
          <SectionHeader icon="⚡" title="Community Club Champions" subtitle="Weekly community tournaments — where every legend starts." />
          {communityClubResults.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {communityClubResults.map((r) => (
                <CommunityClubCard
                  key={r.tournamentId}
                  avatarUrl={playerInfoById.get(r.champion.id)?.avatar_url ?? null} name={r.champion.name}
                  membershipTier={playerInfoById.get(r.champion.id)?.membership_tier ?? null}
                  sentinelTier={playerInfoById.get(r.champion.id)?.sentinel_tier ?? null}
                  slug={r.slug} title={r.title} date={r.date} runnerUpName={r.runnerUp?.name ?? null}
                />
              ))}
            </div>
          ) : (
            <EmptyState icon="⚡" title="No Community Club champions yet" body="Weekly champions appear here once a tournament finishes." />
          )}
        </section>

        <section className="py-16">
          <SectionHeader icon="🥉" title="Bronze Finishes" subtitle="Third-place finishers across every tournament." />
          {hasBronze ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {thirdPlaces.map((tp) => (
                <BronzeCard key={tp.tournamentId} playerName={tp.player.name} slug={tp.slug} title={tp.title} gameName={tp.gameName} date={tp.date} />
              ))}
            </div>
          ) : (
            <EmptyState icon="🥉" title="No third place finishes yet" body="3rd place winners appear here once a bronze match is confirmed." />
          )}
        </section>
      </div>
    </>
  )
}
```

Keep every existing pre-return computation (`mvp`, `goldenBoot`, `categoryAwards`, `champions`/`hasChampions` — no longer rendered directly since Champions Cup/Masters/Community Club supersede the generic `champions` section for grandeur purposes, but leave the variables and their queries in place since `thirdPlaces`/`hasBronze` still depend on the same `tournaments`/`matches` fetch — do not delete `champions`/`hasChampions`, just stop rendering the old `🏆 Champions` section). Add the new imports at the top:

```ts
import { deriveTournamentResults } from '@/lib/hall-of-fame/tournament-results'
import { SectionHeader } from '@/components/hall-of-fame/SectionHeader'
import { HeroSection } from '@/components/hall-of-fame/HeroSection'
import { AllTimeAwardCard, AllTimeAwardEmptyCard } from '@/components/hall-of-fame/AllTimeAwardCard'
import { ChampionsCupCard, ChampionsCupEmptyCard } from '@/components/hall-of-fame/ChampionsCupCard'
import { MastersChampionCard, MastersChampionEmptyCard } from '@/components/hall-of-fame/MastersChampionCard'
import { CommunityClubCard } from '@/components/hall-of-fame/CommunityClubCard'
import { BronzeCard } from '@/components/hall-of-fame/BronzeCard'
```
Remove the now-unused `import { AwardCard } from '@/components/hall-of-fame/AwardCard'` and `import { PlacementCard } from '@/components/hall-of-fame/PlacementCard'`.

- [ ] **Step 5: Delete the superseded components**

```bash
rm components/hall-of-fame/AwardCard.tsx components/hall-of-fame/PlacementCard.tsx
```

- [ ] **Step 6: Typecheck and build**

Run: `npx tsc --noEmit && npm run build 2>&1 | tail -60`
Expected: no errors.

- [ ] **Step 7: Manual verification**

Use the `run` skill: open `/hall-of-fame`. Confirm scroll order top-to-bottom is Hero → All-Time Awards → Champions Cup → Masters → Community Club → Bronze; every section shows either real data or its dedicated empty state (never a blank box); Champions Cup champion avatar (if any exists in seed/test data) shows the Legend-tier animated gradient border regardless of their real tier.

- [ ] **Step 8: Commit**

```bash
git add "app/(public)/hall-of-fame/page.tsx" components/hall-of-fame/AwardCard.tsx components/hall-of-fame/PlacementCard.tsx
git commit -m "feat(hall-of-fame): rebuild page in grandeur order with HexAvatar"
```

---

### Task C11: Retire `MastersInvitationBanner.tsx`

**Files:**
- Delete: `components/dashboard/MastersInvitationBanner.tsx`

Only proceed once B14 is committed (its only caller is removed there).

- [ ] **Step 1: Confirm no remaining references**

Run: `grep -rn "MastersInvitationBanner" app components`
Expected: no matches (B14 removed the import/usage; `NextMatchInvitationCard` from B7 replaced it).

- [ ] **Step 2: Delete and verify build**

```bash
rm components/dashboard/MastersInvitationBanner.tsx
npx tsc --noEmit && npm run build 2>&1 | tail -30
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add -u
git commit -m "chore(dashboard): remove MastersInvitationBanner, superseded by NextMatchInvitationCard"
```

---

## Self-Review Notes (for the executor, not a task)

- Every spec section maps to a task: HexAvatar spec §2–§8 → A1–A9; Dashboard spec §2 Sections 1–7 → B4/B8/B9/B10/B11/B6/B12; Dashboard spec §6 (wallet sub-page) → B13; Hall of Fame spec §3–§8 → C4/C5/C6/C7/C8/C9; Hall of Fame spec §9 (data) → C10 Steps 1–3.
- Hall of Fame spec §12 ("Season filter — future, not Phase 2") is intentionally **not** built; the new queries are still season-agnostic (they filter by `tournament_type`+`status`, not `season_id`), matching the spec's "parameterise later" instruction without adding unused code now.
- Run the full test suite once at the very end of all three parts: `npx vitest run && npx tsc --noEmit && npm run build`.
