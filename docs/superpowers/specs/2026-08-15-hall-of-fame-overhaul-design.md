# SentinelX Hall of Fame — Overhaul Design Spec

**Date:** 2026-08-15  
**Status:** Approved → ready for implementation  
**File:** `app/(public)/hall-of-fame/page.tsx` and `components/hall-of-fame/`

---

## 1. Vision

The Hall of Fame is SentinelX's **shrine to glory**. It should feel like walking into a stadium trophy room — dramatic lighting, gold everywhere, and a clear sense that the higher you scroll up, the more elite the territory.

The page has a deliberate **grandeur hierarchy**:

| Level | Tournament | Status |
|-------|-----------|--------|
| ⚡ Bottom | Community Club (weekly) | "You competed" |
| 👑 Mid | SentinelX Masters (monthly) | "You're among the best" |
| 🏆 Top | Champions Cup (annual) | "You are a legend" |
| ☀️ Crown | All-Time Awards (MVP, Golden Boot) | "All-time greatest" |

As the player scrolls from bottom to top, the prestige and visual weight increases. Every section looks better than the one below it.

---

## 2. Page Structure

```
┌─────────────────────────────────────────┐  ← Full-width cinematic hero
│           HALL OF FAME HERO             │
└─────────────────────────────────────────┘
         ↓ scroll direction →
┌─────────────────────────────────────────┐  ← All-time awards
│           ALL-TIME AWARDS               │     (most elite, shown first)
└─────────────────────────────────────────┘
┌─────────────────────────────────────────┐  ← Champions Cup shrine
│         CHAMPIONS CUP LEGENDS           │
└─────────────────────────────────────────┘
┌─────────────────────────────────────────┐  ← Masters Hall
│         MASTERS CHAMPIONS               │
└─────────────────────────────────────────┘
┌─────────────────────────────────────────┐  ← Community Club
│         COMMUNITY CLUB CHAMPIONS        │
└─────────────────────────────────────────┘
┌─────────────────────────────────────────┐  ← Bronze (smallest)
│         BRONZE FINISHES                 │
└─────────────────────────────────────────┘
```

---

## 3. Section 1 — Cinematic Hero

Full-width, no max-width constraint. Height: 280px mobile, 360px desktop.

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   [Trophy icon or mascot — large, right-aligned or center] │
│                                                             │
│   HALL OF FAME                                              │
│   Where Legends Are Made                                    │
│                                                             │
│   Nigeria's greatest mobile esports achievers               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Background:** Multi-layer dark gradient:
```css
background: 
  radial-gradient(ellipse at 20% 50%, rgba(124,58,237,0.35) 0%, transparent 60%),
  radial-gradient(ellipse at 80% 50%, rgba(245,158,11,0.2) 0%, transparent 60%),
  #0B0B0F;
```
Purple glow from left, gold glow from right.

**Typography:**
- "HALL OF FAME" — Barlow Condensed Black, 56px mobile / 80px desktop, uppercase, white
- "Where Legends Are Made" — Barlow Condensed, 20px, `text-sx-gray`, italic
- Subtitle — Inter, 14px, `text-sx-gray`

**Decorative element:** A large (200px) trophy SVG or `/public/mascot/mascot-home.png` positioned at the right edge on desktop, centered behind text on mobile. Apply a subtle `animate-float` (slow up-down float, 4s ease-in-out infinite).

**Particle effect (optional enhancement):** 8–12 small gold particles (`#F59E0B`, 3–6px dots) animated to drift upward slowly across the hero background — CSS-only animation, no JS library. Degrade gracefully (no particles = still looks great).

---

## 4. Section 2 — All-Time Awards

Dark gold-tinted surface. Max-width 3xl. Padding: `py-16`.

```
┌──────────────────────────────────────────────────────┐
│  ☀️  ALL-TIME AWARDS                                  │
│  The greatest individuals in SentinelX history.       │
│  ───────────────────────────────────────────────────  │
│                                                        │
│  [MVP Card — large]      [Golden Boot Card — large]   │
└──────────────────────────────────────────────────────┘
```

**Section header:**
- Icon: ☀️ or custom gold star SVG
- Title: "ALL-TIME AWARDS" — Barlow Condensed, 24px, gold (`#F59E0B`)
- Subtitle: `text-sx-gray`, 14px

**Award Card — large format:**

