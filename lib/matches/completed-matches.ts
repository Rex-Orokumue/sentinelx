import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { toDateTimeLocal, formatDate } from '@/lib/format'

export interface CompletedMatchRow {
  id: string
  round: string
  groupName: string | null
  status: string
  resolution: string | null
  scoreA: number | null
  scoreB: number | null
  playerAName: string
  playerBName: string
  scheduledAt: string | null
  isFullDay: boolean
}

type ProfileRef = { display_name: string | null; username: string | null } | { display_name: string | null; username: string | null }[] | null
function nameOf(p: ProfileRef): string {
  const row = Array.isArray(p) ? p[0] ?? null : p
  return row?.display_name ?? row?.username ?? 'TBD'
}

// All played-out matches for a tournament — completed normally, walkover,
// no-show draw, or a knockout double-forfeit. Shared by the public and admin
// "Completed Matches" pages.
export async function listCompletedMatches(
  supabase: SupabaseClient<Database>,
  tournamentId: string,
): Promise<CompletedMatchRow[]> {
  const { data } = await supabase
    .from('matches')
    .select(
      'id, round, status, resolution, score_a, score_b, scheduled_at, is_full_day, ' +
        'player_a:profiles!matches_player_a_id_fkey(display_name, username), ' +
        'player_b:profiles!matches_player_b_id_fkey(display_name, username), ' +
        'groups(name)',
    )
    .eq('tournament_id', tournamentId)
    .in('status', ['completed', 'forfeited'])

  type GroupRef = { name: string } | { name: string }[] | null
  const groupName = (g: GroupRef) => (Array.isArray(g) ? g[0]?.name ?? null : g?.name ?? null)

  return ((data as unknown[] | null) ?? []).map((raw) => {
    const m = raw as {
      id: string
      round: string
      status: string
      resolution: string | null
      score_a: number | null
      score_b: number | null
      scheduled_at: string | null
      is_full_day: boolean
      player_a: ProfileRef
      player_b: ProfileRef
      groups: GroupRef
    }
    return {
      id: m.id,
      round: m.round,
      groupName: groupName(m.groups),
      status: m.status,
      resolution: m.resolution,
      scoreA: m.score_a,
      scoreB: m.score_b,
      playerAName: nameOf(m.player_a),
      playerBName: nameOf(m.player_b),
      scheduledAt: m.scheduled_at,
      isFullDay: m.is_full_day,
    }
  })
}

export interface CompletedMatchDateGroup {
  dateKey: string // 'YYYY-MM-DD' WAT, or '' for "Date TBD"
  dateLabel: string
  matches: CompletedMatchRow[]
}

// Groups by WAT calendar date, most recent first (this is a results page —
// newest results belong at the top). "Date TBD" (a completed match with no
// scheduled_at, which shouldn't normally happen but is handled defensively)
// always sorts last.
export function groupCompletedMatchesByDate(matches: CompletedMatchRow[]): CompletedMatchDateGroup[] {
  const byKey = new Map<string, CompletedMatchRow[]>()
  for (const m of matches) {
    const key = m.scheduledAt ? toDateTimeLocal(m.scheduledAt).slice(0, 10) : ''
    const group = byKey.get(key)
    if (group) group.push(m)
    else byKey.set(key, [m])
  }
  const keys = Array.from(byKey.keys()).sort((a, b) => {
    if (a === '') return b === '' ? 0 : 1
    if (b === '') return -1
    return b.localeCompare(a) // descending
  })
  return keys.map((key) => ({
    dateKey: key,
    dateLabel: key === '' ? 'Date TBD' : (formatDate(byKey.get(key)![0].scheduledAt) as string),
    matches: byKey.get(key)!,
  }))
}
