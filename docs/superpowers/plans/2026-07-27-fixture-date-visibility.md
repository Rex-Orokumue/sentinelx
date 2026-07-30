# Fixture Date Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A player looking at their dashboard or the Match Centre page sees a fixture's real date (full-day matches read as a date, not a fake `00:00` kickoff), can tell at a glance which upcoming matches haven't started yet (dimmed), and sees upcoming fixtures grouped by date instead of one flat list.

**Architecture:** One new formatter (`formatFixtureDate`) branches on `is_full_day` to pick date-only vs date+time display, reusing the two existing formatters. `bucketFixtures` gains a `matchDayReached` flag per fixture (extracted from logic that already exists inline) and a new `groupFixturesByDate` buckets the upcoming list by WAT calendar date. Both the dashboard page and the Match Centre page start selecting `is_full_day` (dashboard already selects `scheduled_at`; Match Centre currently selects neither) and pass it through to display.

**Tech Stack:** Next.js 14 Server Components, Vitest, TypeScript, Tailwind.

## Global Constraints

- All fixture dates render in WAT (`Africa/Lagos`) via the existing `lib/format.ts` helpers — no new timezone math, no client-side date formatting.
- `matchDayReached` extraction must not change `awaitingMyResult`'s existing tested behavior (see `lib/dashboard/fixtures.test.ts`, "bucketFixtures — awaitingMyResult" suite) — it's a behavior-preserving refactor.
- Design source of truth: `docs/superpowers/specs/2026-07-27-fixture-date-visibility-design.md`.

---

### Task 1: `formatFixtureDate` — `lib/format.ts`

**Files:**
- Modify: `lib/format.ts` (append after `todayDateLocal`, end of file)
- Test: `lib/format.test.ts`

**Interfaces:**
- Consumes: `formatDate`, `formatDateTime` (existing, same file).
- Produces: `formatFixtureDate(scheduledAt: string | null | undefined, isFullDay: boolean): string | null` — consumed by Task 3 (`FixtureCard`) and Task 5 (Match Centre page).

- [ ] **Step 1: Write the failing tests**

Add to `lib/format.test.ts` (after the existing `todayDateLocal` describe block):

```typescript
describe('formatFixtureDate', () => {
  it('returns date-only for a full-day match', () => {
    expect(formatFixtureDate('2026-07-27T23:00:00.000Z', true)).toBe('28 Jul 2026')
  })

  it('returns date + time for a timed match', () => {
    expect(formatFixtureDate('2026-07-08T19:00:00.000Z', false)).toBe('8 Jul, 20:00')
  })

  it('returns null for missing input regardless of isFullDay', () => {
    expect(formatFixtureDate(null, true)).toBeNull()
    expect(formatFixtureDate(null, false)).toBeNull()
    expect(formatFixtureDate(undefined, true)).toBeNull()
  })
})
```

Update the top-of-file import from `lib/format.ts` to include the new name:

```typescript
import { formatNaira, fromDateLocal, todayDateLocal, formatFixtureDate } from './format'
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/format.test.ts`
Expected: FAIL — `formatFixtureDate` is not exported.

- [ ] **Step 3: Implement**

Append to `lib/format.ts`:

```typescript
/**
 * A fixture's display date: date-only for a full-day match ("28 Jul 2026"),
 * date + time for a timed one ("8 Jul, 20:00"). Returns null for missing/
 * invalid input — callers fall back to their own "Time TBD" copy.
 */
export function formatFixtureDate(
  scheduledAt: string | null | undefined,
  isFullDay: boolean,
): string | null {
  return isFullDay ? formatDate(scheduledAt) : formatDateTime(scheduledAt)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/format.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/format.ts lib/format.test.ts
git commit -m "feat: add formatFixtureDate for full-day-aware fixture display"
```

---

### Task 2: `matchDayReached` extraction + `groupFixturesByDate` — `lib/dashboard/fixtures.ts`

**Files:**
- Modify: `lib/dashboard/fixtures.ts:1-64` (`DashboardMatchInput`, `DashboardFixture`, `awaitingMyResult`, `bucketFixtures`)
- Test: `lib/dashboard/fixtures.test.ts`

**Interfaces:**
- Produces: `DashboardFixture.matchDayReached: boolean`; `DashboardFixture.isFullDay: boolean` (field added here, populated by Task 4's dashboard page query); `FixtureDateGroup { dateLabel: string; fixtures: DashboardFixture[] }`; `groupFixturesByDate(fixtures: DashboardFixture[]): FixtureDateGroup[]` — consumed by Task 3 (`FixtureCard`'s `ActiveFixtures`).
- Consumes: `toDateTimeLocal`, `formatDate` from `@/lib/format` (existing).

