# Site-wide Navigation Transition Animation — Design

**Date:** 2026-08-16
**Status:** Approved → ready for implementation planning
**Source:** `Game website navigation animation.zip` (user-supplied design-tool export, `Page Transition.dc.html` + `support.js` + `logo.png` + `uploads/logo-icon.png`) — a self-contained interactive prototype of a page-transition overlay, built with the user's own Sentinel X crest already in place (`uploads/logo-icon.png` in the zip is byte-identical to `public/logo-icon.png` in this repo).

---

## 1. What the source file actually contains

The zip is **not** a generic template — it's a working demo of exactly one thing: a full-screen animated overlay that plays between navigating away from a page and the new page appearing. Its own header/nav markup, its four canned "pages" (`PAGES.home/roster/matches/store`), and its "REPLAY" button are throwaway scaffolding the design tool needed to demo the transition — none of that gets ported. **Only the overlay and its timing state machine get replicated.**

### 1.1 The visual sequence, transcribed exactly

Three layers, all inside a `position:fixed; inset:0; z-index:60` overlay that mounts only while a transition is in progress:

**A — Shards** (N=6, vertical, skewed panels that wipe across the full viewport)

Each shard `i` of `N`:
```
position: absolute; top: -8%; height: 116%;
left:  calc((i/N)*100% - 3%);
width: calc((100/N)% + 6%);
background: i odd  → linear-gradient(175deg, #12081f 0%, #0a0610 100%)
            i even → linear-gradient(175deg, {accent}22 0%, #0a0610 62%)
border-left: 1px solid {accent}55
```
- **Covering** (entering): `shardIn` — `skewX(-11deg) translateY(-115%)` → `skewX(-11deg) translateY(0)`, `520ms cubic-bezier(.76,0,.24,1)`, staggered `delay = i * 55ms` (left shard first, wave left→right).
- **Revealing** (leaving): `shardOut` — `translateY(0)` → `translateY(115%)`, same duration/easing, staggered `delay = (N-1-i) * 55ms` (**reversed** — rightmost shard leaves first, wave right→left).

**B — Core** (centered logo + label + progress bar, only visible once shards have covered the screen)

- **Shockwave rings** (two, only on the entering side): `260px` circles, border `2px solid {accent}` and `1px solid {accent}77`. `shock` keyframe (`scale(.15) opacity:0` → `12% opacity:.9` → `scale(3.4) opacity:0`), durations `900ms`/`1100ms`, delays `560ms`/`680ms`.
- **Logo** (the real Sentinel X crest): entering plays `logoSlam` — `0% scale(3.2) rotate(-9deg) opacity:0 blur(14px)` → `55% opacity:1` → `70% scale(.9) rotate(0) blur(0)` → `84% scale(1.06)` → `100% scale(1)`, `760ms cubic-bezier(.2,1.4,.4,1)` (overshoot easing), delay `170ms`. Leaving switches entirely to `logoOut` — `scale(1)→scale(2.6)`, `opacity:1→0`, `420ms ease-in`. Permanent `filter: drop-shadow(0 0 40px {accent}cc)`.
- **Label** (destination name): `jitter` (small ±1-2px shake, `steps(2)`, ×3, delay `620ms`) layered with `riseIn` (`opacity:0 translateY(26px)`→`opacity:1 translateY(0)`, `300ms`, delay `560ms`). Leaving switches to `logoOut` (420ms).
- **Progress bar** (`260px × 3px`): fill via `barFill` (`scaleX(0)→scaleX(1)`, `1150ms cubic-bezier(.5,0,.2,1)`, delay `250ms` — **completes at exactly 1400ms**, the same instant the state machine below flips to reveal) plus an infinite diagonal `sweep` shimmer (`translateX(-120%)→translateX(320%)`, `900ms linear`, delay `250ms`, loops). The whole bar+sweep wrapper switches to `logoOut` on leaving.
- **Percent + status text**: `{pct}%` plus a cycling status word, color `#d8b4fe`. Switches to `logoOut` on leaving.
- **Flash**: full-screen white, `mix-blend-mode: overlay`, `flashOut` (`opacity:.85→0`, `420ms ease-out`, delay `560ms`) — a camera-flash punch synced to the logo's impact. Entering only.

**C — Header logo idle state**: outside the transition entirely, the header logo has a permanent `idlePulse` — glow `drop-shadow` breathing between 14px/0.45-alpha and 34px/0.9-alpha every `3.4s`.

### 1.2 The timing state machine, transcribed exactly

```
go(destination):
  if already transitioning: ignore the click        # no queueing, no interrupt-and-restart
  state = { phase: 'cover', pct: 0 }
  tick pct 0→100 over 1150ms (40ms interval)          # drives the %/status readout only — cosmetic
  at t=1400ms:  state = { phase: 'reveal' }            # shards reverse, page swaps underneath
  at t=2050ms:  state = { phase: null }                # overlay unmounts
```

