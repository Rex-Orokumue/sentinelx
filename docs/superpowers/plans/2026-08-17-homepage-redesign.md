# Homepage Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the SentinelX homepage body (`app/page.tsx`, between `SiteHeader` and `SiteFooter`) to match `sentinelx-homepage-mockup.html`'s section structure, with an added "gamey" motion pass (count-up stats, tier glows, hover lift).

**Architecture:** Pure frontend/presentational work on top of the existing Phase 1 dark/purple design system (`sx.*` Tailwind tokens, `Barlow Condensed`/`Inter` fonts — already in place, no new tokens needed). New homepage sections are new components under `components/home/`; two existing shared components (`TournamentCard`, `HexAvatar`) are reused as-is or lightly extended. One new client-side count-up hook powers the "gamey" number animations. One new data query (a `prize_pool` sum over completed tournaments) feeds the Hero.

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind CSS, Supabase JS client, Vitest (`.test.ts`, node environment — no component/DOM tests in this codebase; see Global Constraints).

**Spec:** `docs/superpowers/specs/2026-08-17-homepage-redesign-design.md`

## Global Constraints

- Scope is `app/page.tsx` body content only. `SiteHeader`, `SiteFooter`, and `SentinelBubble` internals are untouched.
- Mobile-first: every new component must read correctly at 375px before scaling up (CLAUDE.md rule #1).
- Server Components by default; add `'use client'` only where a component actually needs hooks/interactivity (CLAUDE.md rule #8). In this plan that's exactly two files: the `useCountUp` hook and any component that calls it directly (`Hero`, `LeaderboardRow`).
- No new Tailwind tokens, no new DB migrations/columns. Reuse the existing `sx.*` color scale, the existing `HexAvatar`, `TierBadge`, and `deriveTournamentResults` — don't reimplement logic that already exists.
- This codebase's Vitest config is `environment: 'node'`, `include: ['**/*.test.ts']` — there is no jsdom/React Testing Library setup, so components are not unit-tested here. Only genuinely testable *pure logic* (extracted into plain `.ts` files) gets a `.test.ts`. Presentational components get a typecheck/build pass instead, matching how every other component in this codebase is verified.
- `TournamentCard` is also used on `/tournaments` (`app/(public)/tournaments/page.tsx`) — its restyle (Task 6) is a shared-component change, not homepage-only. This is intentional: the same visual language should render everywhere the card is used.
- Respect `prefers-reduced-motion` on all count-up animations (spec requirement).
- Run `npm run test` (not a filtered path) before each commit that touches `lib/` — it's fast and catches unrelated regressions early.

---

### Task 1: Count-up animation — pure math + client hook

**Files:**
- Create: `lib/home/count-up.ts`
- Test: `lib/home/count-up.test.ts`
- Create: `lib/home/useCountUp.ts`

**Interfaces:**
- Consumes: nothing (foundational task)
- Produces: `computeCountUpValue(elapsedMs: number, durationMs: number, to: number): number` and `useCountUp<T extends HTMLElement>(target: number, durationMs?: number): { ref: React.RefObject<T>; value: number }` — both consumed by Task 2 (`Hero`) and Task 7 (`LeaderboardRow`).

- [ ] **Step 1: Write the failing test for the pure interpolation function**

Create `lib/home/count-up.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { computeCountUpValue } from './count-up'

describe('computeCountUpValue', () => {
  it('returns 0 at the start', () => {
    expect(computeCountUpValue(0, 1000, 500)).toBe(0)
  })

  it('returns the target once elapsed reaches the duration', () => {
    expect(computeCountUpValue(1000, 1000, 500)).toBe(500)
  })

  it('clamps to the target when elapsed exceeds the duration', () => {
    expect(computeCountUpValue(5000, 1000, 500)).toBe(500)
  })

  it('returns the target immediately when duration is zero or negative', () => {
    expect(computeCountUpValue(0, 0, 500)).toBe(500)
    expect(computeCountUpValue(100, -50, 500)).toBe(500)
  })

  it('eases out — more than half the value is covered by the midpoint', () => {
    const halfway = computeCountUpValue(500, 1000, 1000)
    expect(halfway).toBeGreaterThan(500)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/home/count-up.test.ts`
Expected: FAIL — `count-up.ts` doesn't exist yet (`Cannot find module './count-up'`).

- [ ] **Step 3: Implement the pure interpolation function**

Create `lib/home/count-up.ts`:

```ts
/**
 * Pure interpolation for a count-up animation — given elapsed time, total
 * duration, and a target value, returns the value to render right now.
 * Ease-out cubic, so the count feels like it's decelerating into place
 * rather than ticking up linearly. Clamped to `to` once elapsed >= duration,
 * and short-circuits to `to` for a non-positive duration.
 */
export function computeCountUpValue(elapsedMs: number, durationMs: number, to: number): number {
  if (durationMs <= 0) return to
  const progress = Math.min(1, Math.max(0, elapsedMs / durationMs))
  const eased = 1 - Math.pow(1 - progress, 3)
  return Math.round(to * eased)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/home/count-up.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Write the client hook that wires the math to scroll-into-view + reduced-motion**

Create `lib/home/useCountUp.ts`:

```ts
'use client'
import { useEffect, useRef, useState } from 'react'
import { computeCountUpValue } from './count-up'

const DEFAULT_DURATION_MS = 1400

/**
 * Animates `target` counting up from 0 once its host element scrolls into
 * view. Skips straight to `target` when the user has `prefers-reduced-motion`
 * set, and only ever plays once per mount (re-triggering on every scroll back
 * into view would be distracting, not "gamey"). No test file — this is thin
 * browser-API wiring (IntersectionObserver + requestAnimationFrame) around
 * the tested `computeCountUpValue`; this codebase doesn't unit-test DOM
 * wiring (see Global Constraints).
 */
export function useCountUp<T extends HTMLElement>(target: number, durationMs = DEFAULT_DURATION_MS) {
  const ref = useRef<T>(null)
  const [value, setValue] = useState(0)
  const played = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setValue(target)
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (played.current || !entries[0]?.isIntersecting) return
        played.current = true
        observer.disconnect()

        const start = performance.now()
        function tick(now: number) {
          const elapsed = now - start
          setValue(computeCountUpValue(elapsed, durationMs, target))
          if (elapsed < durationMs) requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      },
      { threshold: 0.3 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [target, durationMs])

  return { ref, value }
}
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add lib/home/count-up.ts lib/home/count-up.test.ts lib/home/useCountUp.ts
git commit -m "feat(home): add count-up animation hook

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Rebuild `Hero`

**Files:**
- Modify: `components/home/Hero.tsx` (full rewrite)

**Interfaces:**
- Consumes: `useCountUp` from `lib/home/useCountUp.ts` (Task 1); `formatNaira` from `lib/format.ts` (existing).
- Produces: `Hero({ playerCount, tournamentCount, prizesPaidOut }: { playerCount: number; tournamentCount: number; prizesPaidOut: number }): JSX.Element` — consumed by Task 4 (`app/page.tsx`).

- [ ] **Step 1: Rewrite the component**

Replace the full contents of `components/home/Hero.tsx`:

```tsx
'use client'

import Image from 'next/image'
import Link from 'next/link'
import { formatNaira } from '@/lib/format'
import { useCountUp } from '@/lib/home/useCountUp'

const HEX_GRID_BG =
  "url(\"data:image/svg+xml,%3Csvg width='60' height='69' viewBox='0 0 60 69' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' stroke='%23ffffff' stroke-width='0.8'%3E%3Cpolygon points='30,1 57,16 57,53 30,68 3,53 3,16'/%3E%3C/g%3E%3C/svg%3E\")"

export function Hero({
  playerCount,
  tournamentCount,
  prizesPaidOut,
}: {
  playerCount: number
  tournamentCount: number
  prizesPaidOut: number
}) {
  const players = useCountUp<HTMLSpanElement>(playerCount)
  const tournaments = useCountUp<HTMLSpanElement>(tournamentCount)
  const prizes = useCountUp<HTMLSpanElement>(prizesPaidOut)

  return (
    <section className="relative mb-10 overflow-hidden px-4 pb-10 pt-10 sm:px-6 lg:px-8 lg:pb-14 lg:pt-14">
      {/* Purple radial top, faint gold radial bottom-right — matches the mockup's hero::before */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 90% 65% at 50% -5%, rgba(124,58,237,0.22) 0%, transparent 65%), ' +
            'radial-gradient(ellipse 50% 40% at 95% 105%, rgba(245,158,11,0.07) 0%, transparent 55%)',
        }}
      />
      {/* Hex grid texture — matches the mockup's hero::after */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.045]"
        style={{ backgroundImage: HEX_GRID_BG, backgroundSize: '60px 69px' }}
      />

      <div className="relative flex flex-col items-center gap-8 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-xl text-center lg:text-left">
          <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-sx-purple/30 bg-sx-purple/10 px-4 py-1.5 text-[11px] font-bold uppercase tracking-widest text-sx-purple-text">
            🇳🇬 Nigeria&apos;s #1 Mobile Esports Platform
          </span>

          <h1 className="font-display text-6xl font-black uppercase leading-[0.93] tracking-tight text-white sm:text-7xl lg:text-8xl">
            <span className="block">Nigeria&apos;s</span>
            <span className="block">Home of</span>
            <span className="block text-sx-purple-text">Mobile Esports</span>
          </h1>

          <p className="mx-auto mt-5 max-w-md text-sm text-sx-gray sm:text-base lg:mx-0">
            Compete in tournaments, climb the rankings, and win real money — all on your
            phone. Nigeria&apos;s most trusted mobile esports platform.
          </p>

          <div className="mt-7 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
            <Link
              href="/tournaments"
              className="flex w-full max-w-xs items-center justify-center gap-2 rounded-lg bg-sx-purple px-7 py-3.5 font-display text-sm font-bold uppercase tracking-wide text-white shadow-[0_0_20px_rgba(124,58,237,0.4)] transition-colors hover:bg-sx-purple-light sm:w-auto"
            >
              🎮 Enter a Tournament
            </Link>
            <Link
              href="/rankings"
              className="w-full max-w-xs rounded-lg border border-white/20 px-7 py-3.5 text-center text-sm font-bold text-white transition-colors hover:border-white/40 sm:w-auto"
            >
              View Rankings →
            </Link>
          </div>

          <div className="mt-7 flex flex-wrap justify-center gap-8 border-t border-sx-border pt-6 lg:justify-start">
            <div>
              <span ref={players.ref} className="block font-display text-3xl font-black leading-none text-white">
                {players.value}+
              </span>
              <span className="mt-0.5 block text-[11px] font-medium uppercase tracking-widest text-sx-gray/80">
                Registered Players
              </span>
            </div>
            <div>
              <span ref={prizes.ref} className="block font-display text-3xl font-black leading-none text-sx-amber">
                {formatNaira(prizes.value)}+
              </span>
              <span className="mt-0.5 block text-[11px] font-medium uppercase tracking-widest text-sx-gray/80">
                Prizes Paid Out
              </span>
            </div>
            <div>
              <span ref={tournaments.ref} className="block font-display text-3xl font-black leading-none text-white">
                {tournaments.value}
              </span>
              <span className="mt-0.5 block text-[11px] font-medium uppercase tracking-widest text-sx-gray/80">
                Tournaments Run
              </span>
            </div>
          </div>
        </div>

        {/* Mascot — kept in-scene (established brand identity), in-flow below the
            fold on mobile, pinned to the hero's bottom-right at lg+. */}
        <div className="relative h-56 w-44 shrink-0 sm:h-72 sm:w-56 lg:h-96 lg:w-72">
          <Image
            src="/mascot/mascot-home.png"
            alt="Sentinel, the Sentinel X mascot"
            fill
            priority
            sizes="(min-width: 1024px) 18rem, (min-width: 640px) 14rem, 11rem"
            className="object-contain object-bottom"
          />
        </div>
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors only in `app/page.tsx` (still calling `<Hero />` with no props) — that's expected until Task 4. Confirm there are no errors *inside* `Hero.tsx` itself.

- [ ] **Step 3: Commit**

```bash
git add components/home/Hero.tsx
git commit -m "feat(home): rebuild Hero full-bleed with animated stats

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: `LiveTournamentStrip` component

**Files:**
- Create: `components/home/LiveTournamentStrip.tsx`

**Interfaces:**
- Consumes: `TournamentCardData` type from `components/tournament/TournamentCard.tsx` (existing), `formatNaira` from `lib/format.ts`.
- Produces: `LiveTournamentStrip({ tournament }: { tournament: TournamentCardData | null }): JSX.Element | null` — consumed by Task 4.

- [ ] **Step 1: Create the component**

Create `components/home/LiveTournamentStrip.tsx`:

```tsx
import Link from 'next/link'
import { formatNaira } from '@/lib/format'
import type { TournamentCardData } from '@/components/tournament/TournamentCard'

// Full-width banner directly under the Hero. Replaces the old
// StatsBar+LiveTournamentCard slot. Renders nothing when there's no
// active/registration_open tournament — Four Pillars becomes the first
// section after the Hero instead (spec: empty-state is omission, not a
// placeholder card).
export function LiveTournamentStrip({ tournament: t }: { tournament: TournamentCardData | null }) {
  if (!t) return null

  const isLive = t.status === 'active'

  return (
    <div className="mx-4 mb-10 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-sx-purple/25 bg-gradient-to-r from-sx-purple/10 to-transparent px-5 py-4 sm:mx-6 lg:mx-8">
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-md border border-sx-green/30 bg-sx-green/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-sx-green">
          <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-sx-green" />
          {isLive ? 'Live Now' : 'Registration Open'}
        </span>
        <span className="font-display text-base font-bold uppercase tracking-wide text-white">{t.title}</span>
        <span className="flex flex-wrap items-center gap-3 text-sm">
          <span className="font-semibold text-sx-amber">{formatNaira(t.prize_pool)} Prize Pool</span>
          {t.max_players != null && <span className="text-sx-gray">· {t.max_players} max players</span>}
        </span>
      </div>
      <Link
        href={`/tournaments/${t.slug}`}
        className="whitespace-nowrap rounded-lg bg-sx-purple px-4 py-2 font-display text-xs font-bold uppercase tracking-wide text-white transition-colors hover:bg-sx-purple-light"
      >
        {isLive ? 'Watch Now' : `Register — ${formatNaira(t.registration_fee)}`}
      </Link>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors inside `LiveTournamentStrip.tsx`.

- [ ] **Step 3: Commit**

```bash
git add components/home/LiveTournamentStrip.tsx
git commit -m "feat(home): add LiveTournamentStrip component

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Wire Hero + LiveTournamentStrip into `app/page.tsx`; add prizes-paid-out data; remove `TrustedByStrip`/`StatsBar`/`LiveTournamentCard`/tagline banner

**Files:**
- Modify: `app/page.tsx`
- Delete: `components/home/TrustedByStrip.tsx`, `components/home/StatsBar.tsx`, `components/home/LiveTournamentCard.tsx`

**Interfaces:**
- Consumes: `Hero` (Task 2), `LiveTournamentStrip` (Task 3).
- Produces: `app/page.tsx` now computes and threads `prizesPaidOut: number` — no other task depends on this beyond this one.

- [ ] **Step 1: Confirm nothing else imports the three components being deleted**

Run: `grep -rn "TrustedByStrip\|StatsBar\|LiveTournamentCard" --include=*.tsx components app | grep -v "components/home/TrustedByStrip.tsx\|components/home/StatsBar.tsx\|components/home/LiveTournamentCard.tsx\|components/community/CommunityStatsBar.tsx"`
Expected: only `app/page.tsx` (this was verified during planning — `CommunityStatsBar` is an unrelated component on `/community`, not affected).

- [ ] **Step 2: Update imports in `app/page.tsx`**

Remove these lines:
```ts
import { Crown } from 'lucide-react'
```
```ts
import { TrustedByStrip } from '@/components/home/TrustedByStrip'
```
```ts
import { StatsBar } from '@/components/home/StatsBar'
```
```ts
import { LiveTournamentCard } from '@/components/home/LiveTournamentCard'
```
```ts
import { dedupeGamesByName } from '@/lib/games/dedupe'
```

Add:
```ts
import { LiveTournamentStrip } from '@/components/home/LiveTournamentStrip'
```

- [ ] **Step 3: Replace the games/stats data fetching with a prize-pool query**

In the `Promise.all` inside `HomePage()`, replace:

```ts
  const [
    { data: rawTournaments },
    { data: players },
    { data: rawBanner },
    { data: rawGames },
    { count: playerCount },
    { count: tournamentCount },
  ] = await Promise.all([
    supabase
      .from('tournaments')
      .select(
        'id, title, slug, prize_pool, registration_fee, status, tournament_start, registration_end, tournament_end, max_players, format, tournament_type, games(name, icon_url)'
      )
      .in('status', ['active', 'registration_open'])
      .order('created_at', { ascending: false })
      .limit(4),
    supabase
      .from('profiles')
      .select('id, username, display_name, wins, total_matches, sx_score, sentinel_tier')
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
  ])

  const games = dedupeGamesByName(rawGames ?? [])
```

with:

```ts
  const [
    { data: rawTournaments },
    { data: players },
    { data: rawBanner },
    { data: completedTournaments },
    { count: playerCount },
    { count: tournamentCount },
  ] = await Promise.all([
    supabase
      .from('tournaments')
      .select(
        'id, title, slug, prize_pool, registration_fee, status, tournament_start, registration_end, tournament_end, max_players, format, tournament_type, games(name, icon_url)'
      )
      .in('status', ['active', 'registration_open'])
      .order('created_at', { ascending: false })
      .limit(4),
    supabase
      .from('profiles')
      .select('id, username, display_name, avatar_url, wins, total_matches, sx_score, sentinel_tier, membership_tier')
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
    // Hero's "Prizes Paid Out" stat. Summed client-side (not a huge dataset —
    // one row per completed tournament) rather than a DB aggregate/RPC, matching
    // this file's existing style of plain selects + counts.
    supabase.from('tournaments').select('prize_pool').eq('status', 'completed'),
    supabase.from('profiles').select('*', { count: 'exact', head: true }),
    supabase.from('tournaments').select('*', { count: 'exact', head: true }).neq('status', 'draft'),
  ])

  const prizesPaidOut = (completedTournaments ?? []).reduce((sum, t) => sum + (t.prize_pool ?? 0), 0)
```

(Note: this task adds `avatar_url` and `membership_tier` to the `profiles` select for Task 7's leaderboard rows now, since it's the same query — no reason to touch this `Promise.all` twice.)

- [ ] **Step 4: Update the JSX**

Replace:

```tsx
      <Hero />

      <TrustedByStrip games={games} />

      <FeatureGrid />

      {/* ── Stats Overview + Live Tournament ─────────────────── */}
      <section className="mb-10 grid gap-6 lg:grid-cols-2">
        <StatsBar
          playerCount={playerCount ?? 0}
          tournamentCount={tournamentCount ?? 0}
          gameCount={games.length}
        />
        <LiveTournamentCard tournament={featured} />
      </section>

      {/* ── Tagline banner ────────────────────────────────────── */}
      <section className="mb-10 rounded-xl border border-sx-border bg-sx-surface px-6 py-10 text-center">
        <Crown className="mx-auto mb-3 h-7 w-7 text-sx-purple-text" />
        <p className="font-display text-2xl font-black uppercase tracking-wide text-white sm:text-3xl">
          One Guardian. Every Moment.
        </p>
        <p className="mt-2 font-display text-sm font-bold uppercase tracking-widest text-sx-purple-text">
          Where Gamers Unite. Champions Rise.
        </p>
      </section>

      <PromoBanner banner={banner} />
```

with:

```tsx
      <Hero
        playerCount={playerCount ?? 0}
        tournamentCount={tournamentCount ?? 0}
        prizesPaidOut={prizesPaidOut}
      />

      <LiveTournamentStrip tournament={featured} />

      <FeatureGrid />

      <PromoBanner banner={banner} />
```

(`FeatureGrid` is replaced with `FourPillars` in Task 5 — left as-is here so this task's diff stays focused on Hero/LiveTournamentStrip/data plumbing. `PromoBanner` moves to its final spec position in Task 10.)

- [ ] **Step 5: Delete the three now-dead components**

```bash
rm components/home/TrustedByStrip.tsx components/home/StatsBar.tsx components/home/LiveTournamentCard.tsx
```

- [ ] **Step 6: Typecheck and build**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add app/page.tsx
git rm components/home/TrustedByStrip.tsx components/home/StatsBar.tsx components/home/LiveTournamentCard.tsx
git commit -m "feat(home): wire Hero + LiveTournamentStrip, add prizes-paid-out stat

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: `FourPillars` component, replaces `FeatureGrid`

**Files:**
- Create: `components/home/FourPillars.tsx`
- Delete: `components/home/FeatureGrid.tsx`
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: nothing (static content).
- Produces: `FourPillars(): JSX.Element` — consumed by `app/page.tsx` only.

- [ ] **Step 1: Create the component**

Create `components/home/FourPillars.tsx`:

```tsx
import Link from 'next/link'

// CLAUDE.md's Four Pillars, verbatim — replaces the old FeatureGrid, whose
// six-item list had drifted from the documented pillars (Compete/Watch/
// Community/Trade).
const PILLARS = [
  {
    emoji: '🎮',
    accent: 'bg-sx-purple/10 text-sx-purple-text',
    name: 'Compete',
    body: 'Enter tournaments, get matched, and prove your rank. Every result admin-verified — no disputes go unresolved.',
    href: '/tournaments',
  },
  {
    emoji: '📺',
    accent: 'bg-sx-amber/10 text-sx-amber',
    name: 'Watch',
    body: 'Sentinel X TV — live finals, match replays, and highlights. Every big match streamed on our YouTube channel.',
    href: '/tv',
  },
  {
    emoji: '🤝',
    accent: 'bg-sx-green/10 text-sx-green',
    name: 'Community',
    body: "Connect with Nigeria's best mobile gamers. Share clips, discuss tactics, and stay updated on platform news.",
    href: '/community',
  },
  {
    emoji: '🔒',
    accent: 'bg-blue-500/10 text-blue-400',
    name: 'Trade',
    body: 'Gaming Exchange powered by Zolarux escrow. Buy and sell gaming accounts with zero risk.',
    href: '/exchange',
  },
] as const

export function FourPillars() {
  return (
    <section className="mb-10 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
      {PILLARS.map((p) => (
        <Link
          key={p.name}
          href={p.href}
          className="flex flex-col gap-3.5 rounded-xl border border-sx-border bg-sx-surface p-5 transition-all hover:-translate-y-0.5 hover:border-sx-purple/40 hover:shadow-[0_0_15px_rgba(124,58,237,0.15)]"
        >
          <div className={`flex h-11 w-11 items-center justify-center rounded-[10px] text-xl ${p.accent}`}>
            {p.emoji}
          </div>
          <div>
            <p className="mb-1 font-display text-lg font-bold uppercase tracking-wide text-white">{p.name}</p>
            <p className="text-xs leading-relaxed text-sx-gray">{p.body}</p>
          </div>
        </Link>
      ))}
    </section>
  )
}
```

- [ ] **Step 2: Swap the import and usage in `app/page.tsx`**

Replace:
```ts
import { FeatureGrid } from '@/components/home/FeatureGrid'
```
with:
```ts
import { FourPillars } from '@/components/home/FourPillars'
```

Replace `<FeatureGrid />` with `<FourPillars />`.

- [ ] **Step 3: Delete the old component**

```bash
rm components/home/FeatureGrid.tsx
```

- [ ] **Step 4: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
git add components/home/FourPillars.tsx app/page.tsx
git rm components/home/FeatureGrid.tsx
git commit -m "feat(home): replace FeatureGrid with canonical FourPillars

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Restyle `TournamentCard` (standard + champion variants)

**Files:**
- Modify: `components/tournament/TournamentCard.tsx` (full rewrite)

**Interfaces:**
- Consumes: `formatDate`, `formatNaira` from `lib/format.ts` (existing).
- Produces: same public interface as before — `TournamentCard({ tournament: TournamentCardData; featured?: boolean }): JSX.Element`, `TournamentCardData` type unchanged. No consumer needs to change. Affects both `app/page.tsx` and `app/(public)/tournaments/page.tsx` (shared component — see Global Constraints).

- [ ] **Step 1: Rewrite the component**

Replace the full contents of `components/tournament/TournamentCard.tsx`:

```tsx
import Link from 'next/link'
import { formatDate, formatNaira } from '@/lib/format'

export interface TournamentCardData {
  id: string
  title: string
  slug: string
  prize_pool: number
  registration_fee: number
  status: string
  tournament_start: string | null
  registration_end: string | null
  tournament_end?: string | null
  max_players: number | null
  format?: string | null
  tournament_type?: string | null
  games: { name: string; icon_url: string | null } | null
}

const STATUS: Record<string, { label: string; cls: string; dot?: boolean }> = {
  active:              { label: 'LIVE',        cls: 'bg-sx-green/10 text-sx-green border-sx-green/30', dot: true },
  registration_open:   { label: 'OPEN',        cls: 'bg-sx-green/10 text-sx-green border-sx-green/30' },
  registration_closed: { label: 'UPCOMING',    cls: 'bg-sx-amber/10 text-sx-amber border-sx-amber/30' },
  completed:           { label: 'ENDED',       cls: 'bg-white/5 text-sx-gray border-white/10' },
}

// "single_elimination" → "Single Elimination"
function humanize(value: string): string {
  return value
    .split('_')
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(' ')
}

export function TournamentCard({
  tournament: t,
  featured = false,
}: {
  tournament: TournamentCardData
  featured?: boolean
}) {
  const status = STATUS[t.status] ?? STATUS.completed
  // Champions Cup — the annual invitational flagship (see
  // supabase/migrations/047_season_system.sql's tournament_type check
  // constraint: 'open' | 'community_club' | 'masters' | 'champions_cup').
  // Gets the gold-accent treatment; the mockup's "Season Championship" card.
  const isChampionsCup = t.tournament_type === 'champions_cup'

  return (
    <Link
      href={`/tournaments/${t.slug}`}
      className={`flex flex-col rounded-xl border p-5 transition-all hover:-translate-y-0.5 ${
        isChampionsCup
          ? 'border-sx-amber/25 bg-gradient-to-br from-sx-amber/[0.06] to-sx-surface hover:shadow-[0_0_15px_rgba(245,158,11,0.15)]'
          : `bg-sx-surface hover:shadow-[0_0_15px_rgba(124,58,237,0.15)] ${
              featured ? 'border-sx-purple/30' : 'border-sx-border hover:border-sx-purple/40'
            }`
      }`}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <span
          className={`rounded-md border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
            isChampionsCup ? 'border-sx-amber/25 text-sx-amber' : 'border-sx-border text-sx-gray'
          }`}
        >
          {isChampionsCup ? 'Season Championship' : t.games?.name ?? 'Mobile Esports'}
        </span>
        <span
          className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${status.cls}`}
        >
          {status.dot && <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-sx-green" />}
          {status.label}
        </span>
      </div>

      <h3
        className={`mb-3.5 font-display font-bold leading-tight ${featured ? 'text-2xl' : 'text-lg'} ${
          isChampionsCup ? 'text-sx-amber' : 'text-white'
        }`}
      >
        {t.title}
      </h3>

      <div className="mb-4 grid flex-1 grid-cols-2 gap-x-3 gap-y-2.5">
        <Stat label="Prize Pool" value={formatNaira(t.prize_pool)} accent="gold" />
        <Stat label="Format" value={t.format ? humanize(t.format) : '—'} />
        {isChampionsCup ? (
          <>
            <Stat label="Eligibility" value="Top 16 Players" />
            <Stat label="Qualifier" value="Auto — Season Points" />
          </>
        ) : (
          <>
            <Stat label="Entry Fee" value={formatNaira(t.registration_fee)} />
            <Stat
              label={t.status === 'registration_closed' ? 'Starts' : 'Max Players'}
              value={
                t.status === 'registration_closed' && t.tournament_start
                  ? formatDate(t.tournament_start) ?? '—'
                  : t.max_players != null
                    ? String(t.max_players)
                    : '—'
              }
              accent={t.status === 'registration_open' ? 'green' : undefined}
            />
          </>
        )}
      </div>

      <span
        className={`block rounded-lg py-2.5 text-center font-display text-xs font-bold uppercase tracking-wide ${
          isChampionsCup
            ? 'border border-sx-amber/30 text-sx-amber'
            : t.status === 'registration_open'
              ? 'bg-sx-purple text-white'
              : 'border border-white/10 text-sx-gray'
        }`}
      >
        {isChampionsCup
          ? 'Learn More'
          : t.status === 'registration_open'
            ? `Register Now — ${formatNaira(t.registration_fee)}`
            : 'View Details'}
      </span>
    </Link>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: 'gold' | 'green' }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-sx-gray/80">{label}</p>
      <p
        className={`font-display text-sm font-bold ${
          accent === 'gold' ? 'text-sx-amber' : accent === 'green' ? 'text-sx-green' : 'text-white'
        }`}
      >
        {value}
      </p>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: both succeed (the `TournamentCardData` export shape is unchanged, so `app/(public)/tournaments/page.tsx` and `app/page.tsx` keep compiling).

- [ ] **Step 3: Commit**

```bash
git add components/tournament/TournamentCard.tsx
git commit -m "feat(tournament): restyle TournamentCard, add champions-cup variant

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Rebuild the leaderboard preview as hex-avatar rows

**Files:**
- Create: `components/home/LeaderboardRow.tsx`
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: `useCountUp` (Task 1), `HexAvatar` from `components/shared/HexAvatar.tsx` (existing), `TierBadge` from `components/player/TierBadge.tsx` (existing), `MembershipTier` from `lib/membership/tiers.ts` (existing).
- Produces: `LeaderboardRow({ player: LeaderboardPlayer; rank: number }): JSX.Element`, `LeaderboardPlayer` interface — consumed by `app/page.tsx` only.

- [ ] **Step 1: Create the row component**

Create `components/home/LeaderboardRow.tsx`:

```tsx
'use client'

import { HexAvatar } from '@/components/shared/HexAvatar'
import { TierBadge } from '@/components/player/TierBadge'
import { useCountUp } from '@/lib/home/useCountUp'
import type { MembershipTier } from '@/lib/membership/tiers'

export interface LeaderboardPlayer {
  id: string
  username: string | null
  display_name: string | null
  avatar_url: string | null
  wins: number
  sx_score: number
  sentinel_tier: string | null
  // Supabase's generated type for this column is plain `string` (see
  // lib/supabase/types.ts) — same convention already used by
  // PlayerStatsInput.membershipTier and AllTimeAwardCard's prop; cast to
  // MembershipTier at the HexAvatar call site below, not in this interface.
  membership_tier: string | null
}

// Rank 1/2/3/rest colors, matching the mockup's r-gold/r-silver/r-bronze/r-dim.
const RANK_CLASS = ['text-sx-amber', 'text-white/70', 'text-amber-700', 'text-sx-gray']

export function LeaderboardRow({ player, rank }: { player: LeaderboardPlayer; rank: number }) {
  const score = useCountUp<HTMLSpanElement>(player.sx_score)
  const name = player.display_name ?? player.username ?? 'Anonymous'
  const rankClass = RANK_CLASS[Math.min(rank - 1, 3)]

  return (
    <div
      className={`flex items-center gap-3.5 rounded-xl border border-sx-border bg-sx-bg p-3 transition-colors hover:border-sx-purple/40 ${
        rank <= 3 ? 'bg-sx-purple/[0.04]' : ''
      }`}
    >
      <span className={`w-6 shrink-0 text-center font-display text-xl font-black ${rankClass}`}>{rank}</span>
      <HexAvatar
        src={player.avatar_url}
        username={name}
        tier={(player.membership_tier ?? 'recruit') as MembershipTier}
        size="sm"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-white">{name}</p>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-sx-gray">
          <TierBadge tier={player.sentinel_tier} />
          <span>· {player.wins} Wins</span>
        </div>
      </div>
      <div className="shrink-0 text-right">
        <span ref={score.ref} className="block font-display text-xl font-black leading-none text-white">
          {score.value}
        </span>
        <span className="mt-0.5 block text-[10px] font-medium uppercase tracking-widest text-sx-gray/70">
          SX Score
        </span>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Replace the leaderboard `<table>` in `app/page.tsx`**

Add the import:
```ts
import { LeaderboardRow } from '@/components/home/LeaderboardRow'
```

Replace:
```tsx
        <div className="overflow-hidden rounded-xl border border-sx-border bg-sx-surface">
          {leaderboard.length === 0 ? (
            <EmptyState
              icon="🏅"
              title="Rankings coming soon"
              body="Be the first to compete and claim the top spot."
            />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-sx-border text-[11px] uppercase tracking-widest text-sx-gray">
                  <th className="px-4 py-3 text-left">#</th>
                  <th className="px-4 py-3 text-left">Player</th>
                  <th className="px-4 py-3 text-right">Wins</th>
                  <th className="hidden px-4 py-3 text-right sm:table-cell">Matches</th>
                  <th className="hidden px-4 py-3 text-right sm:table-cell">SX Score</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((player, i) => (
                  <tr
                    key={player.id}
                    className="border-b border-sx-border/60 transition-colors last:border-0 hover:bg-white/[0.03]"
                  >
                    <td className="px-4 py-3.5 font-bold text-sx-gray">
                      {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-bold text-white">
                          {((player.username ?? player.display_name ?? '?')[0] ?? '?').toUpperCase()}
                        </div>
                        <div>
                          <p className="font-semibold leading-tight text-white">
                            {player.display_name ?? player.username ?? 'Anonymous'}
                          </p>
                          <TierBadge tier={player.sentinel_tier} />
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-right font-bold text-sx-green">
                      {player.wins}
                    </td>
                    <td className="hidden px-4 py-3.5 text-right text-sx-gray sm:table-cell">
                      {player.total_matches}
                    </td>
                    <td className="hidden px-4 py-3.5 text-right font-bold text-sx-purple-text sm:table-cell">
                      {player.sx_score}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
```

with:
```tsx
        {leaderboard.length === 0 ? (
          <EmptyState
            icon="🏅"
            title="Rankings coming soon"
            body="Be the first to compete and claim the top spot."
          />
        ) : (
          <div className="flex flex-col gap-2">
            {leaderboard.map((player, i) => (
              <LeaderboardRow key={player.id} player={player} rank={i + 1} />
            ))}
          </div>
        )}
```

The now-unused `TierBadge` import in `app/page.tsx` stays — it's still used inside `LeaderboardRow`, but that's a separate file's import, not this one's. Check whether `app/page.tsx` still uses `TierBadge` directly anywhere else in the file after this edit; if not, remove its import line from `app/page.tsx` (it moved into `LeaderboardRow.tsx`).

- [ ] **Step 3: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: both succeed.

- [ ] **Step 4: Commit**

```bash
git add components/home/LeaderboardRow.tsx app/page.tsx
git commit -m "feat(home): rebuild leaderboard preview as hex-avatar rows

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Hall of Fame teaser — data helper + component

**Files:**
- Create: `lib/home/hall-of-fame-teaser.ts`
- Test: `lib/home/hall-of-fame-teaser.test.ts`
- Create: `components/home/HallOfFameTeaser.tsx`
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: `deriveTournamentResults`, `TournamentResultInput` from `lib/hall-of-fame/tournament-results.ts` (existing, already tested); `BracketMatch` from `lib/tournaments/bracket.ts` (existing); `formatNaira` from `lib/format.ts`.
- Produces: `buildHallOfFameTeaserData(tournament: ChampionsCupTournamentRow | null, finalMatch: BracketMatch | null): HallOfFameTeaserData | null`, `ChampionsCupTournamentRow`, `HallOfFameTeaserData` types — consumed by `app/page.tsx`. `HallOfFameTeaser({ data: HallOfFameTeaserData | null }): JSX.Element | null` — consumed by `app/page.tsx`.

- [ ] **Step 1: Write the failing test for the data helper**

Create `lib/home/hall-of-fame-teaser.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildHallOfFameTeaserData, type ChampionsCupTournamentRow } from './hall-of-fame-teaser'
import type { BracketMatch } from '@/lib/tournaments/bracket'

function tournament(over: Partial<ChampionsCupTournamentRow> = {}): ChampionsCupTournamentRow {
  return {
    id: 't1',
    slug: 'champions-cup-s7',
    title: 'SentinelX Champions Cup S7',
    tournament_end: '2026-08-10',
    prize_pool: 200000,
    gameName: 'Dream League Soccer',
    ...over,
  }
}

function finalMatch(over: Partial<BracketMatch> = {}): BracketMatch {
  return {
    id: 'm1',
    round: 'final',
    group_id: null,
    groupName: null,
    status: 'completed',
    score_a: 3,
    score_b: 1,
    scheduled_at: null,
    is_full_day: false,
    playerA: { id: 'p1', name: 'Akintunde_K' },
    playerB: { id: 'p2', name: 'DavidEsports' },
    ...over,
  }
}

describe('buildHallOfFameTeaserData', () => {
  it('returns the champion when a completed final has a winner', () => {
    const result = buildHallOfFameTeaserData(tournament(), finalMatch())
    expect(result).toEqual({
      slug: 'champions-cup-s7',
      title: 'SentinelX Champions Cup S7',
      prizePool: 200000,
      gameName: 'Dream League Soccer',
      championName: 'Akintunde_K',
    })
  })

  it('returns null when there is no tournament', () => {
    expect(buildHallOfFameTeaserData(null, finalMatch())).toBeNull()
  })

  it('returns null when there is no final match yet', () => {
    expect(buildHallOfFameTeaserData(tournament(), null)).toBeNull()
  })

  it('returns null when the final is a tie (no resolvable winner)', () => {
    expect(buildHallOfFameTeaserData(tournament(), finalMatch({ score_a: 2, score_b: 2 }))).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/home/hall-of-fame-teaser.test.ts`
Expected: FAIL — `hall-of-fame-teaser.ts` doesn't exist yet.

- [ ] **Step 3: Implement the data helper**

Create `lib/home/hall-of-fame-teaser.ts`:

```ts
import { deriveTournamentResults, type TournamentResultInput } from '@/lib/hall-of-fame/tournament-results'
import type { BracketMatch } from '@/lib/tournaments/bracket'

export interface ChampionsCupTournamentRow {
  id: string
  slug: string
  title: string
  tournament_end: string | null
  prize_pool: number
  gameName: string | null
}

export interface HallOfFameTeaserData {
  slug: string
  title: string
  prizePool: number
  gameName: string | null
  championName: string
}

// Homepage-scoped: same champion-resolution rule the Hall of Fame page uses
// for its Champions Cup section (`deriveTournamentResults`), narrowed to
// "latest completed Champions Cup only". Returns null when there's no
// resolvable champion yet — the teaser section is omitted entirely in that
// case (see HallOfFameTeaser).
export function buildHallOfFameTeaserData(
  tournament: ChampionsCupTournamentRow | null,
  finalMatch: BracketMatch | null,
): HallOfFameTeaserData | null {
  if (!tournament || !finalMatch) return null

  const input: TournamentResultInput = {
    tournamentId: tournament.id,
    slug: tournament.slug,
    title: tournament.title,
    prizePool: tournament.prize_pool,
    tournamentEnd: tournament.tournament_end,
    finalMatch,
  }
  const [result] = deriveTournamentResults([input])
  if (!result) return null

  return {
    slug: result.slug,
    title: result.title,
    prizePool: result.prizePool,
    gameName: tournament.gameName,
    championName: result.champion.name,
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/home/hall-of-fame-teaser.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Create the presentational component**

Create `components/home/HallOfFameTeaser.tsx`:

```tsx
import Link from 'next/link'
import { formatNaira } from '@/lib/format'
import type { HallOfFameTeaserData } from '@/lib/home/hall-of-fame-teaser'

export function HallOfFameTeaser({ data }: { data: HallOfFameTeaserData | null }) {
  if (!data) return null

  return (
    <section className="mb-10">
      <p className="mb-1 text-xs font-bold uppercase tracking-widest text-sx-purple-text">Hall of Fame</p>
      <h2 className="mb-4 font-display text-2xl font-black uppercase text-white">Champions Cup</h2>
      <div className="flex flex-wrap items-center gap-6 rounded-2xl border border-sx-amber/20 bg-gradient-to-br from-sx-amber/[0.07] to-sx-surface p-7">
        <span className="text-5xl leading-none">🏆</span>
        <div className="flex-1">
          <p className="mb-1 text-[11px] font-bold uppercase tracking-widest text-sx-amber">
            Champions Cup Winner{data.gameName ? ` · ${data.gameName}` : ''}
          </p>
          <p className="font-display text-2xl font-black uppercase leading-none text-white">
            {data.championName}
          </p>
          <p className="mt-1.5 text-sm text-sx-gray">
            {data.title} · {formatNaira(data.prizePool)} won
          </p>
        </div>
        <Link
          href="/hall-of-fame"
          className="ml-auto shrink-0 self-end text-sm font-semibold text-sx-amber transition-colors hover:text-amber-300"
        >
          View Hall of Fame →
        </Link>
      </div>
    </section>
  )
}
```

- [ ] **Step 6: Wire the query + component into `app/page.tsx`**

Add imports:
```ts
import { HallOfFameTeaser } from '@/components/home/HallOfFameTeaser'
import { buildHallOfFameTeaserData, type HallOfFameTeaserData } from '@/lib/home/hall-of-fame-teaser'
import type { BracketMatch } from '@/lib/tournaments/bracket'
```

After the existing `Promise.all` block in `HomePage()` (once `prizesPaidOut` etc. are computed), add the Champions Cup lookup:

```ts
  const { data: championsCupRow } = await supabase
    .from('tournaments')
    .select('id, slug, title, tournament_end, prize_pool, games(name)')
    .eq('tournament_type', 'champions_cup')
    .eq('status', 'completed')
    .order('tournament_end', { ascending: false })
    .limit(1)
    .maybeSingle()

  let hallOfFameTeaserData: HallOfFameTeaserData | null = null
  if (championsCupRow) {
    const { data: finalMatchRow } = await supabase
      .from('matches')
      .select(
        'id, round, status, score_a, score_b, ' +
          'player_a:profiles!matches_player_a_id_fkey(id, username, display_name), ' +
          'player_b:profiles!matches_player_b_id_fkey(id, username, display_name)',
      )
      .eq('tournament_id', championsCupRow.id)
      .eq('round', 'final')
      .eq('status', 'completed')
      .maybeSingle()

    // Supabase to-one FK embeds can arrive as an object or a single-element
    // array depending on the inferred relationship — same caveat
    // app/(public)/hall-of-fame/page.tsx already documents and normalizes
    // for this exact `profiles!matches_player_a_id_fkey` join shape.
    type EmbeddedProfile = { id: string; username: string | null; display_name: string | null }
    function firstProfile(p: EmbeddedProfile | EmbeddedProfile[] | null): EmbeddedProfile | null {
      return Array.isArray(p) ? (p[0] ?? null) : p
    }

    const playerA = finalMatchRow ? firstProfile(finalMatchRow.player_a) : null
    const playerB = finalMatchRow ? firstProfile(finalMatchRow.player_b) : null

    const finalMatch: BracketMatch | null = finalMatchRow
      ? {
          id: finalMatchRow.id,
          round: finalMatchRow.round,
          group_id: null,
          groupName: null,
          status: finalMatchRow.status,
          score_a: finalMatchRow.score_a,
          score_b: finalMatchRow.score_b,
          scheduled_at: null,
          is_full_day: false,
          playerA: { id: playerA?.id ?? '', name: playerA?.display_name ?? playerA?.username ?? 'TBD' },
          playerB: { id: playerB?.id ?? '', name: playerB?.display_name ?? playerB?.username ?? 'TBD' },
        }
      : null

    const gameName = Array.isArray(championsCupRow.games)
      ? (championsCupRow.games[0]?.name ?? null)
      : (championsCupRow.games?.name ?? null)

    hallOfFameTeaserData = buildHallOfFameTeaserData(
      {
        id: championsCupRow.id,
        slug: championsCupRow.slug,
        title: championsCupRow.title,
        tournament_end: championsCupRow.tournament_end,
        prize_pool: championsCupRow.prize_pool,
        gameName,
      },
      finalMatch,
    )
  }
```

Insert `<HallOfFameTeaser data={hallOfFameTeaserData} />` in the JSX right after the Leaderboard Preview `</section>` closing tag.

- [ ] **Step 7: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: both succeed — the `firstProfile` normalizer above already handles the object-vs-array embed ambiguity, matching `app/(public)/hall-of-fame/page.tsx`'s established pattern for the same join.

- [ ] **Step 8: Commit**

```bash
git add lib/home/hall-of-fame-teaser.ts lib/home/hall-of-fame-teaser.test.ts components/home/HallOfFameTeaser.tsx app/page.tsx
git commit -m "feat(home): add Hall of Fame Champions Cup teaser

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: `HowItWorks` component

**Files:**
- Create: `components/home/HowItWorks.tsx`
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: nothing (static content).
- Produces: `HowItWorks(): JSX.Element` — consumed by `app/page.tsx`.

- [ ] **Step 1: Create the component**

Create `components/home/HowItWorks.tsx`:

```tsx
const STEPS = [
  {
    num: '01',
    icon: '👤',
    title: 'Create Your Account',
    body: "Sign up free. Choose your username — it's your identity on the platform and your referral code.",
  },
  {
    num: '02',
    icon: '🎮',
    title: 'Enter a Tournament',
    body: 'Pay the ₦500 entry fee via Paystack. Registration closes, brackets auto-generate, fixtures are posted.',
  },
  {
    num: '03',
    icon: '⚔️',
    title: 'Play Your Match',
    body: 'Meet your opponent at the scheduled time. Play fair. Screen record your game as proof of the result.',
  },
  {
    num: '04',
    icon: '📸',
    title: 'Submit Your Proof',
    body: 'Upload your screenshot and screen recording via your Player Dashboard within the submission window.',
  },
  {
    num: '05',
    icon: '✅',
    title: 'Admin Verifies',
    body: 'Our admin reviews submissions and confirms the result. The bracket updates — no guesswork, no disputes left unresolved.',
  },
  {
    num: '06',
    icon: '💰',
    title: 'Withdraw Your Prize',
    body: 'Win and your prize lands in your wallet. Withdraw directly to your bank account via Paystack Transfer.',
  },
] as const

// id="how-it-works" is the real anchor target now (moved off the old
// FeatureGrid, which never had matching content to scroll to).
export function HowItWorks() {
  return (
    <section id="how-it-works" className="mb-10 scroll-mt-20">
      <p className="mb-1 text-xs font-bold uppercase tracking-widest text-sx-purple-text">How It Works</p>
      <h2 className="mb-2 font-display text-3xl font-black uppercase leading-none text-white">
        From Sign-Up to Pay-Out
      </h2>
      <p className="mb-6 max-w-lg text-sm leading-relaxed text-sx-gray">
        SentinelX is built around a simple, fair loop: create your account, enter a tournament, play, submit
        proof, get paid.
      </p>
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        {STEPS.map((s) => (
          <div key={s.num} className="flex flex-col gap-2 rounded-xl border border-sx-border bg-sx-surface p-5">
            <span className="font-display text-4xl font-black leading-none text-sx-purple/50">{s.num}</span>
            <span className="text-2xl">{s.icon}</span>
            <p className="font-display text-lg font-bold uppercase tracking-wide text-white">{s.title}</p>
            <p className="text-sm leading-relaxed text-sx-gray">{s.body}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Wire it into `app/page.tsx`**

Add import:
```ts
import { HowItWorks } from '@/components/home/HowItWorks'
```

Insert `<HowItWorks />` right after `<HallOfFameTeaser data={hallOfFameTeaserData} />`.

- [ ] **Step 3: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: both succeed.

- [ ] **Step 4: Commit**

```bash
git add components/home/HowItWorks.tsx app/page.tsx
git commit -m "feat(home): add How It Works section

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: `HomeFinalCta`; remove the WhatsApp CTA section; relocate `PromoBanner`

**Files:**
- Create: `components/home/HomeFinalCta.tsx`
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: nothing (static content).
- Produces: `HomeFinalCta(): JSX.Element` — consumed by `app/page.tsx`. This is the last new section — after this task, `app/page.tsx`'s section order matches the spec exactly.

- [ ] **Step 1: Create the component**

Create `components/home/HomeFinalCta.tsx`:

```tsx
import Link from 'next/link'

export function HomeFinalCta() {
  return (
    <section className="relative mb-10 overflow-hidden rounded-2xl border border-sx-border bg-sx-surface px-6 py-14 text-center">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ background: 'radial-gradient(ellipse, rgba(124,58,237,0.13) 0%, transparent 70%)' }}
      />
      <div className="relative">
        <h2 className="mb-3 font-display text-5xl font-black uppercase leading-[0.95] text-white sm:text-6xl">
          Ready to Compete?
        </h2>
        <p className="mb-8 text-sm text-sx-gray sm:text-base">
          Join hundreds of Nigerian mobile gamers already competing on SentinelX.
          <br />
          Registration is free. First tournament entry from ₦500.
        </p>
        <Link
          href="/signup"
          className="inline-flex items-center gap-2 rounded-lg bg-sx-purple px-9 py-3.5 font-display text-base font-black uppercase tracking-wide text-white shadow-[0_0_20px_rgba(124,58,237,0.4)] transition-all hover:-translate-y-0.5 hover:bg-sx-purple-light"
        >
          Create Your Account →
        </Link>
        <p className="mt-4 text-xs text-sx-gray">
          Already registered?{' '}
          <Link href="/login" className="text-sx-purple-text hover:text-white">
            Sign In
          </Link>
        </p>
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Remove the WhatsApp CTA section from `app/page.tsx`, move `PromoBanner`, add `HomeFinalCta`**

Remove `<PromoBanner banner={banner} />` from its current position (right after `<FourPillars />`, added there in Task 4).

Replace:
```tsx
      {/* ── WhatsApp Community CTA ───────────────────────────── */}
      <section className="rounded-xl border border-[#25D366]/20 bg-[#25D366]/5 p-8 text-center">
        <p className="mb-3 text-4xl">💬</p>
        <h2 className="mb-2 text-xl font-bold text-white">Join Our WhatsApp Community</h2>
        <p className="mb-6 text-sm text-sx-gray">
          Get tournament alerts, live match updates, and connect with Nigerian mobile gamers.
        </p>
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <a
            href={WHATSAPP_COMMUNITY}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-full max-w-xs items-center justify-center gap-2 rounded-lg bg-[#25D366] px-6 py-3 text-sm font-bold text-white transition-opacity hover:opacity-90 sm:w-auto"
          >
            <WhatsAppIcon />
            Join Community
          </a>
          <a
            href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-full max-w-xs items-center justify-center gap-2 rounded-lg border border-[#25D366]/30 px-6 py-3 text-sm font-bold text-[#25D366] transition-colors hover:bg-[#25D366]/10 sm:w-auto"
          >
            <WhatsAppIcon />
            Share on WhatsApp
          </a>
        </div>
      </section>
```
with:
```tsx
      <PromoBanner banner={banner} />

      <HomeFinalCta />
```

placed right after `<HowItWorks />` — i.e. the tail of the JSX becomes:
```tsx
      <HallOfFameTeaser data={hallOfFameTeaserData} />

      <HowItWorks />

      <PromoBanner banner={banner} />

      <HomeFinalCta />

      <FaqSection items={HOMEPAGE_FAQS} />
      <JsonLd data={buildFaqJsonLd(HOMEPAGE_FAQS)} />

      <SentinelBubble variant="home" />
```

Add the import:
```ts
import { HomeFinalCta } from '@/components/home/HomeFinalCta'
```

- [ ] **Step 3: Remove dead code**

Delete the now-unused `WhatsAppIcon` function at the bottom of `app/page.tsx`, the `WHATSAPP_COMMUNITY` constant, and the `shareText` local variable — all three were only used by the section just removed. Confirm with a search before deleting:

Run: `grep -n "WHATSAPP_COMMUNITY\|shareText\|WhatsAppIcon" app/page.tsx`
Expected: only the declaration lines remain (no more call sites) — delete each.

- [ ] **Step 4: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: both succeed, with no unused-variable warnings for the three removed identifiers.

- [ ] **Step 5: Commit**

```bash
git add components/home/HomeFinalCta.tsx app/page.tsx
git commit -m "feat(home): add Final CTA, drop WhatsApp CTA section, relocate PromoBanner

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 11: Final verification pass

**Files:** none (verification only — no code changes expected; if this step surfaces a real defect, fix it in the relevant file and note the fix in the commit).

**Interfaces:**
- Consumes: the fully assembled homepage from Tasks 1–10.
- Produces: a confirmed-working homepage — the deliverable this whole plan builds toward.

- [ ] **Step 1: Confirm section order matches the spec**

Read the full `app/page.tsx` top to bottom and confirm the JSX order is exactly:
`Hero → LiveTournamentStrip → FourPillars → Upcoming Tournaments → Leaderboard Preview → HallOfFameTeaser → HowItWorks → PromoBanner → HomeFinalCta → FaqSection/JsonLd → SentinelBubble`.

- [ ] **Step 2: Run the full test suite**

Run: `npm run test`
Expected: all tests pass, including the new `lib/home/count-up.test.ts` and `lib/home/hall-of-fame-teaser.test.ts`.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: succeeds with no type errors.

- [ ] **Step 4: Manual responsive check**

Run the dev server (`npm run dev`) and view `/` at 375px, 768px, and 1280px viewport widths. Confirm: Hero headline/mascot don't overlap or overflow at 375px; the Four Pillars grid is 2-col at 375px and 4-col at 1280px; the Champions Cup `TournamentCard` variant (if a champions_cup tournament exists in the dev data, otherwise skip) doesn't clip its Eligibility/Qualifier stats; leaderboard rows don't truncate names awkwardly at 375px.

- [ ] **Step 5: Manual reduced-motion check**

In Chrome DevTools, enable "Emulate CSS media feature prefers-reduced-motion: reduce" (Rendering tab), reload `/`, and confirm the Hero stats and leaderboard SX Scores render their final values immediately with no count-up animation.

- [ ] **Step 6: Manual empty-state check**

If dev data allows: confirm `LiveTournamentStrip` renders nothing (not a placeholder) when no tournament has `status` in `active`/`registration_open`, and `HallOfFameTeaser` renders nothing when no `champions_cup` tournament has completed with a resolvable final.

- [ ] **Step 7: Commit (only if Step 1–6 required a fix)**

If everything already matched, there's nothing to commit for this task — the plan is complete as of Task 10's commit. If a fix was needed, commit it with a message describing what verification caught.
