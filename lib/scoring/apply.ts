import { createAdminClient } from '@/lib/supabase/admin'
import { getChampion, type BracketMatch } from '@/lib/tournaments/bracket'
import { AUTO_MATCH_EVENT_TYPES, matchEventsFor } from './events'
import { computeAggregates, type CompletedMatch } from './stats'
import { computeScore } from './score'

type Admin = ReturnType<typeof createAdminClient>

interface MatchRow {
  id: string
  player_a_id: string | null
  player_b_id: string | null
  score_a: number | null
  score_b: number | null
  status: string
}

const MATCH_COLS = 'id, player_a_id, player_b_id, score_a, score_b, status'

// Reuse getChampion's winner rule by shaping a raw final row into a BracketMatch.
// Only ids are compared, so names are irrelevant.
function toBracketFinal(m: {
  round: string
  status: string
  score_a: number | null
  score_b: number | null
  player_a_id: string | null
  player_b_id: string | null
}): BracketMatch {
  return {
    id: '',
    round: m.round,
    group_id: null,
    groupName: null,
    status: m.status,
    score_a: m.score_a,
    score_b: m.score_b,
    scheduled_at: null,
    playerA: { id: m.player_a_id ?? '', name: '' },
    playerB: { id: m.player_b_id ?? '', name: '' },
  }
}

// Delete this match's AUTO events (only) and reinsert from the current result.
// Returns the ids of players whose scoring is affected. No refresh here.
async function regenerateMatchEvents(admin: Admin, match: MatchRow): Promise<string[]> {
  await admin
    .from('sentinel_score_events')
    .delete()
    .eq('match_id', match.id)
    .in('event_type', [...AUTO_MATCH_EVENT_TYPES])
  const events = matchEventsFor(match)
  if (events.length > 0) await admin.from('sentinel_score_events').insert(events)
  return [match.player_a_id, match.player_b_id].filter((x): x is string => !!x)
}

// Recompute aggregates + score for one player and write both caches to profiles.
async function refreshPlayer(admin: Admin, playerId: string): Promise<void> {
  const { data: rawMatches } = await admin
    .from('matches')
    .select('player_a_id, player_b_id, score_a, score_b, round, status')
    .eq('status', 'completed')
    .or(`player_a_id.eq.${playerId},player_b_id.eq.${playerId}`)
  const rows = rawMatches ?? []

  const completed: CompletedMatch[] = rows
    .filter((m) => m.player_a_id && m.player_b_id && m.score_a != null && m.score_b != null)
    .map((m) => ({
      player_a_id: m.player_a_id as string,
      player_b_id: m.player_b_id as string,
      score_a: m.score_a as number,
      score_b: m.score_b as number,
    }))

  const titlesWon = rows
    .filter((m) => m.round === 'final')
    .map((m) => getChampion([toBracketFinal(m)]))
    .filter((champ) => champ?.id === playerId).length

  const aggregates = computeAggregates(playerId, completed, titlesWon)

  const { data: events } = await admin
    .from('sentinel_score_events')
    .select('points_delta')
    .eq('player_id', playerId)
  const sentinel_score = computeScore(events ?? [])

  await admin
    .from('profiles')
    .update({ ...aggregates, sentinel_score })
    .eq('id', playerId)
}

// Confirm/dispute hook: regenerate one match's events, then refresh both players.
// Works symmetrically for disputes — a non-completed match reinserts no events,
// so both players' totals drop.
export async function syncMatchEvents(admin: Admin, matchId: string): Promise<void> {
  const { data: match } = await admin
    .from('matches')
    .select(MATCH_COLS)
    .eq('id', matchId)
    .maybeSingle()
  if (!match) return
  const affected = await regenerateMatchEvents(admin, match)
  for (const pid of affected) await refreshPlayer(admin, pid)
}

// Full rebuild — the admin recompute button and the recover-from-bug path.
// Wipes all AUTO events (authored events preserved), regenerates from every
// completed match, then refreshes every profile.
export async function recomputeAllScoring(admin: Admin): Promise<{ players: number }> {
  await admin
    .from('sentinel_score_events')
    .delete()
    .in('event_type', [...AUTO_MATCH_EVENT_TYPES])

  const { data: matches } = await admin
    .from('matches')
    .select(MATCH_COLS)
    .eq('status', 'completed')
  for (const m of matches ?? []) {
    const events = matchEventsFor(m)
    if (events.length > 0) await admin.from('sentinel_score_events').insert(events)
  }

  const { data: profiles } = await admin.from('profiles').select('id')
  for (const p of profiles ?? []) await refreshPlayer(admin, p.id)
  return { players: (profiles ?? []).length }
}
