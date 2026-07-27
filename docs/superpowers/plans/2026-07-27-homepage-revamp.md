# Homepage & Nav Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the homepage's top section (hero, trusted-by strip, feature grid, stats bar) and the
site nav to match the supplied mockup, add `/games` and `/about` pages, and keep every existing
below-the-fold homepage section (live tournament, upcoming tournaments, leaderboard preview, WhatsApp
CTA, FAQ) working exactly as it does today.

**Architecture:** New presentational components under `components/home/` (`Hero`, `GuideBubble`,
`TrustedByStrip`, `FeatureGrid`, `StatsBar`) plug into a restructured `app/page.tsx`. A shared pure
function `dedupeGamesByName` (`lib/games/dedupe.ts`) resolves duplicate `games` rows to one entry per
name, reused by the trusted-by strip, the stats bar's games count, and the new `/games` page. Nav changes
are confined to `components/shared/SiteHeader.tsx` (link list) and `components/shared/AccountMenu.tsx`
(logged-out Login/Register buttons).

**Tech Stack:** Next.js 14 App Router (Server Components by default), TypeScript, Tailwind CSS,
lucide-react (already a dependency), Supabase, Vitest.

## Global Constraints

- Mobile-first: every new component's base (no breakpoint prefix) classes must read correctly at 375px
  before any `sm:`/`lg:` override is added (per CLAUDE.md).
- No new fonts or color tokens — reuse the existing violet/slate palette and the already-configured
  `--font-display` (Rajdhani, wired in `app/layout.tsx`).
- No mascot artwork or game-logo images exist yet — the hero's mascot slot is a placeholder box; the
  trusted-by strip and `/games` page render `icon_url` when present but fall back to text (every row is
  null today, so this reads as text-only until someone sets an icon).
- The stats bar shows real counts with no "+" suffix and no rounding.
- `GuideBubble` must not render at all (no DOM, no localStorage read) when the visitor is logged in.
- Every new public page (`/games`, `/about`) gets `buildMetadata` + Open Graph tags, matching every other
  public page (see `app/(public)/players/page.tsx` for the reference pattern).

---

### Task 1: `dedupeGamesByName` pure helper

**Files:**
- Create: `lib/games/dedupe.ts`
- Test: `lib/games/dedupe.test.ts`

**Interfaces:**
- Produces: `interface DedupableGame { name: string; slug: string; icon_url: string | null; active: boolean; created_at: string }`
- Produces: `dedupeGamesByName(games: DedupableGame[]): DedupableGame[]`

- [ ] **Step 1: Write the failing tests**

Create `lib/games/dedupe.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { dedupeGamesByName, type DedupableGame } from './dedupe'

function g(over: Partial<DedupableGame> & { name: string; slug: string }): DedupableGame {
  return {
    icon_url: null,
    active: false,
    created_at: '2026-01-01T00:00:00Z',
    ...over,
  }
}

describe('dedupeGamesByName', () => {
  it('picks the active row over inactive duplicates regardless of creation order', () => {
    const result = dedupeGamesByName([
      g({ name: 'Free Fire', slug: 'free-fire-old', active: false, created_at: '2026-01-01T00:00:00Z' }),
      g({ name: 'Free Fire', slug: 'free-fire', active: true, created_at: '2025-06-01T00:00:00Z' }),
      g({ name: 'Free Fire', slug: 'free-fire-new', active: false, created_at: '2026-07-01T00:00:00Z' }),
    ])
    expect(result).toHaveLength(1)
    expect(result[0].slug).toBe('free-fire')
  })

  it('picks the most recently created row when all duplicates are inactive', () => {
    const result = dedupeGamesByName([
      g({ name: 'Blood strike', slug: 'blood-strike', created_at: '2026-01-01T00:00:00Z' }),
      g({ name: 'Blood strike', slug: 'blood-strike-2', created_at: '2026-03-01T00:00:00Z' }),
    ])
    expect(result).toHaveLength(1)
    expect(result[0].slug).toBe('blood-strike-2')
  })

  it('passes a single row through unchanged', () => {
    const only = g({ name: 'Dream League Soccer', slug: 'dls', active: true })
    expect(dedupeGamesByName([only])).toEqual([only])
  })

  it('keeps distinct names as separate entries', () => {
    const result = dedupeGamesByName([
      g({ name: 'Dream League Soccer', slug: 'dls', active: true }),
      g({ name: 'COD Mobile', slug: 'cod-mobile' }),
    ])
    expect(result.map((r) => r.name).sort()).toEqual(['COD Mobile', 'Dream League Soccer'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/games/dedupe.test.ts`
