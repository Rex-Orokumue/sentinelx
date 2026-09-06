# Multi-Game Champions — Design

**Date:** 2026-09-06
**Trigger:** The SentinelX FC Mobile Premier League finished with a decided final
(DER_KAISER beat AAGREATTEAM 4–2) and its winner appears nowhere on the platform.

## The problem

Hall of Fame resolves champions inline, behind three hard filters:

```ts
.eq('tournament_type', 'champions_cup')   // Champions Cup Legends
.eq('tournament_type', 'masters')          // Masters Champions
.eq('tournament_type', 'community_club')   // Community Club Champions
```

`tournaments.tournament_type` allows a fourth value, `open`, **and `open` is the
column default**. Any tournament created without explicitly choosing one of the
three DLS-structure types is therefore invisible to Hall of Fame by construction.
That is what happened to the FC Mobile Premier League, and equally to the
"DLS 26 Pre-Season 2 championship" — so this is a taxonomy bug, not a
game-specific one, even though activating a new game is what exposes it.

Two related gaps:

- Hall of Fame has **no per-game filter or grouping at all** (no `searchParams`),
  unlike `/tournaments` and `/rankings`.
- Champion resolution lives inside the Hall of Fame page component, so no other
  surface can reuse it.

## Goal

A tournament's winner is surfaced automatically whenever it completes, for every
game and every tournament type, on four surfaces — with no per-game work needed
when a new game is activated.

## Core: one champion resolver

New module `lib/tournaments/champions.ts`. Every surface reads from it; none
re-derives champions.

```ts
export interface ChampionEntry {
  tournamentId: string
  slug: string
  title: string
  tournamentType: 'champions_cup' | 'masters' | 'community_club' | 'open'
  gameId: string
  gameName: string
  date: string | null          // tournament_end
  prizePool: number | null
  champion: { id: string; name: string }
  runnerUp: { id: string; name: string } | null
}
```

### Resolution rule

```
resolveChampion(tournament, { finalMatch, standings, matches }):
  1. A `final` match with status 'completed' exists
       → higher score wins; runner-up is the loser
       → scores equal  → undecided (null)
  2. No final (round_robin, or a knockout whose final isn't played)
       → rank 1 of the tournament's full standings; runner-up is rank 2
       → if rank 1 and rank 2 are level on points-per-game, goal difference
         AND goals-for, fall to head-to-head between those two
       → still level, or they never met → undecided (null)
```

An undecided tournament yields no `ChampionEntry`. It is omitted from every
surface rather than crowning someone the code cannot actually justify.

**Why undecided rather than "first in the array":** `sortStandings` is a stable
sort, so two genuinely level players come back in input order — which is
arbitrary. Picking rank 1 in that case would silently crown the wrong player with
no visible symptom. Undecided keeps the platform honest and matches the standing
project rule that automation flags but never decides a competitive outcome.

### Head-to-head tiebreak

`headToHeadWinner(a, b, matches)` considers only matches in this tournament
between those two players:

1. Head-to-head points (win 3, draw 1) — higher wins.
2. Level on points → head-to-head goal difference across those matches.
3. Still level, or no match between them → `null` (undecided).

This is a champion-resolution concern only. `sortStandings` is **not** changed —
it is shared with the group-stage tables and the advancing-two logic, and
altering its ordering would ripple into bracket generation.

### Round-robin standings

A `round_robin` tournament creates exactly **one** group, named "League Table"
(`lib/tournaments/bracket-admin-actions.ts`), and its running W/D/L/GF/GA/points
live in `group_memberships` for that group. Champion resolution reads that group
and maps it through `sortStandings`, mirroring the existing round-robin path in
`lib/matches/season-points.ts` rather than recomputing from raw match rows — the
memberships are already maintained as results are verified, so this stays
consistent with the league table players actually see.

`group_knockout` tournaments always produce a final, so they take branch 1 and
never reach this path.

### Module surface

```ts
resolveChampion(input): { champion, runnerUp } | null
headToHeadWinner(aId, bId, matches): string | null
fetchChampions(supabase, opts?: { gameId?: string }): Promise<ChampionEntry[]>
latestChampion(entries): ChampionEntry | null
reigningChampionByGame(entries): Map<string, ChampionEntry>
groupByType(entries): Record<TournamentType, ChampionEntry[]>
```

`fetchChampions` reads completed tournaments plus their final match and, only for
tournaments lacking a final, that tournament's single group and its
`group_memberships` rows. Results are sorted newest first by `tournament_end`.

