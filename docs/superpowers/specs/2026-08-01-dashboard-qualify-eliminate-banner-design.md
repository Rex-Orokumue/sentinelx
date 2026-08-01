# Dashboard qualify/eliminate banner — design

Date: 2026-08-01

## Problem

Nothing on the player dashboard says whether a player is still alive in a tournament. Today:

- A player who doesn't finish top-2 in their group simply stops seeing new fixtures. Nothing tells
  them why, or that it's final.
- A player who advances to a knockout round with a real opponent gets a new fixture card
  (`components/dashboard/FixtureCard.tsx`) — but nothing frames it as "you qualified," just "here's
  your next match."
- A player who advances via a **bye** (odd advancer count) gets nothing at all. Their bye match row
  (`status: 'bye'`) is classified into the `completed` bucket by `RESOLVED` in
  `lib/dashboard/fixtures.ts:26`, so it renders as an ordinary-looking completed card with no
  opponent (`vs TBD`) tucked under "Completed matches" — the least visible place for the most
  important state a bye player can be in.

This surfaced from a conversation walking through live group standings (Group E, Group G) where
group-stage results had already been confirmed and a knockout draw already generated, with no
record anywhere of a "you're through" or "you're out" moment for the players involved.

## Approach: derive the status, don't store it

No new event, no new table column, no write path added to `recomputeGroupAndMaybeAdvance` or
`advanceKnockout`. The dashboard computes each tournament's qualify/eliminate status **live, at
render time**, from data those two functions already produce (`matches`, `group_memberships`).

This matters for two reasons specific to how this came up:

1. **Retroactive by construction.** Group E and Group G's group stages already finished before this
   feature exists. A stored-event approach would need a backfill; a derived approach just reflects
   whatever the current match/standings rows say, the first time this ships.
2. **Self-correcting.** A "qualified to quarter-final" status is naturally superseded the moment
   that match resolves — the function always looks at the player's *most advanced* match, so there
   is no stale banner to invalidate and no second write path to keep in sync with advancement logic.

## Data needed

The dashboard's existing `matches` query (`app/dashboard/page.tsx:118`) already fetches every match
the signed-in player is part of, across every tournament, with `round` and `status`. That alone is
enough for the knockout half of the logic.

It is **not** enough for "did my group finish and where did I rank" — a player's own 3 group
matches can all be complete while two other players in their group still have a match to play,
which could still move standings. So one more query is added, scoped to groups the player belongs
to:

```ts
const { data: myGroupMemberships } = await supabase
  .from('group_memberships')
  .select('group_id, player_id, wins, draws, losses, goals_for, goals_against, points')
  .in('group_id', /* group ids the player belongs to */)
```

...plus, per distinct `group_id`, a completion check identical in shape to the one already in
`recomputeGroupAndMaybeAdvance` (`lib/matches/verify-actions.ts:80-86`): count matches in that group
with `status != 'completed'`.

## `lib/dashboard/tournament-status.ts`

A pure function, one call per tournament the player is registered in:

```ts
interface TournamentStatusInput {
  tournamentId: string
  tournamentTitle: string
  tournamentSlug: string
  tournamentStatus: string // banner suppressed once this is 'completed'
  groupId: string | null // null => no group stage (<=8 players, straight knockout)
  groupComplete: boolean // ignored when groupId is null
  groupStandings: MembershipInput[] // this player's whole group; ignored when groupId is null
  knockoutMatches: (AdvanceMatch & { round: string })[] // this player's own round != 'group' matches
}

type TournamentBanner =
  | {
      kind: 'qualified'
      tournamentTitle: string
      tournamentSlug: string
      round: string
      awaitingOpponent: boolean // true => no fixture card exists yet for this round (bye, or
      // the rest of the previous round hasn't finished) — banner is their only signal they're through
    }
  | { kind: 'eliminated'; tournamentTitle: string; tournamentSlug: string; round: string }
  | null

function computeTournamentStatus(playerId: string, input: TournamentStatusInput): TournamentBanner
```

Logic:

