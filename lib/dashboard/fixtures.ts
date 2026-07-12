export interface DashboardMatchInput {
  id: string
  status: string
  scheduledAt: string | null
  round: string
  opponentName: string
  opponentWhatsapp?: string | null
  tournamentTitle: string
  tournamentSlug: string
}

export interface DashboardFixture extends DashboardMatchInput {
  awaitingMyResult: boolean
}

// A match is resolved once it reaches any of these states — never "awaiting result".
// ('verified' is a match_results status, kept here defensively.)
const RESOLVED = new Set(['completed', 'verified', 'cancelled', 'disputed', 'bye'])

function awaitingMyResult(
  m: DashboardMatchInput,
  submitted: Set<string>,
  now: Date,
): boolean {
  if (RESOLVED.has(m.status)) return false
  if (submitted.has(m.id)) return false
  if (m.status === 'live') return true
  if (m.scheduledAt == null) return false
  return new Date(m.scheduledAt).getTime() <= now.getTime()
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
  const withFlag: DashboardFixture[] = matches.map((m) => ({
    ...m,
    awaitingMyResult: awaitingMyResult(m, submittedMatchIds, now),
  }))
  const live = withFlag.filter((f) => f.status === 'live')
  const upcoming = withFlag
    .filter((f) => f.status === 'scheduled')
    .sort((a, b) => ascNullsLast(a.scheduledAt, b.scheduledAt))
  const completed = withFlag
    .filter((f) => f.status !== 'live' && f.status !== 'scheduled')
    .sort((a, b) => ascNullsLast(b.scheduledAt, a.scheduledAt)) // descending, nulls last
  return { live, upcoming, completed }
}

// Normalizes a free-typed registration WhatsApp number (e.g. "0801...",
// "+234801...", "234801...", "801...") into wa.me's required international
// format (234 + subscriber number, no leading 0/+). Returns null when the
// input isn't a recognizable Nigerian number length.
export function toWhatsAppNumber(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  if (digits.startsWith('234') && digits.length === 13) return digits
  if (digits.startsWith('0') && digits.length === 11) return `234${digits.slice(1)}`
  if (digits.length === 10) return `234${digits}`
  return null
}

export function buildOpponentWhatsAppUrl(args: {
  opponentWhatsapp: string | null | undefined
  opponentName: string
  tournamentTitle: string
}): string | null {
  if (!args.opponentWhatsapp) return null
  const number = toWhatsAppNumber(args.opponentWhatsapp)
  if (!number) return null
  const text = `Hey ${args.opponentName}! We're matched for ${args.tournamentTitle} on Sentinel X — let's coordinate on timing 👋`
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`
}