```
┌──────────────────────────────┐
│   ⭐  MVP                    │  ← Award label in gold
│                              │
│   [HexAvatar xl]             │  ← 112px hex avatar with tier frame
│                              │
│   methio                     │  ← Display name, white, Barlow Condensed 22px
│   🟢 Elite                   │  ← Tier badge
│                              │
│   1,610 SX Score             │  ← Key metric
│                              │
│   All-Time MVP               │  ← Award name, gold, small caps
└──────────────────────────────┘
```

Card styling: `bg-gradient-to-b from-[#1A1500] to-sx-surface border border-amber-500/40 rounded-2xl p-6` with `box-shadow: 0 0 32px rgba(245,158,11,0.2)`.

2 cards on desktop (MVP left, Golden Boot right). Stacked on mobile.

If no MVP/Golden Boot data yet: show a single empty-state card per award: `"[Award] awaits its first champion"` in muted gold text with a dimmed trophy icon.

---

## 5. Section 3 — Champions Cup Legends

Dedicated shrine section. Max-width 3xl. Background: subtle purple-to-black gradient to distinguish from other sections.

```
┌──────────────────────────────────────────────────────────┐
│  🏆  CHAMPIONS CUP LEGENDS                                │
│  The greatest prize in Nigerian mobile esports.           │
│  ₦50,000 Grand Prize · Annual · Invitation Only          │
│  ─────────────────────────────────────────────────────── │
│                                                            │
│  [No champion yet — "The throne awaits" state]            │
│  OR                                                        │
│  [Champion card — full-width, maximum grandeur]           │
└──────────────────────────────────────────────────────────┘
```

**Section background:**
```css
background: linear-gradient(180deg, rgba(124,58,237,0.08) 0%, transparent 100%);
border-top: 1px solid rgba(124,58,237,0.3);
border-bottom: 1px solid rgba(124,58,237,0.3);
```

**Champions Cup Champion Card (full-width):**

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│      [HexAvatar xl — legend-tier glow]                       │
│                                                              │
│      SEASON 1 CHAMPION                    [Season 1 badge]  │
│      PLAYER NAME                                             │
│      [Tier badge]                                            │
│                                                              │
│      🏆 SentinelX Champions Cup                              │
│      July 2027 · ₦50,000 Prize                              │
│                                                              │
│      [View Tournament →]                                    │
└──────────────────────────────────────────────────────────────┘
```

Card styling: `bg-gradient-to-r from-sx-purple/20 via-sx-surface to-amber-900/20 border border-sx-purple/60 rounded-2xl p-8`. Gold-purple gradient background. The champion avatar gets the Legend-tier glow regardless of their actual tier (it's the Champions Cup — everyone who wins here is a legend in this moment).

"The throne awaits" empty state: a dimmed trophy outline SVG, `"The Champions Cup throne awaits its first legend"`, and `"Season 1 Champion crowned in July 2027"` in muted text. Still looks beautiful — anticipation is part of the grandeur.

---

## 6. Section 4 — Masters Champions

One card per Masters tournament. Max-width 3xl. Grid: 1 column mobile, 2 columns desktop (≥768px).

```
SECTION HEADER:
  👑  MASTERS CHAMPIONS
  Monthly elite champions — the top 16 per month, competing for ₦10,000.