- [ ] **Step 1: Write the failing tests**

Add to `lib/dashboard/fixtures.test.ts`. First, update the top import and the `m()` helper to include `isFullDay` (every existing call site uses the helper's defaults, so this is additive — no existing test needs to change):

```typescript
import {
  bucketFixtures,
  groupFixturesByDate,
  isTournamentPublished,
  toWhatsAppNumber,
  buildOpponentWhatsAppUrl,
  type DashboardMatchInput,
} from './fixtures'

const NOW = new Date('2026-07-07T12:00:00Z')

function m(over: Partial<DashboardMatchInput> & { id: string }): DashboardMatchInput {
  return {
    status: 'scheduled',
    scheduledAt: null,
    isFullDay: false,
    round: 'group',
    opponentName: 'Opp',
    tournamentTitle: 'Cup',
    tournamentSlug: 'cup',
    ...over,
  }
}
```

Add two new `describe` blocks (after the existing "bucketFixtures — awaitingMyResult" block):

```typescript
describe('bucketFixtures — matchDayReached', () => {
  it('is true once scheduledAt has passed', () => {
    const r = bucketFixtures(
      [m({ id: 'p', status: 'scheduled', scheduledAt: '2026-07-01T10:00:00Z' })],
      new Set(),
      NOW,
    )
    expect(r.upcoming[0].matchDayReached).toBe(true)
  })

  it('is false for a future scheduledAt', () => {
    const r = bucketFixtures(
      [m({ id: 'f', status: 'scheduled', scheduledAt: '2026-08-01T10:00:00Z' })],
      new Set(),
      NOW,
    )
    expect(r.upcoming[0].matchDayReached).toBe(false)
  })

  it('is false for a null scheduledAt', () => {
    const r = bucketFixtures([m({ id: 'n', status: 'scheduled', scheduledAt: null })], new Set(), NOW)
    expect(r.upcoming[0].matchDayReached).toBe(false)
  })
})

describe('groupFixturesByDate', () => {
  it('groups fixtures by WAT calendar date, ascending', () => {
    const r = bucketFixtures(
      [
        m({ id: 'a', scheduledAt: '2026-08-02T10:00:00Z' }),
        m({ id: 'b', scheduledAt: '2026-08-01T09:00:00Z' }),
        m({ id: 'c', scheduledAt: '2026-08-01T18:00:00Z' }),
      ],
      new Set(),
      NOW,
    )
    const groups = groupFixturesByDate(r.upcoming)
    expect(groups.map((g) => g.dateLabel)).toEqual(['1 Aug 2026', '2 Aug 2026'])
    expect(groups[0].fixtures.map((f) => f.id)).toEqual(['b', 'c'])
    expect(groups[1].fixtures.map((f) => f.id)).toEqual(['a'])
  })

  it('puts a Date TBD group last regardless of input order', () => {
    const r = bucketFixtures(
      [
        m({ id: 'tbd', scheduledAt: null }),
        m({ id: 'dated', scheduledAt: '2026-08-01T09:00:00Z' }),
      ],
      new Set(),
      NOW,
    )
    const groups = groupFixturesByDate(r.upcoming)
    expect(groups.map((g) => g.dateLabel)).toEqual(['1 Aug 2026', 'Date TBD'])
  })

  it('returns no groups for an empty list', () => {
    expect(groupFixturesByDate([])).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/dashboard/fixtures.test.ts`
Expected: FAIL — `groupFixturesByDate` is not exported, and `matchDayReached`/`isFullDay` are `undefined` on the returned fixtures.

- [ ] **Step 3: Implement**

In `lib/dashboard/fixtures.ts`, replace the top of the file through `bucketFixtures` (lines 1-64) with:

```typescript
import { toDateTimeLocal, formatDate } from '@/lib/format'

export interface DashboardMatchInput {
  id: string
  status: string
  scheduledAt: string | null
  isFullDay: boolean
  round: string
  opponentName: string
  opponentWhatsapp?: string | null
  tournamentTitle: string
  tournamentSlug: string
}

export interface DashboardFixture extends DashboardMatchInput {
  awaitingMyResult: boolean
  matchDayReached: boolean
}

// A match is resolved once it reaches any of these states — never "awaiting result".
// ('verified' is a match_results status, kept here defensively.)
const RESOLVED = new Set(['completed', 'verified', 'cancelled', 'disputed', 'bye'])

// Mirrors the staff-only preview gate on the public bracket page: a bracket generated
// at registration close (status 'registration_closed') is a staff-only preview until
// admin publishes it (status 'active'/'completed'). A player's own fixtures must stay
// hidden until then too, or re-rolling the draw pre-publish leaks matchups early.
export function isTournamentPublished(status: string | null | undefined): boolean {
  return status === 'active' || status === 'completed'
}

// Has this match's scheduled instant passed `now`? False for an unscheduled match —
// there's nothing to compare against yet.
function matchDayReached(scheduledAt: string | null, now: Date): boolean {
  if (scheduledAt == null) return false
  return new Date(scheduledAt).getTime() <= now.getTime()
}

function awaitingMyResult(
  m: DashboardMatchInput,
  submitted: Set<string>,
  now: Date,
): boolean {
  if (RESOLVED.has(m.status)) return false
  if (submitted.has(m.id)) return false
  if (m.status === 'live') return true
  return matchDayReached(m.scheduledAt, now)
}

// Ascending by ISO date string, nulls last. ISO-8601 sorts chronologically.
function ascNullsLast(a: string | null, b: string | null): number {
  if (a == null) return b == null ? 0 : 1
  if (b == null) return -1
  return a.localeCompare(b)
}

export function bucketFixtures(
  matches: DashboardMatchInput[],
  submittedMatchIds: Set<string>,
  now: Date,
): { live: DashboardFixture[]; upcoming: DashboardFixture[]; completed: DashboardFixture[] } {
  const withFlags: DashboardFixture[] = matches.map((m) => ({
    ...m,
    awaitingMyResult: awaitingMyResult(m, submittedMatchIds, now),
    matchDayReached: matchDayReached(m.scheduledAt, now),
  }))
  const live = withFlags.filter((f) => f.status === 'live')
  const upcoming = withFlags
    .filter((f) => f.status === 'scheduled')
    .sort((a, b) => ascNullsLast(a.scheduledAt, b.scheduledAt))
  const completed = withFlags
    .filter((f) => f.status !== 'live' && f.status !== 'scheduled')
    .sort((a, b) => ascNullsLast(b.scheduledAt, a.scheduledAt)) // descending, nulls last
  return { live, upcoming, completed }
}

export interface FixtureDateGroup {
  dateLabel: string
  fixtures: DashboardFixture[]
}

// Groups by WAT calendar date, ascending; a "Date TBD" group (unscheduled
// fixtures) always sorts last regardless of input order. Assumes its input is
// already ordered the way each group's fixtures should render (bucketFixtures
// already sorts `upcoming` ascending by scheduledAt).
export function groupFixturesByDate(fixtures: DashboardFixture[]): FixtureDateGroup[] {
  const byKey = new Map<string, DashboardFixture[]>()
  for (const f of fixtures) {
    const key = f.scheduledAt ? toDateTimeLocal(f.scheduledAt).slice(0, 10) : ''
    const group = byKey.get(key)
    if (group) group.push(f)
    else byKey.set(key, [f])
  }
  const keys = Array.from(byKey.keys()).sort((a, b) => {
    if (a === '') return b === '' ? 0 : 1
    if (b === '') return -1
    return a.localeCompare(b)
  })
  return keys.map((key) => ({
    dateLabel: key === '' ? 'Date TBD' : (formatDate(byKey.get(key)![0].scheduledAt) as string),
    fixtures: byKey.get(key)!,
  }))
}
```

(Everything below `bucketFixtures` in the original file — `toWhatsAppNumber`, `buildOpponentWhatsAppUrl` — is unchanged.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/dashboard/fixtures.test.ts`
Expected: PASS (all existing + new cases).

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard/fixtures.ts lib/dashboard/fixtures.test.ts
git commit -m "feat: add matchDayReached flag and groupFixturesByDate to dashboard fixtures"
```

---

### Task 3: `FixtureCard` — full-day formatting, dimming, date grouping

**Files:**
- Modify: `components/dashboard/FixtureCard.tsx`

**Interfaces:**
- Consumes: `formatFixtureDate` (Task 1, `@/lib/format`); `groupFixturesByDate`, `type FixtureDateGroup` (Task 2, `@/lib/dashboard/fixtures`).

- [ ] **Step 1: Update the date display and add dimming**

In `components/dashboard/FixtureCard.tsx`, change the import line:

```typescript
import { formatDateTime } from '@/lib/format'
```

to:

```typescript
import { formatFixtureDate } from '@/lib/format'
```

Change the date line inside `FixtureCard` from:

```typescript
              {formatDateTime(fixture.scheduledAt) ?? 'Time TBD'}
```

to:

```typescript
              {formatFixtureDate(fixture.scheduledAt, fixture.isFullDay) ?? 'Time TBD'}
```

Change the card's outer `<div>` className from:

```typescript
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 transition-colors hover:border-slate-600">
```

to:

```typescript
    <div
      className={`rounded-2xl border p-4 transition-colors ${
        fixture.status === 'scheduled' && !fixture.matchDayReached
          ? 'border-slate-800/60 bg-slate-900/60 opacity-60'
          : 'border-slate-800 bg-slate-900 hover:border-slate-600'
      }`}
    >
```

- [ ] **Step 2: Group "Upcoming" fixtures by date in `ActiveFixtures`**

Add to the import line at the top of the file:

```typescript
import { buildOpponentWhatsAppUrl, groupFixturesByDate, type DashboardFixture, type FixtureDateGroup } from '@/lib/dashboard/fixtures'
```

Replace the `ActiveFixtures` function:

```typescript
export function ActiveFixtures({
  fixtures,
}: {
  fixtures: { live: DashboardFixture[]; upcoming: DashboardFixture[] }
}) {
  const total = fixtures.live.length + fixtures.upcoming.length
  if (total === 0) {
    return (
      <EmptyState
        icon="🎮"
        title="No active fixtures"
        body="Register for a tournament and your live/upcoming matches will show up here."
      />
    )
  }
  const upcomingGroups = groupFixturesByDate(fixtures.upcoming)
  return (
    <div className="space-y-5">
      <Group label="Live" items={fixtures.live} />
      {upcomingGroups.map((g: FixtureDateGroup) => (
        <Group key={g.dateLabel} label={g.dateLabel} items={g.fixtures} />
      ))}
    </div>
  )
}
```

(`Group`, `CompletedFixtures`, and `FixtureCard`'s WhatsApp-link handling are otherwise unchanged.)

- [ ] **Step 3: Run the full test suite and type-check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests PASS. Type errors are expected at this point for `app/dashboard/page.tsx` (doesn't supply `isFullDay` yet) — confirm the *only* errors are in that file, fixed by Task 4.

- [ ] **Step 4: Commit**

```bash
git add components/dashboard/FixtureCard.tsx
git commit -m "feat: dim not-yet-started fixtures and group upcoming ones by date"
```

---

### Task 4: Dashboard page — thread `is_full_day` through

**Files:**
- Modify: `app/dashboard/page.tsx:107-242`

**Interfaces:** None new — wires Task 2's `DashboardMatchInput.isFullDay` field to its data source.

- [ ] **Step 1: Add `is_full_day` to the matches select**

In `app/dashboard/page.tsx`, change the matches query select string from:

```typescript
      .select(
        'id, status, scheduled_at, round, tournament_id, player_a_id, player_b_id, ' +
          'player_a:profiles!matches_player_a_id_fkey(id, username, display_name), ' +
          'player_b:profiles!matches_player_b_id_fkey(id, username, display_name), ' +
          'tournament:tournaments(title, slug, status, data_support_text, data_support_whatsapp)',
      )
```

to:

```typescript
      .select(
        'id, status, scheduled_at, is_full_day, round, tournament_id, player_a_id, player_b_id, ' +
          'player_a:profiles!matches_player_a_id_fkey(id, username, display_name), ' +
          'player_b:profiles!matches_player_b_id_fkey(id, username, display_name), ' +
          'tournament:tournaments(title, slug, status, data_support_text, data_support_whatsapp)',
      )
```

- [ ] **Step 2: Add `is_full_day` to the raw row type**

Change the `rawMatches` cast type from:

```typescript
  const rawMatches = ((matchesRes.data as unknown[] | null) ?? []) as {
    id: string
    status: string
    scheduled_at: string | null
    round: string
    tournament_id: string
    player_a_id: string
    player_b_id: string
    player_a: ProfileRef
    player_b: ProfileRef
    tournament: TournamentRef
  }[]
```

to:

```typescript
  const rawMatches = ((matchesRes.data as unknown[] | null) ?? []) as {
    id: string
    status: string
    scheduled_at: string | null
    is_full_day: boolean
    round: string
    tournament_id: string
    player_a_id: string
    player_b_id: string
    player_a: ProfileRef
    player_b: ProfileRef
    tournament: TournamentRef
  }[]
```

- [ ] **Step 3: Populate `isFullDay` in the `matches` mapping**

Change the `matches` mapping from:

```typescript
    return {
      id: mm.id,
      status: mm.status,
      scheduledAt: mm.scheduled_at,
      round: mm.round,
      opponentName: nameOf(opponent),
      opponentWhatsapp: whatsappByKey.get(`${mm.tournament_id}:${opponentId}`) ?? null,
      tournamentTitle: t?.title ?? 'Tournament',
      tournamentSlug: t?.slug ?? '',
    }
```

to:

```typescript
    return {
      id: mm.id,
      status: mm.status,
      scheduledAt: mm.scheduled_at,
      isFullDay: mm.is_full_day,
      round: mm.round,
      opponentName: nameOf(opponent),
      opponentWhatsapp: whatsappByKey.get(`${mm.tournament_id}:${opponentId}`) ?? null,
      tournamentTitle: t?.title ?? 'Tournament',
      tournamentSlug: t?.slug ?? '',
    }
```

- [ ] **Step 4: Type-check and build**

Run: `npx tsc --noEmit && npm run build`
Expected: no type errors, clean build.

- [ ] **Step 5: Commit**

```bash
git add app/dashboard/page.tsx
git commit -m "feat: pass is_full_day from dashboard matches query to fixtures"
```

---

### Task 5: Match Centre — show the scheduled date

**Files:**
- Modify: `app/(public)/matches/[id]/page.tsx`

**Interfaces:**
- Consumes: `formatFixtureDate` (Task 1, `@/lib/format`).

- [ ] **Step 1: Add `scheduled_at`/`is_full_day` to the select and row type**

Change `MATCH_SELECT`:

```typescript
const MATCH_SELECT =
  'id, round, status, score_a, score_b, youtube_stream_url, replay_url, player_a_id, player_b_id, ' +
  'tournaments(title, slug), ' +
  'player_a:profiles!matches_player_a_id_fkey(username, display_name), ' +
  'player_b:profiles!matches_player_b_id_fkey(username, display_name)'
```

to:

```typescript
const MATCH_SELECT =
  'id, round, status, score_a, score_b, scheduled_at, is_full_day, youtube_stream_url, replay_url, player_a_id, player_b_id, ' +
  'tournaments(title, slug), ' +
  'player_a:profiles!matches_player_a_id_fkey(username, display_name), ' +
  'player_b:profiles!matches_player_b_id_fkey(username, display_name)'
```

Change the `MatchRow` type:

```typescript
type MatchRow = {
  id: string
  round: string
  status: string
  score_a: number | null
  score_b: number | null
  youtube_stream_url: string | null
  replay_url: string | null
  player_a_id: string | null
  player_b_id: string | null
  tournaments: { title: string; slug: string } | null
  player_a: ProfileRef
  player_b: ProfileRef
}
```

to:

```typescript
type MatchRow = {
  id: string
  round: string
  status: string
  score_a: number | null
  score_b: number | null
  scheduled_at: string | null
  is_full_day: boolean
  youtube_stream_url: string | null
  replay_url: string | null
  player_a_id: string | null
  player_b_id: string | null
  tournaments: { title: string; slug: string } | null
  player_a: ProfileRef
  player_b: ProfileRef
}
```

- [ ] **Step 2: Import the formatter and render the date**

Add to the imports:

```typescript
import { formatFixtureDate } from '@/lib/format'
```

In the header card, change:

```tsx
      <div className="mb-6 rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <div className="mb-3 flex justify-center">
          <span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${status.cls}`}>{status.label}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
```

to:

```tsx
      <div className="mb-6 rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <div className="mb-3 flex justify-center">
          <span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${status.cls}`}>{status.label}</span>
        </div>
        {formatFixtureDate(m.scheduled_at, m.is_full_day) && (
          <p className="mb-3 text-center text-xs font-semibold text-slate-400">
            {formatFixtureDate(m.scheduled_at, m.is_full_day)}
          </p>
        )}
        <div className="flex items-center justify-between gap-4">
```

- [ ] **Step 3: Type-check and build**

Run: `npx tsc --noEmit && npm run build`
Expected: no type errors, clean build.

- [ ] **Step 4: Manual verification**

Using a real match ID from the live tournament (a group-stage match that already has `scheduled_at`/`is_full_day` set — see the earlier verification query), load `/matches/<id>` and confirm the date renders as a plain date ("28 Jul 2026", no time) under the status badge. Load the dashboard and confirm: (a) fixtures with a full-day date show the date-only format, (b) an upcoming fixture whose date hasn't arrived renders visibly dimmer than one that has, (c) the "Active matches" section shows separate date headings instead of one flat "Upcoming" list, with any still-undated matches grouped under a trailing "Date TBD" heading.

- [ ] **Step 5: Commit**

```bash
git add "app/(public)/matches/[id]/page.tsx"
git commit -m "feat: show scheduled date on Match Centre"
```

---

### Task 6: Final verification

**Files:** None (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 2: Run the production build**

Run: `npm run build`
Expected: clean build, no type errors.
