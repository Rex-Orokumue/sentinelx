# Site-wide Navigation Transition Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replicate the user-supplied page-transition overlay (purple shard wipe → logo slam + shockwave → progress bar → shard reveal) as a global, zero-call-site-change navigation effect covering every internal link on Sentinel X.

**Architecture:** One client component (`NavTransitionProvider`) mounted once in the root layout attaches a capture-phase `click` listener plus a `popstate` listener, runs the timing state machine, and renders a purely presentational overlay (`NavTransitionOverlay`) while a transition is in flight. No other file in the app needs to change to participate — every existing `<Link>`/`<a>` is caught automatically.

**Tech Stack:** Next.js 14 App Router, React (`useTransition`, `usePathname`, `useSearchParams`), CSS Modules, `next/font/google`.

**Spec:** `docs/superpowers/specs/2026-08-16-nav-transition-animation-design.md` — this plan implements it section by section; read both together.

## Global Constraints

- Accent color is the fixed Sentinel X brand purple `#7C3AED` everywhere in this feature — never the source mockup's `#a855f7`, never a per-instance prop (the source's `accent`/`speed`/`shards` were the design tool's own live-editing controls; here they're constants).
- The overlay's label/status/percentage text uses **Chakra Petch** (loaded via `next/font/google`, scoped to this feature only) — the rest of the site keeps Barlow Condensed untouched.
- Reveal timing: **1400ms minimum, extended until the destination has actually rendered** — never a fixed timer that could reveal unfinished content (spec §3.2).
- Respect `prefers-reduced-motion: reduce` — navigation still happens, the overlay never mounts.
- `useSearchParams()` in a Client Component opts the tree out of static rendering unless wrapped in `<Suspense>` — `NavTransitionProvider` MUST be wrapped in `<Suspense fallback={null}>` where it's mounted in `app/layout.tsx`, or every page in the app silently loses static generation.
- No test file exists for `components/shared/SiteHeader.tsx`, `MobileNavSheet.tsx`, or any sibling presentational component in this codebase — DOM/timer-driven pieces here follow that same convention (manual verification, not unit tests). Only the pure-logic exclusion filter (Task 1) gets unit tests.

---

### Task 1: Link-interception pure logic

**Files:**
- Create: `lib/nav/transition-guard.ts`
- Test: `lib/nav/transition-guard.test.ts`

**Interfaces:**
- Produces: `isInterceptableLinkClick(info: LinkClickInfo, currentOrigin: string): boolean`, `shouldPlayTransition(fromHref: string, toHref: string, prefersReducedMotion: boolean): boolean`, `type LinkClickInfo`. `NavTransitionProvider` (Task 4) is the only consumer.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/nav/transition-guard.test.ts
import { describe, it, expect } from 'vitest'
import { isInterceptableLinkClick, shouldPlayTransition, type LinkClickInfo } from './transition-guard'

const ORIGIN = 'https://sentinelxesports.vercel.app'
function baseInfo(overrides: Partial<LinkClickInfo> = {}): LinkClickInfo {
  return {
    href: `${ORIGIN}/tournaments`,
    target: null,
    download: false,
    ariaDisabled: false,
    modifierOrAuxClick: false,
    ...overrides,
  }
}

describe('isInterceptableLinkClick', () => {
  it('intercepts a plain same-origin internal link', () => {
    expect(isInterceptableLinkClick(baseInfo(), ORIGIN)).toBe(true)
  })

  it('does not intercept a different-origin link', () => {
    expect(isInterceptableLinkClick(baseInfo({ href: 'https://wa.me/1234' }), ORIGIN)).toBe(false)
  })

  it('does not intercept target=_blank', () => {
    expect(isInterceptableLinkClick(baseInfo({ target: '_blank' }), ORIGIN)).toBe(false)
  })

  it('does not intercept a download link', () => {
    expect(isInterceptableLinkClick(baseInfo({ download: true }), ORIGIN)).toBe(false)
  })

  it('does not intercept an aria-disabled link', () => {
    expect(isInterceptableLinkClick(baseInfo({ ariaDisabled: true }), ORIGIN)).toBe(false)
  })

  it('does not intercept a modifier-key or auxiliary-button click', () => {
    expect(isInterceptableLinkClick(baseInfo({ modifierOrAuxClick: true }), ORIGIN)).toBe(false)
  })

  it('does not intercept mailto:/tel:/sms: links', () => {
    expect(isInterceptableLinkClick(baseInfo({ href: 'mailto:hi@sentinelx.gg' }), ORIGIN)).toBe(false)
    expect(isInterceptableLinkClick(baseInfo({ href: 'tel:+2348000000000' }), ORIGIN)).toBe(false)
  })

  it('does not intercept a malformed href', () => {
    expect(isInterceptableLinkClick(baseInfo({ href: 'not a url and not a path' }), ORIGIN)).toBe(false)
  })

  it('treats target="_self" as interceptable', () => {
    expect(isInterceptableLinkClick(baseInfo({ target: '_self' }), ORIGIN)).toBe(true)
  })
})