`statusText = STATUS[min(4, floor(pct/21))]`, `STATUS = ['LINKING NODE','DECRYPTING','LOADING ASSETS','SYNCING SQUAD','DEPLOYING']`.

This timing is **fixed and fake** in the source file because its four pages are hardcoded strings with no real load time. §3 covers how this maps onto real navigation.

---

## 2. Decisions made during brainstorming

| Question | Decision |
|---|---|
| Which navigations trigger it | **Every internal link, site-wide** — no carve-outs for admin or any section. |
| Accent color | Sentinel X brand purple **`#7C3AED`**, not the mockup's `#a855f7`. |
| Overlay typeface | **Chakra Petch**, loaded via `next/font/google`, scoped to the overlay only — rest of the site keeps Barlow Condensed untouched. |
| Reveal timing | **Minimum 1400ms, extended if the destination isn't ready yet** — never a fixed timer regardless of real state, never revealed before it's actually rendered. |
| Browser back/forward | **Included** — `popstate` triggers the same transition as a click. |
| Reduced motion | Automatic — `prefers-reduced-motion: reduce` (an OS-level, not site-level, setting) skips straight to the destination with no overlay. No in-site toggle. |
| Same-URL clicks | Compared as **full URL** (pathname + search + hash), not just pathname — see §4.1. |
| Logo asset | The zip's `logo.png` (transparent, pre-cropped) gets added to `public/` — the existing `public/logo-icon.png`/`logo-full.png` both carry a watermark/neon backdrop baked into the PNG, unusable for the slam animation. |

---

## 3. Architecture

### 3.1 Approach — a single global interceptor, zero call-site changes

One client component, `NavTransitionProvider`, mounted once in `app/layout.tsx` wrapping `{children}`. It does all the work:

1. Attaches one `click` listener on `document`, **in the capture phase** (`addEventListener('click', handler, true)`) — this fires before `next/link`'s own click handler on the same element, so `preventDefault()` reliably stops Next.js's default navigation too.
2. Walks up from `event.target` to the nearest `<a>` (`.closest('a')`). If none, or it fails any exclusion in §4.1, does nothing — the click proceeds natively.
3. Otherwise: `preventDefault()`, capture the clicked link's own visible text (see §3.3) as the overlay's label, and run the state machine from §1.2, with `router.push` (from `next/navigation`) wrapped in `startTransition` at the `phase:'cover'→'reveal'` boundary — `useTransition`'s `isPending` is the App-Router-native "has the destination actually finished rendering" signal, which is what §3.2 needs.
4. A `popstate` listener on `window` drives the same state machine for back/forward.

No other file in the codebase changes. Every existing `<Link>` and hand-written `<a href>`, anywhere in the app, is caught by the same listener.

**Two alternatives considered and rejected:**
- *Replace every `import Link from 'next/link'` with a custom wrapper.* Touches dozens of files today, and every future page has to remember to use the wrapper instead of the standard import — an ongoing maintenance tax with no upside over the capture-phase listener.
- *Native View Transitions API (`document.startViewTransition`).* Built for a single crossfade/morph between two DOM snapshots, not a multi-stage sequence with independently-timed shards, shockwave, logo slam, and progress bar. The source file doesn't use it either — it's hand-built CSS keyframes for exactly this reason.

### 3.2 Reveal timing, precisely

```
t=0        click intercepted → phase='cover', pct-tick starts, router.push(href) inside startTransition
t=1400ms   IF isPending is false (destination already rendered): phase='reveal', pathname state updates
           IF isPending is still true (rare — a genuinely slow query): hold here.
             - bar is already 100% full (barFill finishes at exactly 1400ms)
             - sweep shimmer keeps looping (already `infinite`)
             - status text stays on "DEPLOYING" (last word)
             - logo/shockwave/flash have already settled (logoSlam finishes at 930ms)
             → this reads naturally as "still working," no extra animation needed for the hold state.
           The instant isPending flips false: phase='reveal' fires immediately.
reveal+650ms   phase=null, overlay unmounts (matches the source's 2050ms-from-t0 total when not extended)
```

This is the one deliberate timing deviation from the literal source: the source always reveals at exactly 1400ms because its "pages" are static strings. Real Sentinel X pages hit the database; revealing on a schedule regardless of readiness risks showing half-rendered content, which the source's own hardcoded-page design never had to contend with.

### 3.3 Destination label

The source hardcodes `targetLabel` from a 4-item `ORDER` list (already all-caps strings) — not usable once every link site-wide is in scope. Instead: capture the clicked `<a>`'s own trimmed `textContent` (falling back to its `aria-label` if the text is empty — an icon-only link — and finally to `"LOADING"` if neither exists) as `targetLabel`. Zero per-link configuration needed anywhere in the app; whatever text the user clicked is what displays. Real nav labels aren't always upper case (e.g. "Tournaments", not "TOURNAMENTS") — the label element applies `text-transform: uppercase` in CSS regardless of the captured text's original casing, so the sci-fi all-caps look is preserved without requiring it of the source text.

