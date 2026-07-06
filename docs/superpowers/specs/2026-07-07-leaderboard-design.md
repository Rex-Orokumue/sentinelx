# Leaderboard (`/rankings`) — Design

**Roadmap task:** v1.0 #6 · **Route:** `/rankings`
**Date:** 2026-07-07

## Purpose

A public overall leaderboard ranking players by performance. Built to extend:
season and game-specific leaderboards are deferred (no season entity, no per-game
player stats in the schema), but the ranking logic stays filter-agnostic so a future
pre-filtered list is all a game/season tab needs.

## Constraints already in place (verified)

- `profiles` holds **global** aggregate stats: `wins, losses, total_matches,
  goals_scored, goals_conceded, total_titles, sentinel_score, sentinel_tier
  (string | null), avatar_url, country, username, display_name`. `public_read` RLS.
- No `season` table and no per-game player stats exist → only an **overall**
  leaderboard is supportable now.
- `sentinel_tier` is a **trust/conduct** signal (score starts at 70), not a skill
  metric — informational only, never the sort key.

## Ranking (approved)

Primary: **wins desc → win rate desc → total_titles desc → goal difference desc**.
Players with `total_matches = 0` are excluded (also guards divide-by-zero in win rate).

## Architecture

Server Component page (mirrors #4 standings): fetch qualifying players → one pure
ranking function → presentational table. No tab chrome now; extensibility comes from
the clean `rankPlayers` + isolated fetch, not from empty UI.

## Data fetch (page Server Component)

- `profiles` where `total_matches > 0`, select `id, username, display_name,
  avatar_url, country, wins, losses, total_matches, goals_scored, goals_conceded,
  total_titles, sentinel_score, sentinel_tier`.
- `.order('wins', { ascending: false }).limit(200)` — rough DB order to bound the set;
  final multi-key ordering happens in-code (DB can't sort by derived win%/GD).
- Also `auth.getUser()` to get the current user's id for self-row highlight.

## Pure logic — `lib/rankings/leaderboard.ts` (TDD)

```ts
export interface PlayerStatsInput {
  id: string
  username: string | null
  displayName: string | null
  avatarUrl: string | null
  country: string | null
  wins: number
  losses: number
  totalMatches: number
  goalsScored: number
  goalsConceded: number
  totalTitles: number
  sentinelScore: number
  sentinelTier: string | null
}

export interface RankedPlayer extends PlayerStatsInput {
  winRate: number   // fraction 0..1 (wins / totalMatches)
  goalDiff: number  // goalsScored - goalsConceded
  rank: number      // 1-based, after sort
}

// Sort: wins desc → winRate desc → totalTitles desc → goalDiff desc.
export function rankPlayers(players: PlayerStatsInput[]): RankedPlayer[]
```

Tested: ordering by each key; each tiebreaker breaks the tie above it; winRate/goalDiff
derivation; rank assignment (1-based, sequential).

## Components

### `app/(public)/rankings/page.tsx`
- Fetch → `rankPlayers` → render `LeaderboardTable` with `currentUserId`.
- `generateMetadata()` + OG tags.
- Empty state (no qualifying players) reuses shared `EmptyState`:
  "Rankings coming soon — be the first to compete."

### `components/rankings/LeaderboardTable.tsx` (presentational)
- Props: `{ players: RankedPlayer[]; currentUserId: string | null }`.
- Columns, mobile-first at 375px: **# · Player (avatar initial + name + `TierBadge`) ·
  W · Win%**. **Titles · GD · Score** appear from `sm` up via `hidden sm:table-cell`
  (no `xs:` breakpoint exists).
- Top 3 ranks render 🥇🥈🥉; others show `#{rank}`.
- **Self-row highlight:** a row whose `id === currentUserId` gets a highlight class.
  Comment noting: a logged-in user with 0 matches is excluded by the query, so there
  is simply no row to highlight — expected, not a bug.
- Win% shown as a whole percent (`Math.round(winRate * 100)`); GD prefixed `+` when > 0.

### `components/player/TierBadge.tsx` (new, shared — DRY)
- `TierBadge({ tier }: { tier: string | null })`.
- Map of `elite | trusted | developing | at_risk` → label + colour.
- **Returns `null` (renders nothing) when `tier` is null or unrecognized** — matches
  the home page's existing `{tier && …}` guard. (Minor behaviour change: an
  unrecognized tier now renders nothing instead of the raw DB string; tiers are a
  fixed set, so this shouldn't occur.)
- Refactor `app/page.tsx` to use `TierBadge`, removing its inline `TIER_STYLE` /
  `TIER_LABEL` maps. Pure refactor, no behaviour change for known tiers.

## Error / edge handling

- No qualifying players → empty state.
- `total_matches = 0` excluded at query (guards winRate divide-by-zero).
- Null `sentinel_tier` → `TierBadge` renders nothing.
- Null `display_name`/`username` → fall back to `'Anonymous'` (consistent with home).

## Testing

Vitest units (pure): `rankPlayers` — primary sort, each tiebreaker in isolation,
winRate + goalDiff derivation, rank numbering. Components + page verified by
`tsc` + `lint` + `build`.

## Files

**New:**
- `app/(public)/rankings/page.tsx`
- `components/rankings/LeaderboardTable.tsx`
- `components/player/TierBadge.tsx`
- `lib/rankings/leaderboard.ts`
- Test: `lib/rankings/leaderboard.test.ts`

**Touched:** `app/page.tsx` (use shared `TierBadge`, drop inline tier maps).

## Out of scope (deferred, noted)

Season leaderboards (no season entity), game-specific leaderboards (no per-game player
stats), pagination beyond top 200. `rankPlayers` is filter-agnostic, so a future game
tab only needs to pass a pre-filtered player list.
