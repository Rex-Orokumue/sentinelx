# Third place match — design

Date: 2026-08-03

## Problem

Tournaments only ever crown a champion. The two semifinal losers just... stop, with no match to
settle who finishes 3rd. Sentinel X should run a 3rd place (bronze) match, automatically, between
the two semifinal losers, and recognize the winner the same way it already recognizes the champion:
on the bracket page and in the Hall of Fame.

## Scope

In scope: the 3rd place match itself (auto-created, played through the existing result-verification
flow), its display on the bracket page, a Bronze placement in Hall of Fame, and an admin escape
hatch to credit a 3rd place finish without a match having been played (needed for tournaments run
before this feature existed).

Out of scope: any prize-pool payout tied to 3rd place (stays on the existing manual admin-credit
path, per `lib/matches/verify-actions.ts:311-313`), and a broader Hall of Fame revamp (new award
types, manually-curated awards like a future "Best Goal") — that's a separate future project.

## Trigger: when the match gets created

A `third_place` match is created automatically, for every tournament, the moment both `semi_final`
matches are confirmed with a real, decisive result. It hooks into the same place the `final` round
is already created — `confirmResult()` in `lib/matches/verify-actions.ts`, right after
`advanceKnockout()`. When the just-confirmed match's round is `semi_final`, a new
`createThirdPlaceMatch(admin, tournamentId)` runs:

1. Fetch the tournament's `semi_final` matches. Structurally there are always exactly 2 when the
   round exists (bracket sizing guarantees it).
2. If either isn't `status === 'completed'` (i.e. one was a `bye` or `forfeited`), stop — there's no
   legitimate loser on that side to send to the bronze match. No 3rd place match is created for that
   tournament's normal run (the admin manual-credit path, below, can still award one).
3. If both are completed, take the loser of each. Idempotency: skip if a `third_place` match already
   exists for this tournament (mirrors the existing `existing count` guard in `advanceKnockout`).
4. Insert one `matches` row: `round: 'third_place'`, `group_id: null`, the two losers as
   `player_a_id`/`player_b_id`, `status: 'scheduled'`, scheduled via the same
   `nextRoundScheduledAt` helper `advanceKnockout` already uses. Notify both players via the
   existing `notifyNewFixtures`.

This function is called once per semifinal confirmation; the first call (only one semi done) is a
no-op, the second creates the match.

## Data model

New enum value on `matches.round`: `'third_place'`. Migration `046_third_place_match.sql` drops and
re-adds the `matches_round_check` constraint (the pattern already used in migrations `006` and
`035`) to add it.

`third_place` is **deliberately not added to `ROUND_ORDER`** (`lib/tournaments/bracket.ts`).
`ROUND_ORDER` is the source of truth for bracket *progression* — `nextRoundName`, `getChampion`,
prize payout — and the bronze match doesn't progress anywhere; it's a sibling of the Final, not a
successor. It does get an entry in `ROUND_LABELS` ("Third Place Match"), so every place that already
does `ROUND_LABELS[round] ?? round` (dashboard fixture cards, match centre, etc.) displays it
correctly for free.

## Bug fix required: prize payout / completion check

