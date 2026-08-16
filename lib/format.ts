// Single source of truth for naira display. ₦ + Nigerian digit grouping.
export function formatNaira(n: number): string {
  return `₦${n.toLocaleString('en-NG')}`
}

// Abbreviated form ("24.5K", "1M") for tight spaces — the header balance
// chips need this below the `sm:` breakpoint, where the header has no room
// for a fully grouped number next to the logo, notification bell, and
// hamburger button.
export function formatCompactNumber(n: number): string {
  return new Intl.NumberFormat('en-NG', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

// ₦ + the compact form — same use case as formatCompactNumber, naira-specific.
export function formatNairaCompact(n: number): string {
  return `₦${formatCompactNumber(n)}`
}

// ---------------------------------------------------------------------------
// Dates & times — always rendered in West Africa Time (WAT).
//
// Sentinel X is a Nigeria-based product; every wall-clock time users read or
// enter is WAT. Nigeria observes no daylight saving, so WAT is UTC+1 all year.
// Timestamps are stored in Supabase as UTC instants (timestamptz); these
// helpers are the single boundary that converts between the WAT wall clock and
// those instants, so nothing renders in the server's timezone (UTC on Vercel).
// ---------------------------------------------------------------------------

const TZ = 'Africa/Lagos'
const WAT_OFFSET = '+01:00'

function toDate(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

/** "8 Jul, 20:00" — date + 24h time in WAT. Returns null for missing/invalid input. */
export function formatDateTime(iso: string | null | undefined): string | null {
  const d = toDate(iso)
  if (!d) return null
  return d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TZ,
  })
}

/** "8 Jul 2026" — date in WAT. Returns null for missing/invalid input. */
export function formatDate(iso: string | null | undefined): string | null {
  const d = toDate(iso)
  if (!d) return null
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: TZ,
  })
}

/** "Jul 2026" — month + year in WAT. Returns null for missing/invalid input. */
export function formatMonthYear(iso: string | null | undefined): string | null {
  const d = toDate(iso)
  if (!d) return null
  return d.toLocaleDateString('en-GB', {
    month: 'short',
    year: 'numeric',
    timeZone: TZ,
  })
}

/**
 * UTC instant → "YYYY-MM-DDTHH:mm" WAT wall clock, for a
 * `<input type="datetime-local">` value. Returns '' for missing/invalid input.
 */
export function toDateTimeLocal(iso: string | null | undefined): string {
  const d = toDate(iso)
  if (!d) return ''
  // sv-SE yields an ISO-like "2026-07-08 20:00"; anchor to WAT then reshape.
  const s = d.toLocaleString('sv-SE', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return s.replace(' ', 'T').slice(0, 16)
}

/**
 * "YYYY-MM-DDTHH:mm" WAT wall clock (from a datetime-local input) → UTC ISO
 * instant, for storage. Returns null for empty/invalid input.
 */
export function fromDateTimeLocal(value: string | null | undefined): string | null {
  if (!value) return null
  const d = new Date(`${value.slice(0, 16)}:00${WAT_OFFSET}`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/**
 * "YYYY-MM-DD" (from an `<input type="date">`) → UTC ISO instant for
 * midnight WAT that date, for storage. Returns null for empty/invalid input.
 */
export function fromDateLocal(value: string | null | undefined): string | null {
  if (!value) return null
  const d = new Date(`${value}T00:00:00${WAT_OFFSET}`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** Today's date in WAT as "YYYY-MM-DD", for defaulting a date input. */
export function todayDateLocal(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: TZ })
}

/**
 * "2h ago" / "Just now" / "3d ago" — for feed-style timestamps (community
 * posts, comments). Falls back to `formatDate` past 7 days, where a relative
 * count stops being useful. Returns null for missing/invalid input.
 */
export function formatRelativeTime(iso: string | null | undefined): string | null {
  const d = toDate(iso)
  if (!d) return null
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000)
  if (seconds < 60) return 'Just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return formatDate(iso)
}

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
