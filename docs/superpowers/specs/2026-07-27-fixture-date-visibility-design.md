# Fixture Date Visibility — Design

**Date:** 2026-07-27
**Status:** Approved, ready for implementation plan

## Context

`scheduled_at` already flows correctly from `matches` into `DashboardFixture` and renders via
`formatDateTime` in `FixtureCard` — but full-day matches (`is_full_day: true`, added by #24 and
now auto-populated by the round-scheduling feature) render with a literal `00:00` time, which
reads as a real kickoff time rather than "playable anytime that day." Combined with matches an
admin hasn't dated yet (`scheduled_at: null` → "Time TBD"), this is what reads as "dates aren't
showing." Separately, the Match Centre page (`app/(public)/matches/[id]/page.tsx`) doesn't select
or display `scheduled_at`/`is_full_day` at all — no date appears there today.

Three changes, all additive to existing code:
1. Format dates so a full-day match reads as a date, not a fake midnight kickoff — everywhere a
   fixture's date is shown (dashboard, Match Centre).
2. Visually grey out a dashboard fixture whose scheduled day hasn't arrived yet.
3. Group the dashboard's upcoming fixtures by date so a player can see what's on which day.

## 1. Full-day-aware date formatting — `lib/format.ts`

New formatter, alongside the existing `formatDateTime`/`formatDate`:

```ts
/**
 * A fixture's display date: date-only for a full-day match ("28 Jul 2026"),
 * date + time for a timed one ("28 Jul, 20:00"). Returns null for missing/
 * invalid input — callers fall back to their own "Time TBD" copy.
 */
export function formatFixtureDate(
  scheduledAt: string | null | undefined,
  isFullDay: boolean,
): string | null {
  return isFullDay ? formatDate(scheduledAt) : formatDateTime(scheduledAt)
}
```

Thin wrapper over the two existing formatters — no new date-math, just the isFullDay branch.

## 2. Dashboard — thread `isFullDay` through, use the new formatter

- `DashboardMatchInput`/`DashboardFixture` (`lib/dashboard/fixtures.ts`) gain `isFullDay: boolean`.
- `app/dashboard/page.tsx`'s matches select gains `is_full_day`; the `matches` mapping sets
  `isFullDay: mm.is_full_day`.
- `FixtureCard` (`components/dashboard/FixtureCard.tsx`) replaces
  `formatDateTime(fixture.scheduledAt) ?? 'Time TBD'` with
  `formatFixtureDate(fixture.scheduledAt, fixture.isFullDay) ?? 'Time TBD'`.

## 3. Grey out fixtures whose day hasn't arrived — `lib/dashboard/fixtures.ts`

`awaitingMyResult` already computes "has this match's scheduled instant passed `now`" internally
but doesn't expose it. Extract that as its own function and surface the result on every fixture:

```ts
function matchDayReached(scheduledAt: string | null, now: Date): boolean {
  if (scheduledAt == null) return false
  return new Date(scheduledAt).getTime() <= now.getTime()
}
```

`DashboardFixture` gains `matchDayReached: boolean`; `bucketFixtures` computes it for every match
(same `now` parameter it already threads through) and `awaitingMyResult` calls the extracted
function instead of inlining the comparison — behavior-preserving refactor, not a logic change.

`FixtureCard` renders a dimmed/muted card style when `fixture.status === 'scheduled' &&
!fixture.matchDayReached` (reduced opacity + muted border, via Tailwind classes already used
elsewhere in this component for the `cancelled` status). Live and completed fixtures are
unaffected — the dimming only applies to a still-scheduled match whose day hasn't started.

## 4. Group upcoming fixtures by date — `lib/dashboard/fixtures.ts` + `FixtureCard.tsx`

```ts
export interface FixtureDateGroup {
  dateLabel: string // "28 Jul 2026" or "Date TBD"
  fixtures: DashboardFixture[]
}

// Groups by WAT calendar date, ascending; a "Date TBD" group (for
// scheduledAt: null) sorts last regardless of its position in the input.
export function groupFixturesByDate(fixtures: DashboardFixture[]): FixtureDateGroup[]
```

Grouping key: `toDateTimeLocal(scheduledAt).slice(0, 10)` (WAT "YYYY-MM-DD", reusing the existing
helper — no new date-math) or `null` for an unscheduled fixture. Groups are sorted by that key
ascending with `null` forced last, then each group's label is rendered via `formatDate` (or
`'Date TBD'` for the null group) and its fixtures keep the ordering `bucketFixtures` already gives
them (ascending by `scheduledAt`, which is a no-op stable ordering within a single date group).

`ActiveFixtures` (`components/dashboard/FixtureCard.tsx`) replaces the flat "Upcoming" `Group`
with one `Group` per entry of `groupFixturesByDate(fixtures.upcoming)`, each labeled with its
`dateLabel` instead of the static "Upcoming" string. "Live" keeps its existing flat rendering
(a live match's date is irrelevant — it's happening now).

## 5. Match Centre — show the date, add `is_full_day` to the select

`MATCH_SELECT` (`app/(public)/matches/[id]/page.tsx`) gains `scheduled_at, is_full_day`; `MatchRow`
type gains matching fields. In the header card, below the status badge and above the player
names, render (only when non-null):

```tsx
{formatFixtureDate(m.scheduled_at, m.is_full_day) && (
  <p className="mb-3 text-center text-xs font-semibold text-slate-400">
    {formatFixtureDate(m.scheduled_at, m.is_full_day)}
  </p>
)}
```

Same formatter as the dashboard, so a match reads identically in both places.

## Testing

Vitest, alongside existing suites:
- `lib/format.test.ts`: `formatFixtureDate` — full-day → date-only; timed → date+time; null → null.
- `lib/dashboard/fixtures.test.ts` (existing file, has coverage for `bucketFixtures`/
  `awaitingMyResult` already): confirm `matchDayReached` extraction doesn't change
  `awaitingMyResult`'s existing tested behavior; add cases for `groupFixturesByDate` — ascending
  date grouping, `Date TBD` sorts last, fixtures preserve their within-group order.

Page-level changes (`app/dashboard/page.tsx`, `app/(public)/matches/[id]/page.tsx`) are I/O-bound
— exercised via the build, consistent with how this codebase already treats page components.

## Out of scope

- No change to `awaitingMyResult`'s actual semantics — `matchDayReached` is an extraction of
  existing logic, not new behavior.
- No change to the "Completed" fixtures section — date grouping applies to "Upcoming" only, where
  "what match is when" is the actual question a player has.
- No change to the admin Matches page (`components/admin/MatchRow.tsx`) — it already shows the
  raw scheduling inputs for editing; this feature is about read-only player-facing display.