## Surface 1 — Hall of Fame

- The three `tournament_type` whitelists are removed. Champions are fetched for
  **every** completed tournament; type now controls grouping and card styling,
  never visibility.
- A fourth section, **Tournament Champions**, renders `open` tournaments. This is
  where the FC Mobile Premier League lands.
- A game filter row is added, URL-driven (`?game=<slug>`), built from active games
  and shown only at 2+ active games — matching the existing `/tournaments`
  pattern (server-rendered, shareable, indexable) rather than the client-state
  tabs used by `SeasonGameTabs`.
- The filter applies to the whole page: All-Time Awards, every champion section,
  and Bronze Finishes — so a game tab is genuinely that game's hall of fame.
- **Empty sections:** under a specific game, a section with no champions is
  hidden. On "All Games" the existing aspirational empty cards
  (`ChampionsCupEmptyCard`, `MastersChampionEmptyCard`) are kept, so the intended
  competition structure still reads.

## Surface 2 — Homepage champion spotlight

The most recent decided champion across all games (`latestChampion`), badged with
its game: champion name and avatar, tournament title, date, link to the
tournament. Renders nothing when no tournament has a decided champion.

## Surface 3 — Games page

Each game card gains a reigning-champion line — the champion of that game's most
recently completed tournament, via `reigningChampionByGame`. Omitted for games
with no decided champion, so a newly activated game simply doesn't show the line.

## Surface 4 — Tournament page

A completed tournament leads with a champion banner (champion, runner-up, prize)
above the bracket, instead of opening on a finished bracket the visitor must read
to learn who won. Tournaments that are undecided keep the current presentation.

## Components

Reused unchanged: `ChampionsCupCard`, `MastersChampionCard`, `CommunityClubCard`,
`BronzeCard`, and the two empty-card variants.

New:

- `components/hall-of-fame/TournamentChampionCard.tsx` — the `open`-type card.
- `components/hall-of-fame/HallOfFameGameFilter.tsx` — the URL-param filter row.
- `components/home/ChampionSpotlight.tsx` — homepage feature.
- `components/tournaments/ChampionBanner.tsx` — tournament page banner.

The games-page champion line is a few elements inline in the existing card, not a
component.

## Testing

Pure logic, unit-tested first (vitest, TDD):

- `resolveChampion` — winner from a completed final; drawn final → undecided;
  no final present; final present but not completed; runner-up identification;
  round-robin rank 1; round-robin dead tie → head-to-head; dead tie with no
  head-to-head match → undecided.
- `headToHeadWinner` — decided on points; level on points decided by goal
  difference; fully level → null; players who never met → null; multiple meetings
  aggregated.
- `groupByType` — every tournament type maps to a group; unknown type never
  throws.
- `latestChampion` / `reigningChampionByGame` — newest wins; per-game isolation;
  empty input.

Data fetching and the four page integrations are verified by `npm run build` plus
rendering `/hall-of-fame`, `/`, `/games` and the FC Mobile tournament page at
375px and desktop, confirming DER_KAISER appears as champion.

## Files

**New**

- `lib/tournaments/champions.ts` + `champions.test.ts`
- `components/hall-of-fame/TournamentChampionCard.tsx`
- `components/hall-of-fame/HallOfFameGameFilter.tsx`
- `components/home/ChampionSpotlight.tsx`
- `components/tournaments/ChampionBanner.tsx`

**Changed**

- `app/[locale]/(public)/hall-of-fame/page.tsx` — drop whitelists, add filter,
  add Tournament Champions section, hide-empty-per-game
- `app/[locale]/(public)/games/page.tsx` — reigning champion line
- `app/[locale]/(public)/tournaments/[slug]/page.tsx` — champion banner
- `app/[locale]/page.tsx` — champion spotlight

**Unchanged on purpose**

- `lib/tournaments/standings.ts` — shared with group stage and bracket
  advancement; head-to-head lives in the champion resolver instead.
- No migration. `tournaments` already carries everything needed; the champion is
  derived, never stored, so it cannot drift from the match results.

## Out of scope

- Resolving the FC Mobile third-place match (Demi vs Cid), which is still
  `scheduled`. Bronze Finishes is already type-agnostic and will pick it up once
  the match is played and confirmed.
- Any change to how `tournament_type` is chosen at creation. `open` staying the
  default is fine once it is no longer a visibility gate.