`confirmResult()` currently detects "this was the Final" via `nextRoundName(m.round) === null`
(`lib/matches/verify-actions.ts:298`), because `final` is the only round that returns `null` from
`nextRoundName`. Once `third_place` also returns `null` (it's not in `ROUND_ORDER`), confirming the
bronze match would hit that same branch — marking the tournament `completed` and paying the full
`prize_pool` to the 3rd place winner. This check changes to the explicit `m.round === 'final'`.

`advanceKnockout()` is still called unconditionally for every knockout match including
`third_place` (harmless no-op: `nextRoundName('third_place')` is `null`, so it returns immediately)
— no change needed there.

## Admin flow

No new admin UI for the golden path — the 3rd place match goes through the existing
`MatchRow`/`confirmResult` result-verification flow, same as any other match. `confirmResult`'s
`isKnockout = m.round !== 'group'` already treats it as a knockout match (draws rejected, which is
correct — a bronze match needs a decisive result too).

One addition is required: `app/admin/tournaments/[id]/matches/page.tsx` groups knockout matches
strictly via `ROUND_ORDER.map(...)` (`knockoutSections`), so a `third_place` match would never
appear for admin to review. Add one more section, built directly by filtering
`all.filter(x => x.round === 'third_place')` (the same way `groupSections` is already built,
independent of `ROUND_ORDER`), labeled "Third Place Match".

Sentinel Score: no changes needed. `matchEventsFor()` (`lib/scoring/events.ts`) is round-agnostic —
completing/winning the bronze match already earns the normal +2 (complete) / +1 (win, no dispute)
automatically. The "titles won" tally (`lib/scoring/apply.ts:78`) already filters strictly to
`round === 'final'`, so it's unaffected.

## Bracket page display

`buildBracketDisplay` (`lib/tournaments/bracket-tree.ts`) reconstructs bracket topology by pairing
each round's *winners* into the next round's slots. A 3rd place match — built from *losers*, feeding
nothing — doesn't fit that shape, and it stays fully outside it: `third_place` is not in
`ROUND_ORDER`, so it never enters `orderKnockoutRounds`/`buildBracketDisplay` at all. No changes to
the bracket tree or `BracketTree.tsx`.

Instead, mirroring how the page already shows the Champion (a plain text block above the bracket,
populated once the Final is decided — not part of the tree), a matching block is added:

```tsx
{view.thirdPlace && (
  <div className="mb-6 rounded-2xl border border-slate-700/40 bg-slate-800/20 px-5 py-3 text-center">
    <p className="text-xs font-bold uppercase tracking-widest text-slate-400/80">Third Place</p>
    <p className="mt-1 text-base font-bold text-white">🥉 {view.thirdPlace.name}</p>
  </div>
)}
```

New helper `getThirdPlace(matches: BracketMatch[])` in `lib/tournaments/bracket.ts`, parallel to
`getChampion`, but recognizing **both** ways a 3rd place result can exist:

```ts
export function getThirdPlace(matches: BracketMatch[]): { id: string; name: string } | null {
  const m = matches.find(
    (m) => m.round === 'third_place' && (m.status === 'completed' || m.status === 'bye'),
  )
  if (!m) return null
  if (m.status === 'bye') return m.playerA // admin-credited, no match played
  if (m.score_a == null || m.score_b == null || m.score_a === m.score_b) return null
  return m.score_a > m.score_b ? m.playerA : m.playerB
}
```

`lib/tournaments/bracket-view.ts` adds `thirdPlace: getThirdPlace(allMatches)` to the returned
`BracketView` (the query already fetches every match regardless of round — no query change needed).

The in-progress bronze match itself isn't specially surfaced on the bracket page (consistent with
how no other pending match gets special bracket-page treatment) — both players see it via their
normal dashboard fixtures (`lib/dashboard/fixtures.ts` is already round-agnostic) and the Match
Centre page.

## Manual credit (no match played)

For a tournament where the bronze match either predates this feature or was skipped (semifinal bye
or forfeit), admin can directly credit a player as 3rd place without a match being played. This is
the same mechanism used for e.g. the current in-flight tournament.

On the admin matches page's new "Third Place Match" section: if no `third_place` match exists yet
for the tournament, show a small form — pick one player from the tournament's registrants, submit.
The action inserts:

```ts
{
  tournament_id: tournamentId,
  round: 'third_place',
  group_id: null,
  player_a_id: creditedPlayerId,
  player_b_id: null,
  status: 'bye',
  completed_at: new Date().toISOString(),
}
```

This reuses the `bye` status exactly as it's already used elsewhere (a slot awarded with no real
opponent). Two things fall out for free from existing code, not new logic:

- `getThirdPlace` (above) treats a `bye` third-place row as `playerA` winning — same as a real
  completed match, so the bracket page block and Hall of Fame entry work identically either way.
- `matchEventsFor` (`lib/scoring/events.ts:38`) only generates events for `status === 'completed'`
  or `'forfeited'` — a `bye` match produces **zero** Sentinel Score events. Correct: an admin credit
  shouldn't fabricate match-completion or win points.