Expected: FAIL — `Cannot find module './dedupe'`.

- [ ] **Step 3: Implement the helper**

Create `lib/games/dedupe.ts`:

```ts
export interface DedupableGame {
  name: string
  slug: string
  icon_url: string | null
  active: boolean
  created_at: string
}

// One row per distinct name: prefer an active row if any exists for that name,
// otherwise the most recently created row. Duplicate rows are leftover QA data
// (same game, different slugs) — picking the active one keeps the link that
// actually has real tournaments; picking most-recent among inactive duplicates
// avoids surfacing a stale abandoned row.
export function dedupeGamesByName(games: DedupableGame[]): DedupableGame[] {
  const byName = new Map<string, DedupableGame>()
  for (const g of games) {
    const existing = byName.get(g.name)
    if (!existing) {
      byName.set(g.name, g)
      continue
    }
    const gScore = g.active ? 1 : 0
    const existingScore = existing.active ? 1 : 0
    if (gScore > existingScore || (gScore === existingScore && g.created_at > existing.created_at)) {
      byName.set(g.name, g)
    }
  }
  return Array.from(byName.values())
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/games/dedupe.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/games/dedupe.ts lib/games/dedupe.test.ts
git commit -m "feat: add dedupeGamesByName helper for the games catalog"
```

---

### Task 2: `GuideBubble` component

**Files:**
- Create: `components/home/GuideBubble.tsx`

**Interfaces:**
- Produces: `GuideBubble({ whatsappUrl }: { whatsappUrl: string })` — `'use client'`, renders nothing if
  previously dismissed (localStorage key `guide-bubble-dismissed`). Does NOT take an `isLoggedIn` prop —
  the logged-in check happens one level up, in `Hero` (Task 3), which simply doesn't render this
  component at all for a logged-in visitor.

- [ ] **Step 1: Implement the component**

Create `components/home/GuideBubble.tsx`:

```tsx
'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { X } from 'lucide-react'

const DISMISS_KEY = 'guide-bubble-dismissed'

export function GuideBubble({ whatsappUrl }: { whatsappUrl: string }) {
  // Hidden until the localStorage check resolves, so a returning dismisser
  // never sees a one-frame flash of the bubble before it disappears.
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
    <div className="relative w-full max-w-xs rounded-2xl border border-violet-500/30 bg-slate-900 p-5 text-left shadow-xl">
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute right-3 top-3 text-slate-500 transition-colors hover:text-white"
      >
        <X className="h-4 w-4" />
      </button>
      <p className="mb-1 inline-block rounded-full bg-violet-600/20 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-300">
        I&apos;m your guide!
      </p>
      <p className="mb-3 text-sm text-slate-300">
        Welcome to <span className="font-bold text-violet-400">Sentinel X Esports!</span> I&apos;m your
        guide. Let me help you get started.
      </p>
      <div className="flex flex-col gap-2">
        <Link href="/tournaments" className="text-sm font-semibold text-violet-400 hover:text-violet-300">
          Browse Tournaments →
        </Link>
        <Link href="#how-it-works" className="text-sm font-semibold text-violet-400 hover:text-violet-300">
          How It Works →
        </Link>
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-semibold text-violet-400 hover:text-violet-300"
        >
          Join WhatsApp →
        </a>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS (this component isn't imported anywhere yet, so no other errors should reference it).

- [ ] **Step 3: Commit**

```bash
git add components/home/GuideBubble.tsx
git commit -m "feat: add dismissible GuideBubble component"
```

---

### Task 3: `Hero` component

**Files:**
- Create: `components/home/Hero.tsx`

**Interfaces:**
- Consumes: `GuideBubble` from Task 2.
- Produces: `Hero({ isLoggedIn, whatsappUrl }: { isLoggedIn: boolean; whatsappUrl: string })` — server
  component (no `'use client'`).

- [ ] **Step 1: Implement the component**

Create `components/home/Hero.tsx`:

```tsx
import Link from 'next/link'
import { GuideBubble } from '@/components/home/GuideBubble'