```

Section background: subtle gold tint. `border-t border-amber-500/20`.

**Masters Champion Card:**

```
┌──────────────────────────────┐
│  👑  MASTERS CHAMPION        │  ← Gold label
│  August 2026 Masters         │  ← Tournament name, small, slate-400
│  ─────────────────────────── │
│  [HexAvatar lg — 80px]       │
│  Player Name                  │
│  [Tier badge]                 │
│  ─────────────────────────── │
│  🏆 1st Place  ·  ₦10,000    │
│  [View Tournament →]         │
└──────────────────────────────┘
```

Card styling: `bg-gradient-to-b from-[#1A1200] to-sx-surface border border-amber-500/30 rounded-xl p-5`. Slightly smaller gold glow than the Champions Cup card. `box-shadow: 0 0 20px rgba(245,158,11,0.12)`.

Runner-up (2nd place) shown as a smaller row below the champion card, with no avatar — just "🥈 Runner-up: [name] — ₦5,000".

If no Masters tournaments completed yet: `"August 2026 Masters · Champion to be crowned"` placeholder card with dimmed styling.

**Data source:** `tournaments` WHERE `tournament_type = 'masters'` AND `status = 'completed'`, ordered by `tournament_end DESC` (most recent first).

---

## 7. Section 5 — Community Club Champions

All-time weekly champions. More compact cards. Max-width 3xl. Grid: 1 col mobile, 3 cols desktop (≥1024px), 2 cols tablet (≥640px).

```
SECTION HEADER:
  ⚡  COMMUNITY CLUB CHAMPIONS
  Weekly community tournaments — where every legend starts.
```

Section background: default `bg-sx-bg`. No special tint — this section is deliberately less grand than Masters above.

**Community Club Champion Card (compact):**

```
┌──────────────────────────┐
│  [HexAvatar md — 56px]   │
│  Player Name              │
│  [Tier badge — xs]        │
│  ─────────────────────── │
│  ⚡  Community Club #3    │
│  Sat 16 Aug 2026         │
│  [View →]                │
└──────────────────────────┘
```

Card styling: `bg-sx-surface border border-sx-border rounded-xl p-4`. No glow — clean, simple. The lack of glow is the design — it signals that this is the starting line, not the finish.

Runner-up shown as a small text line: `"🥈 [name]"`.

**Data source:** `tournaments` WHERE `tournament_type = 'community_club'` AND `status = 'completed'`, ordered by `tournament_end DESC`. Paginate: show 9 most recent, with a "Load more" or simple pagination.

---

## 8. Section 6 — Bronze Finishes

At the very bottom. Compact. Same card style as Community Club but with 🥉 icon. No special treatment — bronze is bronze.

Grid: 1 col mobile, 2 cols desktop.

**Data source:** Same as before — completed third-place matches across all tournament types. Order by date DESC.

If no bronze finishes: simple empty state, small, no drama.

---

## 9. Data Requirements

All data fetched server-side in `page.tsx`. Extend the existing data queries:

| New data needed | Query |
|----------------|-------|
| Masters tournaments + their champions | `tournaments` WHERE `tournament_type = 'masters'` AND `status = 'completed'` + final match join |
| Community Club tournaments + champions | `tournaments` WHERE `tournament_type = 'community_club'` AND `status = 'completed'` + final match join |
| Champions Cup tournament (if any) | `tournaments` WHERE `tournament_type = 'champions_cup'` AND `status = 'completed'` |
| Player `membership_tier` for all winners | join from `profiles` for each champion player_id |
| Player `achievement` slugs for HexAvatar decorations | `player_achievements` for each champion player_id — only needed for top-slot winners (MVP, Golden Boot, Champions Cup) |

The existing queries (MVP, Golden Boot, all-time champions from `open` tournaments) are preserved and extended, not replaced.

---

## 10. Component Structure

```
components/hall-of-fame/
  HeroSection.tsx              ← Section 1 — cinematic hero
  AllTimeAwardCard.tsx         ← Section 2 — MVP / Golden Boot large card
  ChampionsCupCard.tsx         ← Section 3 — full-width shrine card
  MastersChampionCard.tsx      ← Section 4 — gold-tinted card + runner-up row
  CommunityClubCard.tsx        ← Section 5 — compact card
  BronzeCard.tsx               ← Section 6 — minimal card
  SectionHeader.tsx            ← Shared section title + subtitle component
```

All Server Components. No client interactivity needed on this page. The `animate-float` on the mascot/trophy in the hero is CSS-only (no JS).

---

## 11. Empty State Philosophy

Every section must look intentional even when empty. No blank white boxes. Each empty state:
- Has a dimmed, ghosted version of the section's icon
- Has aspirational copy ("The throne awaits its first legend")
- Optionally links to current tournaments
- Still maintains the section's visual weight

The page should never look broken regardless of how much or how little data exists.

---

## 12. Season filter (future — not Phase 2)

Currently the page shows all-time data across all seasons. In a future phase, a Season filter tab at the top will let users browse Hall of Fame by season (Season 1, Season 2, etc.). **Do not build this now** — just ensure the data queries are parameterised by `season_id` where applicable so it's easy to add later.

---

## 13. Out of Scope

- Video highlights of winning matches on champion cards (Phase 3+)
- Voting / fan awards (Phase 3+)
- Season filter tab (future)
- Multi-game per-category Hall of Fame sections (Phase 4+)
