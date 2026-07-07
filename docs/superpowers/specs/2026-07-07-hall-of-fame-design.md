# Hall of Fame — Design (v1.0 #7)

**Route:** `/hall-of-fame`
**Date:** 2026-07-07
**Status:** Approved, ready for implementation plan

## Purpose

An all-time honors page for Sentinel X. Three complete, data-backed sections — no
placeholders, no "coming soon" slots. A Hall of Fame with three finished sections beats
one with three finished sections plus a fourth that signals incompleteness.

Server Component, mobile-first (375px up), follows the existing rankings page structure.

## Scope

**In:** Champions wall, MVP, Golden Boot.
**Out (deferred):** Best Goal — it needs an admin-curated video pick and admin tooling
(task #9). It lands with real content when #9 ships, not as a placeholder now.

## Sections

### 1. Featured awards — MVP + Golden Boot

Two single-winner award cards. Stacked on mobile, side-by-side at `sm` and up. No
honorable mentions / top-3 — the awards carry weight because they are singular; the
leaderboard (`/rankings`) already serves relative ranking.

- **MVP:** the highest `sentinel_score` among eligible players. Tiebreak: `wins` desc,
  then win rate desc. Because every player defaults to `sentinel_score = 70`, at launch
  (flat scores) this resolves naturally to most wins — the intended "fallback to wins"
  with no mode switch or special-case code. As Sentinel Score differentiates over time,
  the metric becomes what it was designed to be with zero intervention.
  Displays: avatar, name, `TierBadge`, the score value.
- **Golden Boot:** the highest `goals_scored` among eligible players. Tiebreak: `wins` desc.
  Displays: avatar, name, goal count.

**Eligibility gate:** `total_matches >= 1`. Defined **once** and shared with the rankings
page so the two definitions cannot drift:

- Add to `lib/rankings/leaderboard.ts`:
  - `export const RANKING_MIN_MATCHES = 1`
  - `export function isRankingEligible(p: { totalMatches: number }): boolean` →
    `p.totalMatches >= RANKING_MIN_MATCHES`
- Both the Hall of Fame page and the rankings page query with
  `.gte('total_matches', RANKING_MIN_MATCHES)`.
- Refactor `app/(public)/rankings/page.tsx` to use this constant in place of its current
  `.gt('total_matches', 0)` (identical semantics: `>= 1` ≡ `> 0`).

The value equals the semantic minimum (1 = at least one match), avoiding the
`MIN_MATCHES = 0` naming trap where a future reader "fixes" a constant whose value
contradicts its name.

### 2. Champions wall

Every completed tournament's champion, ordered most-recent-first by `tournament_end`.
Reverse chronological is correct at Sentinel X's current scale — the newest champion is
the most relevant to the active community.

**Source (authoritative event record, never a counter):** tournaments with
`status = 'completed'`, joined to their `final`-round match where the match
`status = 'completed'`. **Both** conditions are required — a tournament marked completed
whose final is not yet verified (a possible mid-workflow admin edge case) must NOT produce
a champion entry. The wall shows only fully confirmed results.

The winner is computed by reusing the existing `getChampion` helper from
`lib/tournaments/bracket.ts` — its returned winner `id` is then matched against the joined
final match's player rows to pull the champion's full profile (avatar, name). The winner
rule (`score_a > score_b`, guarding null scores and draws) is therefore reused, never
reimplemented.

`profiles.total_titles` remains a denormalized cache used only for the leaderboard sort. It
is never the champions wall's source.

Each entry displays: tournament title + game, champion avatar + name, tournament date,
and links to `/tournaments/[slug]`.

**Note:** player names are NOT linked to `/players/[username]` — that page is v2.0 #10 and
does not exist yet (only a `.gitkeep` placeholder). Avatar + name render un-linked until #10.

## Data layer

- **`lib/hall-of-fame/awards.ts`** — pure, unit-tested, no Supabase imports. Takes plain
  inputs, returns winners:
  - `pickMVP(players: PlayerStatsInput[]): RankedPlayer | null` — filters to eligible,
    sorts by `sentinelScore` desc → `wins` desc → win rate desc, returns first or `null`.
  - `pickGoldenBoot(players: PlayerStatsInput[]): RankedPlayer | null` — filters to
    eligible, sorts by `goalsScored` desc → `wins` desc, returns first or `null`.
  - `deriveChampions(tournaments, finalMatches): ChampionEntry[]` — for each completed
    tournament, locate its completed final match, call `getChampion`, and on a non-null
    result emit a `ChampionEntry`; ordered by `tournament_end` desc.
  - Reuses `PlayerStatsInput` / `RankedPlayer` types and `getChampion` — no new winner logic.
- **Page** — `app/(public)/hall-of-fame/page.tsx` (Server Component):
  - Parallel queries: (a) eligible profiles for awards; (b) completed tournaments plus
    their completed final matches with player profiles joined.
  - Maps DB rows into the pure helpers, renders sections.

## Components (`components/hall-of-fame/`)

- `AwardCard.tsx` — one featured award: avatar, name, metric value, optional `TierBadge`.
- `ChampionCard.tsx` — one tournament champion: tournament title/game, champion avatar/name,
  date, link to the tournament.
- Reuses existing `components/player/TierBadge.tsx` and `components/shared/EmptyState.tsx`.

## Empty states (real, never "coming soon")

- No eligible players → awards section renders a single `EmptyState`
  ("Awards unlock once matches are played").
- No completed tournaments with a confirmed final → champions renders `EmptyState`
  ("No champions crowned yet").
- Both empty → a single whole-page `EmptyState`.

## Testing

Vitest on `lib/hall-of-fame/awards.ts`:
- `pickMVP`: flat-70 scores resolve to most wins (fallback path); higher score beats more
  wins once scores differ; win-rate tiebreak; excludes `total_matches = 0`; empty → `null`.
- `pickGoldenBoot`: highest goals wins; `wins` tiebreak; excludes ineligible; empty → `null`.
- `deriveChampions`: skips a tournament whose final is not `completed`; skips
  null-score / drawn finals; orders most-recent-first; empty inputs → `[]`.

## SEO

`generateMetadata` + OpenGraph tags, matching the rankings page pattern (title/description,
`url`, `siteName`, `type: website`).

## Consistency notes

- No per-page WhatsApp share button — matches the sibling rankings page; there is no shared
  Share component yet. Add later when one is built.
- Mobile-first throughout; award cards and champion cards single-column at 375px.
