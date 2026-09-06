# Leaderboard Page — Design

**Date:** 2026-09-06
**Part 2 of 2.** Part 1 is `2026-09-06-rank-history-design.md`, already shipped:
`player_rank_snapshots`, the `snapshot-ranks` cron, and `trendFor`.
**Reference:** `public/visual_bible/leaderboard_page.jpeg`

## Scope correction

This is an extension, not a rebuild. `/rankings` already has the hero, the
four-stat bar, the two-column layout, `YourGlobalStatsCard`,
`TopPerformersCard`, and the CTA band — whose copy already matches the mockup
exactly ("Compete in more games. Earn more glory."). `LeaderboardTable` already
renders rank medals, avatars, player links and a "(you)" marker.

Eleven gaps remain. Nothing existing is thrown away.

## The gaps

### 1. Trend

`LeaderboardTable` hardcodes `—` in the Trend cell, with a comment explaining no
rank history existed. It does now. The page reads the latest
`player_rank_snapshots` rows for the current scope and passes each player a
`Trend` from `trendFor(currentRank, previousRank)`.

Rendering: `up` → green `▲{delta}`, `down` → red `▼{delta}`, `flat` → grey `—`,
`new` → grey `—`. A player with no prior snapshot is not "unchanged", but both
render as a dash; the distinction matters to the helper, not the eye.

Until the cron has run on two separate days every row shows `—`. That is
correct, not a defect.

### 2. Per-game tabs

`LeaderboardTabs` currently tabs by **category** (football / shooter / fighting)
with a game sub-filter. The mockup tabs by **game**.

New behaviour: `All Games` plus one tab per game that has at least one completed
match — today DLS and EA FC Mobile. A game appears automatically once its first
match completes. Games with no matches never appear, so no tab leads to an empty
board. Beyond six tabs the remainder collapse into a `More` dropdown, matching
the mockup.

Per-game ranking is by **wins in that game**, consistent with Part 1's snapshots.
Ranking a game tab by SX Score would reproduce the global order exactly, since
SX Score is a single global figure.

The existing category tabs are removed. They were a stand-in for per-game tabs
from when only one game had data, and keeping both would give two overlapping
ways to slice the same table.

**Two existing behaviours go with them**, and both are deliberate:

- The **wins / score metric toggle** disappears. The mockup's table has a fixed
  column set and a fixed order (SX Score for All Games, wins within a game), so
  a metric switch has nothing left to switch.
- The **expandable wins-by-game row** disappears. Its content — which games a
  player won in — becomes the always-visible Games Played column, so the click
  to reveal it is redundant.

`rankPlayersBy`'s `'football' | 'fighting' | 'shooter'` metrics become unused by
this page. They stay in `lib/rankings/leaderboard.ts` (Hall of Fame's awards
still use the category aggregates) rather than being deleted alongside the UI.

### 3. Games Played column

