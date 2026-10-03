export interface RawGameInterestRow {
  user_id: string
  profiles: {
    id: string
    username: string | null
    display_name: string | null
    country: string | null
    whatsapp_number: string | null
    consent_whatsapp_updates: boolean
  }
  games: { name: string }
}

export interface SegmentPlayer {
  id: string
  name: string
  country: string | null
  whatsappNumber: string | null
  games: string
}

// One row per distinct player, combining every game they matched the filter
// on into a single comma-joined label — same in-memory-group-after-join
// approach lib/admin/search.ts's matchesPlayerQuery neighbors use elsewhere
// in this codebase rather than a DB-side aggregate.
export function groupGameInterestRows(rows: RawGameInterestRow[]): SegmentPlayer[] {
  const byId = new Map<string, SegmentPlayer>()
  for (const row of rows) {
    const existing = byId.get(row.user_id)
    if (existing) {
      existing.games = `${existing.games}, ${row.games.name}`
      continue
    }
    byId.set(row.user_id, {
      id: row.profiles.id,
      name: row.profiles.display_name ?? row.profiles.username ?? row.profiles.id,
      country: row.profiles.country,
      whatsappNumber: row.profiles.whatsapp_number,
      games: row.games.name,
    })
  }
  return Array.from(byId.values())
}

export function buildContactNumbers(players: SegmentPlayer[]): string[] {
  return players.map((p) => p.whatsappNumber).filter((n): n is string => !!n)
}

// A bare E.164 number legitimately starts with '+', so it is exempt from the
// formula guard below.
const PHONE_NUMBER = /^\+\d+$/

// Names and countries are typed by players. A leading = + - @ (or tab/CR) makes
// Excel and Sheets run the cell as a formula when an admin opens the export, so
// those get a leading apostrophe.
function csvField(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) && !PHONE_NUMBER.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded
}

export function buildContactCsv(players: SegmentPlayer[]): string {
  const header = 'name,country,whatsapp_number,game_interests'
  const rows = players.map((p) =>
    [csvField(p.name), csvField(p.country ?? ''), csvField(p.whatsappNumber ?? ''), csvField(p.games)].join(','),
  )
  return [header, ...rows].join('\n') + '\n'
}
