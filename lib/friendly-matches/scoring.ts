import { MATCH_COMPLETED_DELTA, WIN_DELTA } from '@/lib/scoring/events'

export interface FriendlyMatchInput {
  id: string
  challengerId: string
  opponentId: string
  scoreChallenger: number | null
  scoreOpponent: number | null
  winnerId: string | null
}

export interface NewFriendlyEvent {
  player_id: string
  match_id: null
  event_type: 'match_completed' | 'win_no_dispute'
  points_delta: number
  note: string
}

// Staked friendlies reuse the SAME event_type vocabulary and point values as
// tournament matches (lib/scoring/events.ts), for consistency — but this is a
// one-time insert, NOT the syncMatchEvents regeneration engine (that's
// matches-table-specific; a disputed staked friendly is resolved manually by
// admin, not automatically recomputed). match_id is null since these aren't
// tournament matches; the friendly match's id is recorded in `note` instead.
export function friendlyMatchEventsFor(match: FriendlyMatchInput): NewFriendlyEvent[] {
  const note = `Staked friendly match ${match.id}`
  const events: NewFriendlyEvent[] = [
    { player_id: match.challengerId, match_id: null, event_type: 'match_completed', points_delta: MATCH_COMPLETED_DELTA, note },
    { player_id: match.opponentId, match_id: null, event_type: 'match_completed', points_delta: MATCH_COMPLETED_DELTA, note },
  ]
  if (match.winnerId) {
    events.push({ player_id: match.winnerId, match_id: null, event_type: 'win_no_dispute', points_delta: WIN_DELTA, note })
  }
  return events
}