For each player, up to four game chips (the game's icon or a short label) plus a
`+N` overflow marker and the total count, exactly as drawn. Data comes from the
existing `winsByGame` on `PlayerStatsInput` — already computed, currently only
used by the wins-tab expander.

Chips show games the player has actually played. A player with none shows `0`
and no chips.

### 4. Total Wins column

The mockup shows SX Score **and** Total Wins as separate columns. Today the
table shows one metric column that changes with the tab. New column set:

`#` · `Player` · `Games Played` · `SX Score` · `Total Wins` · `Win Rate` ·
`Titles Won` · `Trend`

The `GD` column is dropped — it is not in the mockup and goal difference is
meaningless across a shooter and a football game. It survives as a ranking
tie-break, just not as a column.

On mobile, `Games Played`, `Titles Won` and `Trend` hide (`hidden lg:table-cell`)
as the current table already does for its optional columns, leaving rank, player,
score and win rate.

### 5. Country under the player name

`profiles.country` is already selected and already on `PlayerStatsInput`; it is
simply not rendered. Add it as a muted line under the name, omitted when null.

### 6. Verified tick

The mockup shows a check beside most names. The honest source is
`profiles.kyc_verified` — the same signal the exchange uses for a verified
seller. Rendered as a small purple `BadgeCheck` after the name, omitted when
false, so it means something rather than decorating every row.

This requires adding `kyc_verified` to the page's profile select and to
`PlayerStatsInput`. **`PlayerStatsInput` has a second consumer** — the Hall of
Fame page builds it for its all-time awards — so the field is added as
`kycVerified: boolean` with Hall of Fame updated to supply it in the same change.
Making it optional instead would let a future call site silently omit it and
render every player unverified.

### 7. Pagination

Ten players per page, matching "Showing 1 to 10 of 1,482 players". URL-driven
(`?page=n`), server-rendered, consistent with `/tournaments`. Page numbers with
first/last and an ellipsis for long ranges; the count line reads
`Showing X to Y of N players`.

### 8. Pinned "you" row

When the signed-in viewer is ranked but not on the current page, their row is
appended below the last row, visually separated and highlighted purple, showing
their true rank — the mockup's rank-63 row. When they are on the page, the
existing in-place highlight is enough and no duplicate is added.

Signed-out visitors get no pinned row.

### 9. Filters panel

A third sidebar card: **Region** (from distinct `profiles.country` values) and
**Season** (from `seasons`), plus Apply and Reset. URL-driven like the tabs.

The mockup's third dropdown, "All Games", is deliberately omitted — the tab row
above already does exactly that, and two controls for one thing is a trap.

Region filters the table to players from that country. Season narrows to players
with results in that season.

### 10. Longest Win Streak

`TopPerformersCard` shows three rows; the mockup shows four. The fourth,
Longest Win Streak, has no stored column but is computable from completed
matches — `lib/achievements/unlock.ts` already walks a player's recent matches
for exactly this. A shared helper computes the longest run of consecutive wins
per player from the matches the page already loads.

The card also gains the `View All →` link to `/hall-of-fame`.

### 11. Stat label

"Categories Included" becomes **"Games Included"**, counting games with at least
one completed match rather than distinct categories — matching both the mockup
and the tab row beside it.

## Data

Everything is real. No invented figures:

| Element | Source |
|---|---|
| Players Ranked | eligible profile count |
| Games Included | games with ≥1 completed match |
| Total Matches | completed match count |
| Prizes Awarded | sum of completed tournament prize pools |
| Games Played chips | `winsByGame` |
| Trend | `player_rank_snapshots` via `trendFor` |
| Verified tick | `profiles.kyc_verified` |
| Longest Win Streak | computed from completed matches |

The page's own numbers are small today — around 58 ranked players, two games.
The layout is the mockup's; the figures are yours.

## Testing

Pure logic, unit-tested first:

- `longestWinStreak` — no matches; all wins; all losses; a run broken by a loss;
  a draw breaking a run; the longest of several runs; only the player's own
  matches counted.
- `paginate` — first/last page bounds; a page beyond the end clamps; the
  "showing X to Y of N" numbers; an empty list.
- `gameChipsFor` — at most four chips; the `+N` overflow count; ordering by
  wins descending; a player with no games.
- `tabsForGames` — only games with matches; ordering; the More split at six.

Rendering is verified by build plus loading the page at 360px and desktop,
confirming no horizontal overflow and that the pinned row appears only when the
viewer is off-page.

## Files

**New**

- `lib/rankings/streak.ts` + test
- `lib/rankings/pagination.ts` + test
- `lib/rankings/game-chips.ts` + test
- `components/rankings/LeaderboardPagination.tsx`
- `components/rankings/LeaderboardFilters.tsx`
- `components/rankings/GameChips.tsx`
- `components/rankings/TrendCell.tsx`

**Changed**

- `app/[locale]/(public)/rankings/page.tsx` — snapshots, filters, pagination,
  `kyc_verified`, the stat label
- `components/rankings/LeaderboardTabs.tsx` — per-game tabs replacing category tabs
- `components/rankings/LeaderboardTable.tsx` — new columns, country, tick, trend,
  pinned row
- `lib/rankings/leaderboard.ts` — `kyc_verified` on `PlayerStatsInput`

**Unchanged**

- `lib/rankings/trend.ts`, `lib/rankings/snapshot.ts` — Part 1, consumed as-is
- The hero, stat bar shell, `YourGlobalStatsCard`, and the CTA band