### 3.4 Files

| File | Responsibility |
|---|---|
| `components/transitions/NavTransitionProvider.tsx` | Click/popstate interception, exclusion filtering, the timing state machine, `router.push`/`startTransition`/`isPending`. Renders `NavTransitionOverlay` when `phase` is non-null. |
| `components/transitions/NavTransitionOverlay.tsx` | Pure presentation — shards, shockwave, logo, label, bar, sweep, percent/status, flash. Props: `phase`, `pct`, `targetLabel`. No knowledge of routing. |
| `components/transitions/NavTransitionOverlay.module.css` | The ten keyframes from §1.1 (`shardIn`, `shardOut`, `logoSlam`, `logoOut`, `shock`, `flashOut`, `barFill`, `sweep`, `jitter`, `riseIn`), scoped as a CSS Module rather than added to `tailwind.config.ts` — these are single-purpose to this one component, unlike the site's existing reusable `sentinel-pulse`/`legend-glow`/`float`/`pulse-dot` keyframes already in the Tailwind config. Per-shard/per-element dynamic values (stagger delay, `{accent}`-derived colors) are applied via inline `style`, same split the source file itself uses. |
| `app/layout.tsx` | One new line: mount `<NavTransitionProvider>` wrapping `{children}`. |
| `public/logo.png` | New asset — the zip's pre-cropped transparent crest. |

### 3.5 Header idle pulse

`idlePulse` (§1.1.C) is a one-line addition to the existing header logo `<Image>` in `SiteHeader.tsx` — not part of the transition system itself, ported for completeness since it's the same logo element the transition slams in on.

### 3.6 Scoped out of v1

- The page content underneath does **not** get its own `riseIn` entrance animation on top of the shard reveal (the source's `pageKeyStyle`). Wrapping every route's `{children}` in a keyed, animated container is a second architectural surface (interacts with every page's own client state, loading boundaries, etc.) beyond what was asked for — "the loading animation" is unambiguously the overlay itself. Can be revisited as a separate, later enhancement if wanted.
- The `speed`/`shards`/`accent` live-editable "props" and the "REPLAY" button were the design tool's own preview controls — not part of the real site.

---

## 4. Edge cases

### 4.1 Clicks the interceptor ignores (native behavior proceeds untouched)

- Different origin (`new URL(href, location.href).origin !== location.origin`).
- `target="_blank"`, `rel="external"`, or a `download` attribute.
- `mailto:`, `tel:`, `sms:` hrefs.
- Modifier key held (`ctrlKey`/`metaKey`/`shiftKey`/`altKey`) or a non-primary mouse button — the user is explicitly asking for new-tab/native behavior.
- **Full resolved URL (pathname + search + hash) identical to the current one** — e.g. clicking the nav item for the page you're already on. Note this is *not* the same as "same pathname": a link that changes only the query string (`/tournaments` → `/tournaments?status=open`) is a **different** URL and plays the full transition normally, correctly covering a same-page data refetch.
- **Hash-only difference** (pathname + search unchanged, only the `#fragment` differs) — an in-page anchor scroll, not a navigation. Left to native smooth-scroll/jump behavior.
- `aria-disabled="true"`.
- `prefers-reduced-motion: reduce` — navigation still happens (`router.push` fires), but `phase` is never set and the overlay never mounts; it's an instant route change.

### 4.2 A click arrives while a transition is already in progress

Ignored outright — matches the source exactly (`if (phase) return`). No queueing, no interrupting the in-flight transition to start a new one.

---

## 5. Testing

- **Pure logic, unit-tested:** the exclusion filter (§4.1) as a standalone function — given a synthetic `{href, target, download, modifierKey, currentURL}`-shaped input, returns whether to intercept. This is the one piece with enough branching to warrant dedicated tests; the rest of the state machine is timer/DOM-driven and covered by manual verification below.
- **Manual verification, matching this repo's existing convention for presentational components** (no test file exists for `components/shared/SiteHeader.tsx`, `MobileNavSheet.tsx`, or their siblings either): click through header nav, a deep link (e.g. a tournament card into its detail page), browser back/forward, a link on mobile viewport, a link with `Cmd`/`Ctrl` held (must open a new tab, no overlay), an anchor-only in-page link (must not trigger the overlay), and with the OS-level reduced-motion setting on (must skip straight to the destination).

---

## 6. Out of scope

- An in-site "reduce motion" toggle independent of the OS setting (explicitly declined).
- Page-content entrance animation on reveal (§3.6).
- Any change to the mockup's own header/nav markup, its four canned pages, or the "REPLAY" button — none of that is real Sentinel X code.
