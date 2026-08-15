# Live Provisional Season Standings — Design Spec

**Status:** Approved by product owner, ready for implementation plan.

## Problem

`season_ranking_points` (the table behind the Season Leaderboard on `/seasons/[slug]`) is only written once per tournament, at completion — via `awardSeasonPoints()` in `lib/matches/season-points.ts`, called from `completeTournamentIfFinal`. A player's final placement band (champion/runner-up/semi-final/etc., via `bandsForPlacements()` in `lib/tournaments/season-placement.ts`) genuinely can't be known until they're eliminated or the whole bracket finishes — so today, anyone still competing shows nothing on the season leaderboard until their tournament ends. Players want to see roughly where they stand *while the tournament is still running*, not just at the end.

**Correction made during this design's research:** the season leaderboard this affects (`getSeasonLeaderboard()`, rendered by `components/seasons/SeasonLeaderboardTable.tsx` on `/seasons/[slug]`) is the **Champions Cup qualification** leaderboard — its own footnote says "top 16 at season end earn an invitation [to Champions Cup]." Masters qualification uses a *different* function, `getMonthlyLeaderboard()` (a rolling monthly window), which this design does not touch. Everything below is scoped to `getSeasonLeaderboard()` / Champions Cup qualification only.

## Decisions (confirmed with product owner)

1. **What provisional points represent:** a *guaranteed floor*, never a speculative estimate. A player still alive in the tournament shows the points they're guaranteed to have already secured by winning their way to their current round — a number that can only go up as they keep winning, never down. Not a win-rate-weighted projection.
2. **Masters/Champions Cup qualification gate:** provisional points are display-only. Qualification ranking (`lib/seasons/invitation-actions.ts`'s `selectInvitees`) continues to read only real, locked-in `season_ranking_points` rows — this code path is untouched by this design entirely.
3. **Group-stage players:** every actively-registered player shows at least the `non_advancer` floor (today's lowest tier) from registration onward, consistent with the LEFT JOIN fix shipped earlier the same day (`docs/superpowers/plans/2026-08-15-phase2-postship-fixes.md` Task 2.3) that already guarantees every registered player a row.
4. **Architecture: read-time only, nothing persisted.** No new table, no new column, no new write path triggered off match confirmation. Provisional standing is computed fresh every time the leaderboard is read, from the same source data (`matches`, `tournament_registrations`) every other placement calculation in this codebase already reads from. `season_ranking_points` itself is completely unchanged — still written exactly once, at tournament completion, exactly as today.

## Architecture

### New pure function: `guaranteedBandsForPlacements`

`lib/tournaments/season-placement.ts` gains a sibling to the existing `bandsForPlacements`:

```ts
export function guaranteedBandsForPlacements(
  matches: PlacementMatch[],
  activePlayerIds: string[],
): PlacementResult[]
```

Same signature and return shape as `bandsForPlacements`. The difference is direction: `bandsForPlacements` walks rounds recording the *loser* of each match (band = the round they were eliminated in). `guaranteedBandsForPlacements` instead walks rounds recording the furthest round each player has *won* into (a real win or a bye-advance both count as "won into the next round"). A player who hasn't won a knockout-round match yet (still in groups, or hasn't played their first knockout match) defaults to `'non_advancer'` — the same floor `bandsForPlacements` already defaults to for anyone with no recorded result.

This function is only ever meaningful for players who **haven't** been eliminated yet. A player who's already lost a match has a real, exact, final band from `bandsForPlacements` — there's nothing left to "guarantee," their placement is already known.

### Leaderboard integration

`getSeasonLeaderboard(admin, seasonId)` in `lib/seasons/data.ts` extends its existing query:

1. Keep the existing `season_ranking_points` + `season_noshow_penalties` fetch and summation exactly as-is (real, locked-in totals).
2. Additionally fetch the season's still-`active`-status community_club tournaments (masters is out of scope per the correction above — confirmed directly in `lib/seasons/invitation-actions.ts`'s `leaderboardFor`: it calls `getMonthlyLeaderboard` when `tournament_type === 'masters'` and `getSeasonLeaderboard` otherwise, so this function is exclusively the Champions Cup path) and their matches.
3. For each such tournament, run `guaranteedBandsForPlacements` against its current match state, and for every registered player who does **not already have a real `season_ranking_points` row for that tournament**, compute `pointsForBand('community_club', guaranteedBand)` as their provisional total.
4. Merge: a player's real locked-in total (if any) always wins and is never overwritten by a provisional guess. A player with no locked-in row yet gets the provisional number.
5. `SeasonLeaderboardRow` gains one new field: `isProvisional: boolean`.

### UI

`components/seasons/SeasonLeaderboardTable.tsx` renders one unified, ranked list (not two separate tables) — the whole point is "where do I stand right now" as a single answer. Rows with `isProvisional: true` get a small distinguishing tag (e.g. a "Live" badge next to the points column) so nobody mistakes an in-progress number for a final result. Sort order is unchanged (still by total points descending).

## Edge Cases

- **Bye-advances** count as winning into the next round, same as a real match win — matches how `bandsForPlacements` already treats byes as non-decisive/terminal.
- **Withdrawn/disqualified players** simply drop out of the provisional set, since both the real and provisional paths already filter to `status: 'active'` registrations only — no special-casing needed.
- **Tournament types other than community_club:** already excluded upstream by the same gate `getSeasonLeaderboard` uses today (`isSeasonTournamentType`) — provisional computation never runs for champions_cup/open tournaments themselves (a champions_cup tournament's own players aren't season-leaderboard participants; champions_cup is what the season leaderboard *qualifies you for*, not itself part of it).
- **A tournament with no matches yet at all** (registration open, bracket not generated): every registered player shows the `non_advancer` floor, same as the already-shipped LEFT JOIN behavior.

## Testing

- `guaranteedBandsForPlacements`: pure unit tests, same style as the existing `bandsForPlacements` suite — feed a partial bracket (some rounds decided, some not), assert a still-alive player's band matches "one round better than their last confirmed win," and assert an eliminated player is unaffected (not this function's concern).
- `getSeasonLeaderboard` (`lib/seasons/data.test.ts`, already exists from today's earlier fix): add a case proving a provisional row never overrides a real locked-in row for the same player, and that `isProvisional` is set correctly on both kinds of rows.

## Out of Scope

- Masters' `getMonthlyLeaderboard` — not touched by this design.
- Any change to `awardSeasonPoints`, `season_ranking_points`, or `selectInvitees` — all three are completely unchanged.
- A "projected/expected" points model (weighted by win rate or similar) — explicitly declined in favor of the guaranteed-floor model.
