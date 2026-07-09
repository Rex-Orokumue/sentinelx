// The only event types this engine generates automatically from a match result.
// Used as the delete/regenerate discriminator so authored events (ratings, flags,
// disputes) are never touched — even when they carry the same match_id.
export const AUTO_MATCH_EVENT_TYPES = ['match_completed', 'win_no_dispute'] as const
export type AutoMatchEventType = (typeof AUTO_MATCH_EVENT_TYPES)[number]

export const MATCH_COMPLETED_DELTA = 2
export const WIN_DELTA = 1

export interface NewMatchEvent {
  player_id: string
  match_id: string
  event_type: AutoMatchEventType
  points_delta: number
  note: null
}

interface MatchInput {
  id: string
  player_a_id: string | null
  player_b_id: string | null
  score_a: number | null
  score_b: number | null
  status: string
}

export function matchEventsFor(match: MatchInput): NewMatchEvent[] {
  if (match.status !== 'completed') return []
  const { id, player_a_id, player_b_id, score_a, score_b } = match
  // A completed match must have both players and both scores; a bye never does.
  if (!player_a_id || !player_b_id || score_a == null || score_b == null) return []

  const events: NewMatchEvent[] = [completedEvent(player_a_id, id), completedEvent(player_b_id, id)]

  if (score_a !== score_b) {
    const winnerId = score_a > score_b ? player_a_id : player_b_id
    events.push({
      player_id: winnerId,
      match_id: id,
      event_type: 'win_no_dispute',
      points_delta: WIN_DELTA,
      note: null,
    })
  }
  return events
}

function completedEvent(playerId: string, matchId: string): NewMatchEvent {
  return {
    player_id: playerId,
    match_id: matchId,
    event_type: 'match_completed',
    points_delta: MATCH_COMPLETED_DELTA,
    note: null,
  }
}