One `third_place` row per tournament (real or credited) — the form only appears when none exists
yet.

## Hall of Fame

New `deriveThirdPlaces()` in `lib/hall-of-fame/awards.ts`, structurally parallel to
`deriveChampions()` but sourced from each tournament's `third_place` match via `getThirdPlace()`
instead of `getChampion()` on the `final` match:

```ts
export interface ThirdPlaceInput {
  tournamentId: string
  slug: string
  title: string
  gameName: string | null
  tournamentEnd: string | null
  thirdPlaceMatch: BracketMatch | null
}

export interface ThirdPlaceEntry {
  tournamentId: string
  slug: string
  title: string
  gameName: string | null
  date: string | null
  player: { id: string; name: string }
}

export function deriveThirdPlaces(inputs: ThirdPlaceInput[]): ThirdPlaceEntry[] {
  // same shape as deriveChampions: flatMap + getThirdPlace, sort most-recent-first, nulls last
}
```

Kept as separate types/function rather than generalizing `deriveChampions` itself — `ChampionInput`/
`ChampionEntry` are exercised by existing tests (`lib/hall-of-fame/awards.test.ts`) and consumed
elsewhere; duplicating ~20 lines is cheaper than reshaping a tested public API for this.

`app/(public)/hall-of-fame/page.tsx` gets one more query mirroring the existing final-match fetch,
just `.eq('round', 'third_place')` instead of `.eq('round', 'final')`, builds `ThirdPlaceInput[]`,
calls `deriveThirdPlaces`, and renders a new "🥉 Bronze" section directly below the existing
"🏆 Champions" section, same grid layout.

`ChampionCard` (`components/hall-of-fame/ChampionCard.tsx`) — currently only consumed by this one
page — is generalized into `PlacementCard`, taking `icon`, `player: {name}`, `slug`, `title`,
`gameName`, `date`, `fallbackLabel` as plain props (no shared entry type between Champion/Bronze
needed). Champions section passes `icon="🏆"` / `fallbackLabel="Champion"`; Bronze section passes
`icon="🥉"` / `fallbackLabel="Third Place"`.

## Edge cases

- **Semifinal bye or forfeit**: no automatic 3rd place match (no legitimate loser on that side).
  Admin can still manually credit a player via the credit form.
- **2-player tournament (no semifinal round exists)**: no 3rd place match, correctly — there's
  nothing to settle.
- **Bracket regenerated/re-rolled after a 3rd place match already exists**: not handled specially;
  no existing regeneration path touches already-completed knockout rounds, so this is no different
  from how the Final already behaves today.
- **Tournament with a manually-credited 3rd place, later gets a real semifinal-loser match created**
  (shouldn't happen — the auto-trigger's idempotency check covers this): the insert only fires when
  no `third_place` row exists yet, whether that row came from the auto-trigger or the manual-credit
  form.

## Files touched

- `supabase/migrations/046_third_place_match.sql` — new
- `lib/tournaments/bracket.ts` — add `getThirdPlace`, `ROUND_LABELS.third_place` (no `ROUND_ORDER`
  change)
- `lib/matches/verify-actions.ts` — `createThirdPlaceMatch`, call site in `confirmResult`, the
  `m.round === 'final'` fix
- `lib/tournaments/bracket-view.ts` — add `thirdPlace` to `BracketView`
- `app/(public)/tournaments/[slug]/bracket/page.tsx` — render the Third Place block
- `app/admin/tournaments/[id]/matches/page.tsx` — third-place section + manual-credit form
- new admin server action for the manual credit insert (alongside `verify-actions.ts` or a new
  small file, TBD at implementation time)
- `lib/hall-of-fame/awards.ts` — `deriveThirdPlaces`, `ThirdPlaceInput`, `ThirdPlaceEntry`
- `app/(public)/hall-of-fame/page.tsx` — third-place query + Bronze section
- `components/hall-of-fame/ChampionCard.tsx` → generalized to `PlacementCard`
