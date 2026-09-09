import { createAdminClient } from '@/lib/supabase/admin'
import type { NextLobbyData } from '@/components/dashboard/NextLobbyCard'

// The player's current lobby, if they have one — an unconfirmed lobby in a
// stage that is running, that they are an entrant of.
//
// Service-role because room-code presence is derived here and RLS keeps lobby
// credentials away from a player's own client. Only a boolean leaves this
// function; the codes themselves are read on /lobbies/[id] after membership is
// re-checked there.
export async function fetchNextLobby(userId: string): Promise<NextLobbyData | null> {
  const admin = createAdminClient()

  const { data: seats } = await admin
    .from('lobby_entrants')
    .select(
      'lobby_id, entrant_id, ' +
        'tournament_entrants!inner(player_id), ' +
        'tournament_lobbies!inner(id, round_no, label, status, room_id, scheduled_at, ' +
        'tournament_stages!inner(name, status, tournaments(title)))',
    )
    .eq('tournament_entrants.player_id', userId)
    .eq('tournament_lobbies.tournament_stages.status', 'live')
    .neq('tournament_lobbies.status', 'confirmed')
  if (!seats || seats.length === 0) return null

  type Seat = {
    lobby_id: string
    entrant_id: string
    tournament_lobbies: {
      round_no: number
      label: string
      room_id: string | null
      scheduled_at: string | null
      tournament_stages:
        | { name: string; tournaments: { title: string } | { title: string }[] | null }
        | { name: string; tournaments: { title: string } | { title: string }[] | null }[]
        | null
    }
  }

  // Soonest scheduled first; unscheduled lobbies sort last rather than
  // disappearing — a lobby with no time set is still the one they are in.
  const rows = (seats as unknown as Seat[])
    .map((s) => ({
      ...s,
      lobby: Array.isArray(s.tournament_lobbies) ? s.tournament_lobbies[0] : s.tournament_lobbies,
    }))
    .sort((a, b) => {
      const at = a.lobby?.scheduled_at ? Date.parse(a.lobby.scheduled_at) : Number.POSITIVE_INFINITY
      const bt = b.lobby?.scheduled_at ? Date.parse(b.lobby.scheduled_at) : Number.POSITIVE_INFINITY
      return at - bt
    })

  const best = rows[0]
  if (!best?.lobby) return null

  const stage = Array.isArray(best.lobby.tournament_stages)
    ? best.lobby.tournament_stages[0]
    : best.lobby.tournament_stages
  const tRef = Array.isArray(stage?.tournaments) ? stage?.tournaments[0] : stage?.tournaments

  const { count: submitted } = await admin
    .from('lobby_results')
    .select('id', { count: 'exact', head: true })
    .eq('lobby_id', best.lobby_id)
    .eq('entrant_id', best.entrant_id)

  return {
    lobbyId: best.lobby_id,
    tournamentTitle: tRef?.title ?? 'Tournament',
    stageName: stage?.name ?? 'Stage',
    roundNo: best.lobby.round_no,
    label: best.lobby.label,
    scheduledAt: best.lobby.scheduled_at,
    hasRoomCode: !!best.lobby.room_id,
    submitted: (submitted ?? 0) > 0,
  }
}