1. **Any knockout matches for this player?** Take the one furthest along `ROUND_ORDER`
   (`lib/tournaments/bracket.ts:19`) — call it `latest`.
   - `latest.status === 'bye'` → `qualified`, `round: latest.round`, `awaitingOpponent: true`.
   - `latest.status` is `'scheduled'` or `'live'` → `qualified`, `round: latest.round`,
     `awaitingOpponent: false`. (They're already placed into this round — that placement *is* the
     "you qualified" moment, whether or not they've played it yet. The fixture card already shows
     the opponent, so the banner doesn't need to.)
   - `latest.status === 'forfeited'` → `eliminated`, `round: latest.round`. (`roundResolved`
     treats a double no-show as resolved with no winner — both sides are out.)
   - `latest.status === 'completed'`:
     - `matchWinnerId(latest) === playerId` → they won.
       - `nextRoundName(latest.round) === null` (they won the **final**) → no banner; a champion is
         celebrated elsewhere (Hall of Fame / home page), out of scope here.
       - otherwise → `qualified`, `round: nextRoundName(latest.round)`, `awaitingOpponent: true`.
         **Verified
         against live data, not just assumed:** `advanceKnockout` only creates the next round once
         *every* match in the current round resolves (`roundResolved` in
         `lib/tournaments/advancement.ts:21-26`), not the instant one player wins. Production has
         exactly this case right now — Codexempire beat Cristiano 2-0 in round_of_16 while 6 other
         round_of_16 matches are still `scheduled`, so no `quarter_final` row exists for them yet.
         This is the same "qualified, no opponent assigned yet" shape as a bye, just for a
         different reason (waiting on the rest of the round, not an odd bracket count) — same
         banner copy variant applies.
     - otherwise (they lost) → `eliminated`, `round: latest.round`.
2. **No knockout matches** (still confined to groups, or bracket not generated yet):
   - `groupId === null` → no banner. (Registration hasn't closed / bracket not generated — the
     empty "Active matches" state already covers this.)
   - `groupId` set but `!groupComplete` → no banner. Still mid-group-stage; existing fixture cards
     cover it.
   - `groupId` set and `groupComplete` → run `sortStandings(groupStandings)`, find this player's
     row. `row.advancing` → `qualified`, `round: 'knockout stage'`, `awaitingOpponent: true` (no
     specific round name yet — other groups may still be playing, so round 1 may not exist
     tournament-wide). Otherwise → `eliminated`, `round: 'group'`.

## UI

A small banner renders **above the fixture groups, inside the existing "Active matches"
`CollapsibleSection`** (`app/dashboard/page.tsx:397`) — one per tournament currently carrying a
status, before `<ActiveFixtures />`.

`round` holds either a real `ROUND_ORDER` code (look up display text in `ROUND_LABELS`,
`lib/tournaments/bracket.ts:27`) or one of two sentinel strings used only by the group-stage branch
(`'knockout stage'`, `'group'`) that are never passed to `ROUND_LABELS` — they get their own fixed
copy instead. The four `qualified`/`eliminated` × `round`-shape combinations:

| Case | `round` value | Copy |
|---|---|---|
| Qualified, opponent already assigned | real code, `awaitingOpponent: false` | 🎉 You advanced to the **{ROUND_LABELS[round]}** in {tournamentTitle}! |
| Qualified, no opponent yet (bye, or rest of round pending) | real code, `awaitingOpponent: true` | 🎉 You advanced to the **{ROUND_LABELS[round]}** in {tournamentTitle} — sit tight for your next fixture. |
| Qualified, knockout draw not made yet | `'knockout stage'` (always `awaitingOpponent: true`) | 🎉 You made the knockout stage in {tournamentTitle} — the draw will appear here once every group finishes. |
| Eliminated after group stage | `'group'` | You were eliminated from {tournamentTitle} after the **Group Stage**. Thanks for competing! 🎮 |
| Eliminated in a knockout round | real code | You were eliminated from {tournamentTitle} in the **{ROUND_LABELS[round]}**. Thanks for competing! 🎮 |

Each links to that tournament's public bracket page (`/tournaments/[slug]/bracket`).

Suppressed once `tournamentStatus === 'completed'` — the tournament's final placements live on the
bracket/Hall of Fame pages by then, and an "eliminated after Group Stage" card sitting on a
player's dashboard for a tournament that ended weeks ago is stale, not informative.

Not dismissible, no read/unread state — nothing to store. It disappears on its own once superseded
(next round) or once the tournament completes.

## Explicitly out of scope

- Bell notification / WhatsApp message for this event. The infra exists
  (`lib/notifications/inbox.ts`, `lib/notifications/notify.ts`) and wiring it in later is a small,
  independent addition, but it wasn't asked for here — the ask was specifically a dashboard visual.
- A "Champion" banner for winning the final.
- Backfilling or otherwise persisting anything for tournaments that already resolved before this
  ships — the derived approach makes that unnecessary by construction.

## Testing

`lib/dashboard/tournament-status.test.ts`, unit tests against `computeTournamentStatus` covering:

- no matches at all → null
- group stage incomplete → null
- group stage complete, top-2 → qualified, round `'knockout stage'`, `awaitingOpponent: true`
- group stage complete, outside top-2 → eliminated, round `'group'`
- knockout match scheduled → qualified, `awaitingOpponent: false`
- knockout match live → qualified, `awaitingOpponent: false`
- knockout match is a bye → qualified, `awaitingOpponent: true`
- knockout match completed, won, next round not yet generated → qualified,
  `round: nextRoundName(latest.round)`, `awaitingOpponent: true` (the Codexempire case above)
- knockout match completed, lost → eliminated, round `latest.round`
- knockout match forfeited → eliminated, round `latest.round`
- won the final (`nextRoundName` returns null) → null
- two knockout rows for the same player (e.g. a completed round_of_16 win plus a scheduled
  quarter_final already generated) → picks the `quarter_final` row as `latest`, not the completed one

Same style as the existing `lib/tournaments/standings.test.ts` and `lib/tournaments/advancement.test.ts`.
