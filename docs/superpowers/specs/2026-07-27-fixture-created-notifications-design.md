# Fixture-Created Notifications — Design

**Date:** 2026-07-27
**Status:** Approved, ready for implementation plan

## Context

The in-app notification bell covers 8 event types (`listing_approved`, `withdrawal_paid`,
`result_confirmed`, `referral_credited`, `wallet_credited`, `friend_request`,
`listing_removed`, `withdrawal_rejected`) — none of them fire when a fixture is created for a
player. The only fixture-related notification at all is the WhatsApp-only `fixture_reminder` cron
(`app/api/cron/fixture-reminders/route.ts`, ~1 hour before kickoff), which is currently a no-op
(`TERMII_API_KEY` unset) and, independently, doesn't suit full-day matches (its 65-minute window
logic only makes sense for an exact kickoff instant, not a midnight-anchored full-day date). Net
result: a player today gets zero notification, through any channel, when a match is created for
them.

**Critical constraint surfaced during design:** `generate()`
(`lib/tournaments/bracket-admin-actions.ts`) — the initial bracket draw and re-roll — runs while a
tournament is still `registration_closed`, a **staff-only preview** specifically so re-rolling
doesn't leak matchups to players early (see the comment on `isTournamentPublished` in
`lib/dashboard/fixtures.ts`). Notifying at `generate()` time would leak pairings before the admin
publishes. The first round's notifications must instead fire at `publishBracket` — the moment the
tournament flips to `active` and fixtures actually become publicly visible. The two later
match-creation points (group→knockout advance, knockout round N→N+1) both run against an
already-`active` tournament, so they're safe to notify immediately at creation.

## New notification type — follows the existing `result_confirmed`/`prize_credited` pattern exactly

- `lib/notifications/inbox.ts`: add `'fixture_assigned'` to the `NotificationType` union.
- `lib/notifications/templates.ts`: add a `TemplateInput` variant —

  ```ts
  | { type: 'fixture_assigned'; playerA: string; playerB: string; tournament: string; matchUrl: string; whenLabel: string | null }
  ```

  rendered as: `📅 New Sentinel X fixture: {playerA} vs {playerB} ({tournament})` + (if
  `whenLabel` — `— {whenLabel}`) + ` {matchUrl}`.
- `lib/notifications/keys.ts`: add `fixtureKey(matchId, playerId) => \`fixture:${matchId}:${playerId}\`` (same shape as the existing `resultKey`/`reminderKey`).

## Shared helper — `lib/notifications/fixture-created.ts` (new file)

```ts
export interface NewFixtureRow {
  id: string
  tournamentId: string
  playerAId: string
  playerBId: string | null // null => bye, skipped — nothing for the player to prepare for
  scheduledAt: string | null
  isFullDay: boolean
}

// Notifies both players of a newly-created (and now-visible) match: in-app
// always, WhatsApp best-effort (currently a no-op until TERMII_API_KEY is
// set — same inert-until-activated behavior as every other notify() call in
// this codebase).
export async function notifyNewFixtures(admin: Admin, rows: NewFixtureRow[]): Promise<void>
```

Implementation: filter out byes (`playerBId == null`), batch-fetch player display names
(`profiles`) and the tournament title once for all rows, then per real match call `notify({ type:
'fixture_assigned', ... })` and `notifyInApp({ type: 'fixture_assigned', ... link: '/matches/{id}'
})` for both `playerAId` and `playerBId`. `whenLabel` is `formatFixtureDate(scheduledAt,
isFullDay)` (existing helper — full-day-aware, already used everywhere else a fixture's date is
shown).

## Three call sites

1. **`publishBracket`** (`lib/tournaments/bracket-admin-actions.ts`) — after the existing `.update({ status: 'active' })`, `select` all of the tournament's current `matches` (`id, player_a_id, player_b_id, scheduled_at, is_full_day`) and pass them to `notifyNewFixtures`. This is the **only** trigger for the tournament's first round — whether that's a full group stage or a ≤8-player straight-knockout round 1 — fired exactly when fixtures become public. `generate()` itself is untouched; no notification risk from re-rolling a not-yet-published draft.
2. **`recomputeGroupAndMaybeAdvance`** (`lib/matches/verify-actions.ts`) — after inserting the knockout-round-1 rows, change the bare `.insert(rows)` to `.insert(rows).select('id, player_a_id, player_b_id, scheduled_at, is_full_day')` and pass the returned rows to `notifyNewFixtures`.
3. **`advanceKnockout`** (`lib/matches/verify-actions.ts`) — same treatment on its insert of the next knockout round.

## Testing

- `lib/notifications/templates.ts` gains a case in its existing render switch — exercised by build/type-check like its siblings (no dedicated template test file exists today; consistent with current coverage).
- `notifyNewFixtures` is I/O-bound (Supabase reads + the existing best-effort `notify`/`notifyInApp`) — exercised via the build and manual admin testing, matching how `bracket-admin-actions.ts`/`verify-actions.ts` are already tested in this codebase.
- No test file for `lib/notifications/fixture-created.ts` — mirrors the untested-action-layer convention already established for its three call sites.

## Out of scope

- No notification when an admin later hand-edits an already-created match's `scheduled_at` via `updateMatch` (`lib/matches/admin-actions.ts`) — this feature covers fixture *creation* only, per the reported gap ("not even notified... when they have fixtures"), not every subsequent date edit.
- No change to the existing `fixture_reminder` cron or its full-day-match timing gap — separate, pre-existing issue, not introduced or worsened by this feature.
- No backfill of notifications for already-existing fixtures on live tournaments — only newly-created matches from this point forward.