export function Hero({ isLoggedIn, whatsappUrl }: { isLoggedIn: boolean; whatsappUrl: string }) {
  return (
    <section className="relative mb-10 overflow-hidden rounded-3xl border border-slate-800 bg-gradient-to-b from-violet-950/40 to-slate-950 px-6 py-12 sm:px-10">
      <div className="grid items-center justify-items-center gap-8 lg:grid-cols-[1fr_auto_auto] lg:justify-items-start">
        <div className="text-center lg:text-left">
          <h1 className="font-display text-4xl font-black uppercase leading-tight text-white sm:text-5xl">
            Welcome to <span className="text-violet-400">Sentinel X</span> Esports
          </h1>
          <p className="mt-3 text-sm font-semibold uppercase tracking-widest text-slate-400">
            Compete. <span className="text-violet-400">Conquer.</span> Become a Legend.
          </p>
          <p className="mx-auto mt-4 max-w-md text-sm text-slate-400 lg:mx-0">
            Join tournaments, connect with gamers, climb the leaderboards and represent Sentinel X
            Esports.
          </p>
          <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
            <Link
              href="/signup"
              className="w-full max-w-xs rounded-xl bg-violet-600 px-7 py-3.5 text-sm font-bold text-white transition-colors hover:bg-violet-500 sm:w-auto"
            >
              Register Now
            </Link>
            <Link
              href="/tournaments"
              className="w-full max-w-xs rounded-xl border border-slate-700 px-7 py-3.5 text-sm font-bold text-white transition-colors hover:border-slate-500 sm:w-auto"
            >
              Explore
            </Link>
          </div>
        </div>

        <div
          aria-hidden
          className="flex h-56 w-44 shrink-0 items-center justify-center rounded-2xl border border-dashed border-violet-500/30 bg-slate-900/50 text-center text-xs text-slate-600 sm:h-72 sm:w-56"
        >
          Mascot artwork
        </div>

        {!isLoggedIn && <GuideBubble whatsappUrl={whatsappUrl} />}
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add components/home/Hero.tsx
git commit -m "feat: add Hero component with placeholder mascot slot"
```

---

### Task 4: `TrustedByStrip` component

**Files:**
- Create: `components/home/TrustedByStrip.tsx`

**Interfaces:**
- Consumes: `DedupableGame` type from Task 1 (`lib/games/dedupe.ts`).
- Produces: `TrustedByStrip({ games }: { games: DedupableGame[] })`.

- [ ] **Step 1: Implement the component**

Create `components/home/TrustedByStrip.tsx`:

```tsx
import type { DedupableGame } from '@/lib/games/dedupe'

export function TrustedByStrip({ games }: { games: DedupableGame[] }) {
  if (games.length === 0) return null
  return (
    <section className="mb-10 text-center">
      <p className="mb-4 text-xs font-bold uppercase tracking-widest text-violet-400/80">
        Trusted by Gamers
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        {games.map((g) => (
          <span
            key={g.name}
            className={`rounded-full border px-4 py-1.5 text-xs font-bold uppercase tracking-wide ${
              g.active ? 'border-slate-700 text-slate-300' : 'border-slate-800 text-slate-600'
            }`}
          >
            {g.name}
            {!g.active && (
              <span className="ml-1.5 text-[10px] normal-case text-slate-600">(Coming soon)</span>
            )}
          </span>
        ))}
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add components/home/TrustedByStrip.tsx
git commit -m "feat: add TrustedByStrip component"
```

---

### Task 5: `FeatureGrid` component

**Files:**
- Create: `components/home/FeatureGrid.tsx`

**Interfaces:**
- Produces: `FeatureGrid()` — no props. Root element carries `id="how-it-works"`, the exact anchor target
  `GuideBubble`'s "How It Works" link points to (Task 2).

- [ ] **Step 1: Implement the component**

Create `components/home/FeatureGrid.tsx`:

```tsx
import Link from 'next/link'
import { Trophy, Users, TrendingUp, ShoppingCart, Gift, ShieldCheck } from 'lucide-react'

const FEATURES = [
  {
    icon: Trophy,
    title: 'Compete',
    body: 'Join exciting tournaments and win amazing prizes.',
    href: '/tournaments',
  },
  {
    icon: Users,
    title: 'Connect',
    body: 'Meet gamers, build teams and grow your network.',
    href: '/community',
  },
  {
    icon: TrendingUp,
    title: 'Climb',
    body: 'Climb the leaderboards and become a legend.',
    href: '/rankings',
  },
  {
    icon: ShoppingCart,
    title: 'Shop',
    body: 'Buy, sell and trade gaming accounts and gear safely.',
    href: '/exchange',
  },
  {
    icon: Gift,
    title: 'Earn Rewards',
    body: 'Play, win and earn exclusive rewards.',
    href: '/tournaments',
  },
  {
    icon: ShieldCheck,
    title: 'Be Part of the Community',
    body: "This is more than gaming. It's a family.",
    href: '/community',
  },
] as const

export function FeatureGrid() {
  return (
    <section id="how-it-works" className="mb-10 scroll-mt-20">
      <h2 className="mb-6 text-center text-base font-bold uppercase tracking-widest text-white">
        What You Can Do Here
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map(({ icon: Icon, title, body, href }) => (
          <Link
            key={title}
            href={href}
            className="rounded-2xl border border-slate-800 bg-slate-900 p-5 text-center transition-colors hover:border-violet-500/40"
          >
            <Icon className="mx-auto mb-3 h-7 w-7 text-violet-400" />
            <p className="mb-1 text-sm font-bold text-white">{title}</p>
            <p className="text-xs text-slate-400">{body}</p>
          </Link>
        ))}
      </div>
    </section>
  )
}
```

`scroll-mt-20` keeps the anchored section clear of the sticky header (`SiteHeader` is `sticky top-0 z-50`)
when `GuideBubble`'s "How It Works" link jumps to it.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add components/home/FeatureGrid.tsx
git commit -m "feat: add FeatureGrid component"
```

---

### Task 6: `StatsBar` component

**Files:**
- Create: `components/home/StatsBar.tsx`

**Interfaces:**
- Produces: `StatsBar({ playerCount, tournamentCount, gameCount }: { playerCount: number; tournamentCount: number; gameCount: number })`.

- [ ] **Step 1: Implement the component**

Create `components/home/StatsBar.tsx`:

```tsx
import { Users, Trophy, Gamepad2, Globe } from 'lucide-react'

export function StatsBar({
  playerCount,
  tournamentCount,
  gameCount,
}: {
  playerCount: number
  tournamentCount: number
  gameCount: number
}) {
  const stats = [
    { icon: Users, value: String(playerCount), label: 'Players' },
    { icon: Trophy, value: String(tournamentCount), label: 'Tournaments' },
    { icon: Gamepad2, value: String(gameCount), label: 'Games' },
  ]
  return (
    <section className="mb-10 grid grid-cols-2 gap-4 rounded-2xl border border-slate-800 bg-slate-900 p-6 sm:grid-cols-4">
      {stats.map(({ icon: Icon, value, label }) => (
        <div key={label} className="flex items-center gap-3">
          <Icon className="h-6 w-6 shrink-0 text-violet-400" />
          <div>
            <p className="text-lg font-black text-white">{value}</p>
            <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
          </div>
        </div>
      ))}
      <div className="flex items-center gap-3">
        <Globe className="h-6 w-6 shrink-0 text-violet-400" />
        <div>
          <p className="text-sm font-bold text-white">Mission</p>
          <p className="text-[11px] text-slate-500">Building Africa&apos;s Biggest Esports Community</p>
        </div>
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add components/home/StatsBar.tsx
git commit -m "feat: add StatsBar component"
```

---

### Task 7: Wire the new sections into `app/page.tsx`

**Files:**
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: `Hero` (Task 3), `TrustedByStrip` (Task 4), `FeatureGrid` (Task 5), `StatsBar` (Task 6),
  `dedupeGamesByName` (Task 1).

- [ ] **Step 1: Add imports and remove the now-unused `Image` import**

In `app/page.tsx`, replace:

```ts
import Image from 'next/image'
import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { TournamentCard } from '@/components/tournament/TournamentCard'
import type { TournamentCardData } from '@/components/tournament/TournamentCard'
import { EmptyState } from '@/components/shared/EmptyState'
import { TierBadge } from '@/components/player/TierBadge'
import { PromoBanner } from '@/components/home/PromoBanner'
import { buildMetadata } from '@/lib/seo/metadata'
import { homepageDescription } from '@/lib/seo/homepage-description'
import { FaqSection } from '@/components/home/FaqSection'
import { JsonLd } from '@/components/seo/JsonLd'
import { buildFaqJsonLd } from '@/lib/seo/schema/faq'
import { HOMEPAGE_FAQS } from '@/lib/seo/faq-content'
```

with:

```ts
import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { TournamentCard } from '@/components/tournament/TournamentCard'
import type { TournamentCardData } from '@/components/tournament/TournamentCard'
import { EmptyState } from '@/components/shared/EmptyState'
import { TierBadge } from '@/components/player/TierBadge'
import { PromoBanner } from '@/components/home/PromoBanner'
import { Hero } from '@/components/home/Hero'
import { TrustedByStrip } from '@/components/home/TrustedByStrip'
import { FeatureGrid } from '@/components/home/FeatureGrid'
import { StatsBar } from '@/components/home/StatsBar'
import { dedupeGamesByName } from '@/lib/games/dedupe'
import { buildMetadata } from '@/lib/seo/metadata'
import { homepageDescription } from '@/lib/seo/homepage-description'
import { FaqSection } from '@/components/home/FaqSection'
import { JsonLd } from '@/components/seo/JsonLd'
import { buildFaqJsonLd } from '@/lib/seo/schema/faq'
import { HOMEPAGE_FAQS } from '@/lib/seo/faq-content'
```

(`Image` is dropped because the old logo-based hero block, which was its only use in this file, is
removed in Step 3.)

- [ ] **Step 2: Fetch games, counts, and auth state alongside the existing queries**

Replace the `Promise.all` block:

```ts
  const [{ data: rawTournaments }, { data: players }, { data: rawBanner }] = await Promise.all([
    supabase
      .from('tournaments')
      .select(
        'id, title, slug, prize_pool, registration_fee, status, tournament_start, registration_end, max_players, games(name, icon_url)'
      )
      .in('status', ['active', 'registration_open'])
      .order('created_at', { ascending: false })
      .limit(4),
    supabase
      .from('profiles')
      .select('id, username, display_name, wins, total_matches, sentinel_score, sentinel_tier')
      .order('wins', { ascending: false })
      .gt('total_matches', 0)
      .limit(5),
    supabase
      .from('homepage_banners')
      .select('title, image_url, link_url')
      .eq('active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])
```

with:

```ts
  const [
    { data: rawTournaments },
    { data: players },
    { data: rawBanner },
    { data: rawGames },
    { count: playerCount },
    { count: tournamentCount },
    {
      data: { user },
    },
  ] = await Promise.all([
    supabase
      .from('tournaments')
      .select(
        'id, title, slug, prize_pool, registration_fee, status, tournament_start, registration_end, max_players, games(name, icon_url)'
      )
      .in('status', ['active', 'registration_open'])
      .order('created_at', { ascending: false })
      .limit(4),
    supabase
      .from('profiles')
      .select('id, username, display_name, wins, total_matches, sentinel_score, sentinel_tier')
      .order('wins', { ascending: false })
      .gt('total_matches', 0)
      .limit(5),
    supabase
      .from('homepage_banners')
      .select('title, image_url, link_url')
      .eq('active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from('games').select('name, slug, icon_url, active, created_at'),
    supabase.from('profiles').select('*', { count: 'exact', head: true }),
    supabase.from('tournaments').select('*', { count: 'exact', head: true }).neq('status', 'draft'),
    supabase.auth.getUser(),
  ])

  const games = dedupeGamesByName(rawGames ?? [])
```

- [ ] **Step 3: Replace the old hero section, insert the new sections**

Replace:

```tsx
      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="py-12 text-center">
        <div className="mx-auto mb-6 flex justify-center">
          <Image
            src="/logo-full.png"
            alt="SentinelX Esports — Where Gamers Unite. Champions Rise."
            width={340}
            height={220}
            priority
            className="w-64 sm:w-80"
          />
        </div>
        <p className="mb-8 text-sm text-slate-400">Nigeria's Home of Mobile Esports</p>
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/tournaments"
            className="w-full max-w-xs rounded-xl bg-violet-600 px-7 py-3.5 text-sm font-bold text-white transition-colors hover:bg-violet-500 sm:w-auto"
          >
            Browse Tournaments
          </Link>
          <a
            href={WHATSAPP_COMMUNITY}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full max-w-xs rounded-xl border border-slate-700 px-7 py-3.5 text-sm font-bold text-white transition-colors hover:border-slate-500 sm:w-auto"
          >
            Join Community
          </a>
        </div>
      </section>

      <PromoBanner banner={banner} />
```

with:

```tsx
      <Hero isLoggedIn={!!user} whatsappUrl={WHATSAPP_COMMUNITY} />

      <TrustedByStrip games={games} />

      <FeatureGrid />

      <StatsBar
        playerCount={playerCount ?? 0}
        tournamentCount={tournamentCount ?? 0}
        gameCount={games.length}
      />

      <PromoBanner banner={banner} />
```

(Everything from the `Featured / Active Tournament` section through the closing `FaqSection`/`JsonLd`
lines at the end of the file is unchanged.)

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run`
Expected: PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
git add app/page.tsx
git commit -m "feat: wire Hero/TrustedByStrip/FeatureGrid/StatsBar into the homepage"
```

---

### Task 8: Nav restructure — `SiteHeader` + `AccountMenu`

**Files:**
- Modify: `components/shared/SiteHeader.tsx`
- Modify: `components/shared/AccountMenu.tsx`

- [ ] **Step 1: Replace the desktop nav list**

In `components/shared/SiteHeader.tsx`, replace:

```ts
const NAV = [
  { href: '/tournaments', label: 'Tournaments' },
  { href: '/tv', label: 'TV' },
  { href: '/community', label: 'Community' },
  { href: '/exchange', label: 'Exchange' },
  { href: '/rankings', label: 'Rankings' },
  { href: '/players', label: 'Players' },
]
```

with:

```ts
const NAV = [
  { href: '/', label: 'Home' },
  { href: '/tournaments', label: 'Tournaments' },
  { href: '/games', label: 'Games' },
  { href: '/rankings', label: 'Leaderboards' },
  { href: '/exchange', label: 'Store' },
  { href: '/community', label: 'Community' },
  { href: '/about', label: 'About Us' },
]
```

- [ ] **Step 2: Replace the logged-out branch in `AccountMenu`**

In `components/shared/AccountMenu.tsx`, replace:

```tsx
  if (!session.isLoggedIn) {
    return (
      <Link
        href="/login"
        className="rounded-lg px-3 py-1.5 text-sm text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
      >
        Log in
      </Link>
    )
  }
```

with:

```tsx
  if (!session.isLoggedIn) {
    return (
      <div className="flex items-center gap-2">
        <Link
          href="/login"
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm font-bold text-slate-200 transition-colors hover:border-slate-500"
        >
          Login
        </Link>
        <Link
          href="/signup"
          className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-bold text-white transition-colors hover:bg-violet-500"
        >
          Register
        </Link>
      </div>
    )
  }
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: PASS, no regressions (no existing tests target these two files).

- [ ] **Step 5: Commit**

```bash
git add components/shared/SiteHeader.tsx components/shared/AccountMenu.tsx
git commit -m "feat: restructure desktop nav and add Login/Register buttons"
```

---

### Task 9: New `/games` page

**Files:**
- Create: `app/(public)/games/page.tsx`

**Interfaces:**
- Consumes: `dedupeGamesByName` (Task 1).

- [ ] **Step 1: Implement the page**

Create `app/(public)/games/page.tsx`:

```tsx
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { dedupeGamesByName } from '@/lib/games/dedupe'
import { buildMetadata } from '@/lib/seo/metadata'
import { DEFAULT_OG_IMAGE } from '@/lib/seo/site'

export const metadata = buildMetadata({
  title: 'Games · SentinelX Esports',
  description:
    "Every game Sentinel X Esports supports — active tournaments today, and what's coming next.",
  path: '/games',
  image: DEFAULT_OG_IMAGE,
})

export default async function GamesPage() {
  const supabase = createClient()
  const { data: rawGames } = await supabase
    .from('games')
    .select('name, slug, icon_url, active, created_at')
    .order('created_at')
  const games = dedupeGamesByName(rawGames ?? [])

  return (
    <div className="mx-auto max-w-5xl px-4 pb-20 pt-8">
      <h1 className="mb-2 text-2xl font-black text-white">Games</h1>
      <p className="mb-8 text-sm text-slate-400">
        Sentinel X Esports is built for multiple games from day one. Here&apos;s what you can compete in
        today, and what&apos;s coming next.
      </p>
      {games.length === 0 ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 text-center text-sm text-slate-500">
          No games listed yet.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {games.map((g) =>
            g.active ? (
              <Link
                key={g.name}
                href={`/tournaments?game=${g.slug}`}
                className="rounded-2xl border border-slate-800 bg-slate-900 p-5 text-center transition-colors hover:border-violet-500/40"
              >
                <p className="text-sm font-bold text-white">{g.name}</p>
                <p className="mt-1 text-xs text-violet-400">View tournaments →</p>
              </Link>
            ) : (
              <div
                key={g.name}
                className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 text-center opacity-60"
              >
                <p className="text-sm font-bold text-slate-300">{g.name}</p>
                <p className="mt-1 text-xs text-slate-500">Coming soon</p>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "app/(public)/games/page.tsx"
git commit -m "feat: add /games page listing the game catalog"
```

---

### Task 10: New `/about` page

**Files:**
- Create: `app/(public)/about/page.tsx`

- [ ] **Step 1: Implement the page**

Create `app/(public)/about/page.tsx`:

```tsx
import { buildMetadata } from '@/lib/seo/metadata'
import { DEFAULT_OG_IMAGE } from '@/lib/seo/site'

export const metadata = buildMetadata({
  title: 'About Us · SentinelX Esports',
  description: "Sentinel X Esports is building Nigeria's home of mobile esports — our mission and story.",
  path: '/about',
  image: DEFAULT_OG_IMAGE,
})

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 pb-20 pt-10 text-center">
      <p className="mb-2 text-xs font-bold uppercase tracking-widest text-violet-400">About Us</p>
      <h1 className="mb-6 text-2xl font-black text-white">Nigeria&apos;s Home of Mobile Esports</h1>
      <p className="mb-4 text-sm text-slate-400">
        Sentinel X Esports exists to build the most trusted and exciting mobile esports platform in
        Africa — a place where gamers compete, connect, and transact safely.
      </p>
      <p className="mb-4 text-sm text-slate-400">
        We started with Dream League Soccer because that&apos;s where Nigeria&apos;s mobile gaming
        community already was — but Sentinel X was built from day one to grow into every game our
        players care about, not stay a one-game platform.
      </p>
      <p className="text-sm text-slate-400">
        Behind Sentinel X is a small team of Nigerian gamers and builders who believe competitive mobile
        gaming deserves real tournaments, real prizes, and a real community — not just screenshots in a
        WhatsApp group.
      </p>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "app/(public)/about/page.tsx"
git commit -m "feat: add /about page"
```

---

### Task 11: Manual verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite and build**

Run: `npx vitest run`
Expected: PASS, all tests green (including the 4 new `dedupeGamesByName` tests).

Run: `npm run build`
Expected: succeeds with no type or lint errors, including the two new routes (`/games`, `/about`)
appearing in the route summary.

- [ ] **Step 2: Manually verify in the browser**

Start the dev server (`npm run dev`) and check, at both a mobile width (375px) and desktop width:
- Homepage: new hero renders with the placeholder mascot box, Register Now/Explore buttons work, trusted-by
  strip shows real game names (DLS active, others "Coming soon"), feature grid's six cards link correctly,
  stats bar shows real (small, non-inflated) numbers. Confirm the live tournament / leaderboard / WhatsApp
  CTA / FAQ sections below still render exactly as before.
- Guide bubble: visible when logged out, clicking × dismisses it and it stays dismissed on reload; log in
  and confirm it never renders at all; confirm "How It Works" scrolls to the feature grid without being
  obscured by the sticky header.
- Nav: desktop shows Home/Tournaments/Games/Leaderboards/Store/Community/About Us; logged-out shows
  Login+Register buttons; logged-in still shows the notification bell + account dropdown unchanged; mobile
  width still shows the existing bottom tab bar, unaffected.
- `/games`: active game (DLS) links to `/tournaments?game=dls` and actually filters; inactive games show
  "Coming soon" and aren't links.
- `/about`: renders the short mission/story copy.

- [ ] **Step 3: Report results**

No commit for this task — verification only. If any manual check fails, return to the relevant task, fix,
and re-run its checks before re-verifying.