describe('shouldPlayTransition', () => {
  const FROM = `${ORIGIN}/tournaments`

  it('plays for a genuinely different destination', () => {
    expect(shouldPlayTransition(FROM, `${ORIGIN}/community`, false)).toBe(true)
  })

  it('does not play for an identical URL (clicking the page you are already on)', () => {
    expect(shouldPlayTransition(FROM, FROM, false)).toBe(false)
  })

  it('plays when only the query string changes — a same-page data refetch', () => {
    expect(shouldPlayTransition(FROM, `${ORIGIN}/tournaments?status=open`, false)).toBe(true)
  })

  it('does not play for a hash-only difference — an in-page anchor scroll', () => {
    expect(shouldPlayTransition(`${ORIGIN}/about#faq`, `${ORIGIN}/about#team`, false)).toBe(false)
  })

  it('does not play when the user prefers reduced motion, even for a real navigation', () => {
    expect(shouldPlayTransition(FROM, `${ORIGIN}/community`, true)).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/nav/transition-guard.test.ts`
Expected: FAIL — `Cannot find module './transition-guard'`

- [ ] **Step 3: Implement**

```ts
// lib/nav/transition-guard.ts
export interface LinkClickInfo {
  href: string
  target: string | null
  download: boolean
  ariaDisabled: boolean
  modifierOrAuxClick: boolean // ctrlKey || metaKey || shiftKey || altKey || button !== 0
}

// Should this click be handed to the transition system at all, vs left
// entirely to native browser/Next.js default behavior? Spec §4.1.
export function isInterceptableLinkClick(info: LinkClickInfo, currentOrigin: string): boolean {
  if (info.modifierOrAuxClick) return false
  if (info.download) return false
  if (info.ariaDisabled) return false
  if (info.target && info.target !== '_self') return false
  if (/^(mailto|tel|sms):/i.test(info.href)) return false

  let url: URL
  try {
    url = new URL(info.href, currentOrigin)
  } catch {
    return false
  }
  return url.origin === currentOrigin
}

// Given an intercepted, same-origin click, should the overlay actually play?
// Compared as full URL (pathname + search + hash), not just pathname — a
// query-string-only change is a real navigation (e.g. a same-page filter
// that refetches data) and must still play; a hash-only change is an
// in-page anchor scroll and must not. Spec §4.1.
export function shouldPlayTransition(fromHref: string, toHref: string, prefersReducedMotion: boolean): boolean {
  if (prefersReducedMotion) return false
  const from = new URL(fromHref)
  const to = new URL(toHref)
  if (from.href === to.href) return false
  if (from.pathname === to.pathname && from.search === to.search) return false
  return true
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/nav/transition-guard.test.ts`
Expected: PASS (14 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/nav/transition-guard.ts lib/nav/transition-guard.test.ts
git commit -m "feat(nav): pure link-interception logic for the transition overlay" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Header logo idle pulse + transparent crest asset

**Files:**
- Create: `public/logo.png` (copy from the supplied zip — transparent, pre-cropped Sentinel X crest, 412×384)
- Modify: `tailwind.config.ts`
- Modify: `components/shared/SiteHeader.tsx`

**Interfaces:**
- Produces: `public/logo.png` (consumed by `NavTransitionOverlay` in Task 3), Tailwind `animate-idle-pulse` utility class.

- [ ] **Step 1: Add the crest asset**

Copy the zip's `logo.png` (extracted at `<scratchpad>/nav-animation/logo.png`) to `public/logo.png` in the repo. This is the same source crest as `public/logo-icon.png`/`public/logo-full.png`, just already transparent and tightly cropped — neither existing file works for the slam animation since both carry a watermark/neon backdrop baked into the PNG.

- [ ] **Step 2: Add the `idlePulse` keyframe alongside the header's existing brand pulses**

```ts
// tailwind.config.ts — add to theme.extend.keyframes, alongside sentinelPulse/legendGlow/float:
        idlePulse: {
          '0%, 100%': { filter: 'drop-shadow(0 0 14px rgba(124,58,237,.45))' },
          '50%':      { filter: 'drop-shadow(0 0 34px rgba(124,58,237,.9))' },
        },
```

```ts
// tailwind.config.ts — add to theme.extend.animation, alongside the existing entries:
        'idle-pulse': 'idlePulse 3.4s ease-in-out infinite',
```

- [ ] **Step 3: Apply it to the header logo**

```tsx
// components/shared/SiteHeader.tsx — the existing logo <Image>:
            <Image src="/logo-icon.png" alt="SentinelX Esports" width={32} height={32} priority className="animate-idle-pulse" />
```

- [ ] **Step 4: Run typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors

- [ ] **Step 5: Manual verification**

Run `npm run dev`, confirm the header logo has a slow, subtle purple glow breathing effect (not distracting, ~3.4s cycle).

- [ ] **Step 6: Commit**

```bash
git add public/logo.png tailwind.config.ts components/shared/SiteHeader.tsx
git commit -m "feat(nav): add transparent crest asset and header logo idle pulse" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: The overlay — presentation only

**Files:**
- Create: `components/transitions/NavTransitionOverlay.module.css`
- Create: `components/transitions/NavTransitionOverlay.tsx`

**Interfaces:**
- Consumes: `public/logo.png` (Task 2).
- Produces: `<NavTransitionOverlay phase="cover"|"reveal" pct={number} targetLabel={string} />`. `NavTransitionProvider` (Task 4) is the only consumer. No knowledge of routing — pure presentation, driven entirely by props.

- [ ] **Step 1: Write the CSS Module — all ten keyframes, transcribed exactly from the source (spec §1.1)**

```css
/* components/transitions/NavTransitionOverlay.module.css */
.overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  pointer-events: none;
  overflow: hidden;
}

/* ---- Shards ---- */
.shard {
  position: absolute;
  top: -8%;
  height: 116%;
  border-left: 1px solid rgba(124, 58, 237, 0.33);
  animation-duration: 520ms;
  animation-timing-function: cubic-bezier(0.76, 0, 0.24, 1);
  animation-fill-mode: both;
}
.shardCover { animation-name: shardIn; }
.shardReveal { animation-name: shardOut; }

@keyframes shardIn {
  from { transform: skewX(-11deg) translateY(-115%); }
  to   { transform: skewX(-11deg) translateY(0); }
}
@keyframes shardOut {
  from { transform: skewX(-11deg) translateY(0); }
  to   { transform: skewX(-11deg) translateY(115%); }
}

/* ---- Core (logo / shockwave / label / bar) ---- */
.core {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.shockRing {
  position: absolute;
  width: 260px;
  height: 260px;
  border-radius: 50%;
  opacity: 0;
  animation-timing-function: cubic-bezier(0.1, 0.8, 0.3, 1);
  animation-fill-mode: both;
}
.shockRing1 { border: 2px solid #7c3aed; animation-name: shock; animation-duration: 900ms; animation-delay: 560ms; }
.shockRing2 { border: 1px solid rgba(124, 58, 237, 0.47); animation-name: shock; animation-duration: 1100ms; animation-delay: 680ms; }
.shockRing.reveal { animation: none; opacity: 0; }

@keyframes shock {
  0%   { transform: scale(0.15); opacity: 0; }
  12%  { opacity: 0.9; }
  100% { transform: scale(3.4); opacity: 0; }
}

.logo {
  width: 210px;
  height: auto;
  filter: drop-shadow(0 0 40px rgba(124, 58, 237, 0.8));
  animation: logoSlam 760ms cubic-bezier(0.2, 1.4, 0.4, 1) 170ms both;
}
.logo.reveal { animation: logoOut 420ms ease-in both; }

@keyframes logoSlam {
  0%   { transform: scale(3.2) rotate(-9deg); opacity: 0; filter: blur(14px); }
  55%  { opacity: 1; }
  70%  { transform: scale(0.9) rotate(0deg); filter: blur(0); }
  84%  { transform: scale(1.06); }
  100% { transform: scale(1); opacity: 1; filter: blur(0); }
}
@keyframes logoOut {
  from { transform: scale(1); opacity: 1; }
  to   { transform: scale(2.6); opacity: 0; }
}

.label {
  font-weight: 700;
  font-size: 13px;
  letter-spacing: 0.55em;
  text-transform: uppercase;
  color: #fff;
  margin-top: 34px;
  text-shadow: 0 0 18px #7c3aed;
  animation: jitter 220ms steps(2) 620ms 3, riseIn 300ms ease 560ms both;
}
.label.reveal { animation: logoOut 420ms ease-in both; }

@keyframes jitter {
  0%, 100% { transform: translate(0, 0); }
  20% { transform: translate(-2px, 1px); }
  40% { transform: translate(2px, -1px); }
  60% { transform: translate(-1px, -2px); }
  80% { transform: translate(1px, 2px); }
}
@keyframes riseIn {
  from { opacity: 0; transform: translateY(26px); }
  to   { opacity: 1; transform: translateY(0); }
}

.barWrap {
  position: relative;
  width: 260px;
  height: 3px;
  margin-top: 22px;
  background: rgba(255, 255, 255, 0.09);
  overflow: hidden;
}
.barWrap.reveal { animation: logoOut 420ms ease-in both; }

.bar {
  position: absolute;
  inset: 0;
  transform-origin: left;
  background: linear-gradient(90deg, #7c3aed, #f0abfc);
  box-shadow: 0 0 14px #7c3aed;
  animation: barFill 1150ms cubic-bezier(0.5, 0, 0.2, 1) 250ms both;
}
@keyframes barFill {
  from { transform: scaleX(0); }
  to   { transform: scaleX(1); }
}

.sweep {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 40%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.85), transparent);
  animation: sweep 900ms linear 250ms infinite;
}
@keyframes sweep {
  from { transform: translateX(-120%); }
  to   { transform: translateX(320%); }
}

.pct {
  font-size: 11px;
  letter-spacing: 0.3em;
  color: #d8b4fe;
  margin-top: 14px;
}
.pct.reveal { animation: logoOut 420ms ease-in both; }
.pctPercentSign { opacity: 0.5; }
.pctStatus { color: #7d6d90; margin-left: 10px; }

.flash {
  position: absolute;
  inset: 0;
  background: #fff;
  opacity: 0;
  mix-blend-mode: overlay;
  animation: flashOut 420ms ease-out 560ms both;
}
.flash.reveal { animation: none; opacity: 0; }
@keyframes flashOut {
  0%   { opacity: 0.85; }
  100% { opacity: 0; }
}
```

- [ ] **Step 2: Write the component**

```tsx
// components/transitions/NavTransitionOverlay.tsx
'use client'
import Image from 'next/image'
import { Chakra_Petch } from 'next/font/google'
import styles from './NavTransitionOverlay.module.css'

// Scoped to this one component per spec §2 — the rest of the site keeps
// Barlow Condensed. Only the weight the overlay actually uses.
const chakraPetch = Chakra_Petch({ weight: ['700'], subsets: ['latin'] })

const SHARD_COUNT = 6
const SHARD_STAGGER_MS = 55
const STATUS = ['LINKING NODE', 'DECRYPTING', 'LOADING ASSETS', 'SYNCING SQUAD', 'DEPLOYING']

export function NavTransitionOverlay({
  phase,
  pct,
  targetLabel,
}: {
  phase: 'cover' | 'reveal'
  pct: number
  targetLabel: string
}) {
  const reveal = phase === 'reveal'
  const statusText = STATUS[Math.min(STATUS.length - 1, Math.floor(pct / 21))]
  const revealCls = reveal ? styles.reveal : ''

  return (
    <div className={styles.overlay} aria-hidden="true">
      {Array.from({ length: SHARD_COUNT }, (_, i) => {
        // Reveal restarts the stagger from the opposite end — rightmost
        // shard leaves first, mirroring the entering wave. Spec §1.1.A.
        const delay = (reveal ? SHARD_COUNT - 1 - i : i) * SHARD_STAGGER_MS
        const accentTinted = i % 2 === 0
        return (
          <div
            key={i}
            className={`${styles.shard} ${reveal ? styles.shardReveal : styles.shardCover}`}
            style={{
              left: `calc(${(i / SHARD_COUNT) * 100}% - 3%)`,
              width: `calc(${100 / SHARD_COUNT}% + 6%)`,
              background: accentTinted
                ? 'linear-gradient(175deg, rgba(124,58,237,0.13) 0%, #0a0610 62%)'
                : 'linear-gradient(175deg, #12081f 0%, #0a0610 100%)',
              animationDelay: `${delay}ms`,
            }}
          />
        )
      })}

      <div className={styles.core}>
        <div className={`${styles.shockRing} ${styles.shockRing1} ${revealCls}`} />
        <div className={`${styles.shockRing} ${styles.shockRing2} ${revealCls}`} />
        <Image src="/logo.png" alt="" width={412} height={384} priority className={`${styles.logo} ${revealCls}`} />
        <div className={`${styles.label} ${chakraPetch.className} ${revealCls}`}>{targetLabel}</div>
        <div className={`${styles.barWrap} ${revealCls}`}>
          <div className={styles.bar} />
          <div className={styles.sweep} />
        </div>
        <div className={`${styles.pct} ${chakraPetch.className} ${revealCls}`}>
          {pct}
          <span className={styles.pctPercentSign}>%</span>
          <span className={styles.pctStatus}>{statusText}</span>
        </div>
      </div>

      <div className={`${styles.flash} ${revealCls}`} />
    </div>
  )
}
```

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add components/transitions/NavTransitionOverlay.module.css components/transitions/NavTransitionOverlay.tsx
git commit -m "feat(nav): transition overlay component — shards, logo slam, shockwave, progress bar" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: The state machine — click/popstate interception, mounted site-wide

**Files:**
- Create: `components/transitions/NavTransitionProvider.tsx`
- Modify: `app/layout.tsx`

**Interfaces:**
- Consumes: `isInterceptableLinkClick`, `shouldPlayTransition` (Task 1); `NavTransitionOverlay` (Task 3).
- Produces: `<NavTransitionProvider />` — no props, no children, self-contained. Mounted once.

- [ ] **Step 1: Write the provider**

```tsx
// components/transitions/NavTransitionProvider.tsx
'use client'
import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { isInterceptableLinkClick, shouldPlayTransition, type LinkClickInfo } from '@/lib/nav/transition-guard'
import { NavTransitionOverlay } from './NavTransitionOverlay'

// Spec §3.2. The cover animation always runs at least this long even for an
// instantly-ready destination (so a fast page never feels rushed); if the
// destination isn't ready yet, this is a floor, not a ceiling — tryReveal
// keeps re-checking until it is.
const MIN_COVER_MS = 1400
// Matches the source's 2050ms-from-click total (1400 + 650).
const REVEAL_HOLD_MS = 650
const READY_POLL_MS = 80

type Phase = 'cover' | 'reveal' | null

export function NavTransitionProvider() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()

  const [phase, setPhase] = useState<Phase>(null)
  const [pct, setPct] = useState(0)
  const [targetLabel, setTargetLabel] = useState('')

  // Refs, not state — these drive timers/handlers and must never trigger a
  // re-render on their own. Critically, pathnameRef/searchParamsRef exist so
  // tryReveal always reads the CURRENT route: the click/popstate listeners
  // below are attached once (empty deps, so listeners aren't torn down and
  // re-attached on every render) and close over whichever render's
  // beginTransition/tryReveal was current at attach time — reading
  // usePathname()/useSearchParams() directly from that closure would read
  // whatever the route was at mount, not after subsequent navigations.
  // Refs sidestep that entirely: whichever closure calls tryReveal, it reads
  // the live value.
  const phaseRef = useRef<Phase>(null)
  const pathnameRef = useRef(pathname)
  const searchParamsRef = useRef(searchParams)
  const pendingTarget = useRef<{ pathname: string; search: string } | null>(null)
  const coverStartedAt = useRef(0)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const tickInterval = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  useEffect(() => {
    pathnameRef.current = pathname
    searchParamsRef.current = searchParams
  }, [pathname, searchParams])

  function clearTimers() {
    timers.current.forEach(clearTimeout)
    timers.current = []
    if (tickInterval.current) clearInterval(tickInterval.current)
    tickInterval.current = null
  }

  useEffect(() => () => clearTimers(), [])

  function tryReveal() {
    if (!pendingTarget.current) return
    const elapsed = Date.now() - coverStartedAt.current
    const ready =
      pathnameRef.current === pendingTarget.current.pathname &&
      searchParamsRef.current.toString() === pendingTarget.current.search
    if (elapsed < MIN_COVER_MS || !ready) {
      timers.current.push(setTimeout(tryReveal, READY_POLL_MS))
      return
    }
    pendingTarget.current = null
    setPhase('reveal')
    timers.current.push(setTimeout(() => setPhase(null), REVEAL_HOLD_MS))
  }

  function beginTransition(label: string, targetPathname: string, targetSearch: string) {
    clearTimers()
    pendingTarget.current = { pathname: targetPathname, search: targetSearch }
    coverStartedAt.current = Date.now()
    setTargetLabel(label)
    setPct(0)
    setPhase('cover')

    tickInterval.current = setInterval(() => {
      const p = Math.min(1, (Date.now() - coverStartedAt.current) / 1150)
      setPct(Math.floor(p * 100))
      if (p >= 1 && tickInterval.current) {
        clearInterval(tickInterval.current)
        tickInterval.current = null
      }
    }, 40)

    timers.current.push(setTimeout(tryReveal, MIN_COVER_MS))
  }

  // Whenever the route actually settles, re-check immediately — without
  // this, a fast navigation that finishes mid-cover would sit idle until
  // the next 80ms poll tick instead of revealing the moment it's ready.
  useEffect(() => {
    if (phaseRef.current === 'cover' && pendingTarget.current) tryReveal()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams])

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (phaseRef.current) return // ignore clicks mid-transition — matches the source exactly
      const a = (e.target as HTMLElement | null)?.closest?.('a')
      if (!a) return

      const info: LinkClickInfo = {
        href: a.href,
        target: a.getAttribute('target'),
        download: a.hasAttribute('download'),
        ariaDisabled: a.getAttribute('aria-disabled') === 'true',
        modifierOrAuxClick: e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0,
      }
      if (!isInterceptableLinkClick(info, location.origin)) return
      e.preventDefault()

      const toURL = new URL(a.href, location.href)
      const target = toURL.pathname + toURL.search + toURL.hash
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const play = shouldPlayTransition(location.href, toURL.href, reducedMotion)

      if (!play) {
        router.push(target)
        return
      }

      const label = (a.textContent || '').trim() || a.getAttribute('aria-label') || 'LOADING'
      beginTransition(label, toURL.pathname, toURL.search)
      startTransition(() => router.push(target))
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    function onPopState() {
      if (phaseRef.current) return
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      // The browser has already updated window.location by the time
      // popstate fires, and Next's own router handles re-rendering the
      // segment on its own — we only need to show the overlay in sync with
      // that, not trigger navigation ourselves. No clicked element exists
      // here to read a label from.
      beginTransition('LOADING', location.pathname, location.search)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!phase) return null
  return <NavTransitionOverlay phase={phase} pct={pct} targetLabel={targetLabel} />
}
```

- [ ] **Step 2: Mount it in the root layout, inside a Suspense boundary**

```tsx
// app/layout.tsx — add the imports:
import { Suspense } from 'react'
import { NavTransitionProvider } from '@/components/transitions/NavTransitionProvider'
```

```tsx
// app/layout.tsx — inside <body>, as a sibling of the existing content div
// (position:fixed makes DOM placement irrelevant to layout, but it must be
// inside <body> and, per the Global Constraints, inside a Suspense boundary
// because NavTransitionProvider calls useSearchParams()):
        <Suspense fallback={null}>
          <NavTransitionProvider />
        </Suspense>
        <div className="flex min-h-screen flex-col">
          <SiteHeader session={navSession} whatsappUrl={WHATSAPP_COMMUNITY} adminNav={adminNav} />
          <main className="flex-1">{children}</main>
          <SiteFooter />
        </div>
```

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: all passing, no regressions

- [ ] **Step 5: Manual verification (spec §5)**

Run `npm run dev` and check every item:
- Click a header nav link → shards wipe in, crest slams in with shockwave + flash, bar fills while status text cycles LINKING NODE → DECRYPTING → LOADING ASSETS → SYNCING SQUAD → DEPLOYING, shards wipe back out revealing the destination, label text matches what was clicked.
- Click a deep link (e.g. a tournament card into its detail page) — same effect, no per-page wiring needed.
- Browser back and forward — same effect, label reads "LOADING".
- Click the nav link for the page you're already on — no animation, no flash of anything.
- Click a link that changes only the query string (e.g. a filter control, if one exists) — animation plays normally.
- Click an in-page `#anchor` link — no animation, native scroll happens.
- `Cmd`/`Ctrl`+click a link — opens in a new tab, no animation, no `preventDefault` interference.
- A `target="_blank"` link (e.g. "Share on WhatsApp") — opens normally, no animation.
- Click rapidly through several nav links in succession — clicks during an in-flight transition are ignored, exactly one transition plays at a time.
- Mobile viewport (375px) — shards/logo/bar scale sensibly, nothing overflows.
- Enable the OS-level reduced-motion setting → navigation is instant, overlay never appears.

- [ ] **Step 6: Commit**

```bash
git add components/transitions/NavTransitionProvider.tsx app/layout.tsx
git commit -m "feat(nav): mount the site-wide navigation transition" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
