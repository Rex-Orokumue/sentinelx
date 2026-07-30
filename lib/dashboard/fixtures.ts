import { toDateTimeLocal, formatDate } from '@/lib/format'
import { toWhatsAppNumber } from '@/lib/phone/number'

export interface DashboardMatchInput {
  id: string
  status: string
  scheduledAt: string | null
  isFullDay: boolean
  round: string
  opponentName: string
  opponentWhatsapp?: string | null
  // `profiles.country` for the opponent, so a non-Nigerian number in national
  // format parses against its own numbering plan.
  opponentCountry?: string | null
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

export function buildOpponentWhatsAppUrl(args: {
  opponentWhatsapp: string | null | undefined
  opponentName: string
  tournamentTitle: string
  // The opponent's `profiles.country`, so a non-Nigerian number in national
  // format parses against its own numbering plan. See lib/phone/number.ts.
  opponentCountry?: string | null
}): string | null {
  const number = toWhatsAppNumber(args.opponentWhatsapp, { country: args.opponentCountry })
  if (!number) return null
  const text = `Hey ${args.opponentName}! We're matched for ${args.tournamentTitle} on Sentinel X — let's coordinate on timing 👋`
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`
}
