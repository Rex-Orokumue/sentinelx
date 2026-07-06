# Tournament Listing (`/tournaments`) — Design

**Roadmap task:** v1.0 #2 · **Route:** `/tournaments`
**Date:** 2026-07-06

## Purpose

Public page listing all tournaments, grouped by lifecycle status, so players can
find something to enter and browse past results. Built multi-game-aware from day
one though only DLS is live in v1.0.

## Rendering

Async **Server Component** at `app/(public)/tournaments/page.tsx`. All list state
lives in the URL (`?game=<slug>`, `?past=all`) so no client JS is needed for the
list — filter chips and the "view all" link are plain `<Link>`s.

## Data

Three queries (parallel via `Promise.all`), each honoring an optional `?game` slug:

1. **Active buckets** — statuses `active`, `registration_open`, `registration_closed`.
   Ordered `created_at desc`. Bucketed in JS.
2. **Past** — status `completed`, ordered `tournament_end desc nulls last`,
   `.limit(10)`. `draft` is never queried (not public).
3. **Games** — `active = true`, used only to decide whether to render the filter.

When `?game=<slug>` is set, the tournament queries use `games!inner(...)` +
`.eq('games.slug', slug)`. Otherwise a plain left join `games(name, icon_url, slug)`.

## Sections (rendered only when non-empty)

| Section              | Status                 | Heading               |
|----------------------|------------------------|-----------------------|
| Live Now             | `active`               | 🔴 Live Now           |
| Registration Open    | `registration_open`    | 🟢 Registration Open  |
| Upcoming             | `registration_closed`  | ⏳ Upcoming            |
| Past Tournaments     | `completed`            | 🏁 Past Tournaments   |

Each section is a responsive grid (`sm:grid-cols-2 lg:grid-cols-3`) of the existing
`TournamentCard`. First Live card renders with `featured`.

### Past section cap

Completed query is capped at 10. If exactly 10 come back (more may exist), render a
**"View all past tournaments →"** link to `/tournaments?past=all` (preserving any
`game` param).

### `?past=all` mode

Same route renders a past-only view: all completed tournaments (no limit), a
"← Back to all tournaments" link, other three sections hidden.

## Game filter (auto-show)

Chip row rendered **only when 2+ active games exist**. `All` → `/tournaments`
(preserving `past`), each game → `/tournaments?game=<slug>`. Active chip highlighted
by comparing to `searchParams.game`. Invisible today (DLS only); activates
automatically when a second game launches.

## Empty state

The home page's inline `EmptyState` is extracted to
`components/shared/EmptyState.tsx` and reused here and on the home page. Shown when
no tournaments match the current filter.

## SEO / sharing (per CLAUDE.md)

- `generateMetadata()` — title, description, Open Graph tags (WhatsApp previews).
- "Share on WhatsApp" button (`wa.me/?text=`) at page bottom, matching home page.

## Files

- **New:** `app/(public)/tournaments/page.tsx`
- **New:** `components/shared/EmptyState.tsx` (extracted from home)
- **Touched:** `app/page.tsx` — import shared `EmptyState`

## Out of scope

Pagination beyond the 10-cap, search, sort controls, per-game landing pages.
