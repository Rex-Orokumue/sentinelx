// The only event types this engine generates automatically from a match result.
// Used as the delete/regenerate discriminator so authored events (ratings, flags,
// disputes) are never touched — even when they carry the same match_id.
export const AUTO_MATCH_EVENT_TYPES = ['match_completed', 'win_no_dispute', 'no_show'] as const
export type AutoMatchEventType = (typeof AUTO_MATCH_EVENT_TYPES)[number]

export const MATCH_COMPLETED_DELTA = 10
export const WIN_DELTA = 90
export const NO_SHOW_DELTA = -100

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
  resolution: string | null
}

export function matchEventsFor(match: MatchInput): NewMatchEvent[] {
  const { id, player_a_id, player_b_id, score_a, score_b, status, resolution } = match

  // Knockout double-forfeit: both players no-showed, no score, both penalized.
  if (status === 'forfeited') {
    if (!player_a_id || !player_b_id) return []
    return [noShowEvent(player_a_id, id), noShowEvent(player_b_id, id)]
  }

  if (status !== 'completed') return []
  // A completed match must have both players and both scores; a bye never does.
  if (!player_a_id || !player_b_id || score_a == null || score_b == null) return []

  // Single no-show, admin-declared winner: the loser was penalized, not credited.
  if (resolution === 'walkover') {
    if (score_a === score_b) return []
    const winnerId = score_a > score_b ? player_a_id : player_b_id
    const loserId = score_a > score_b ? player_b_id : player_a_id
    return [completedEvent(winnerId, id), noShowEvent(loserId, id)]
  }

  // Group double-no-show: recorded as a 0-0 draw for standings, but both
  // players are penalized for not showing up, not credited for completing.
  if (resolution === 'no_show_draw') {
    return [noShowEvent(player_a_id, id), noShowEvent(player_b_id, id)]
  }

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

function noShowEvent(playerId: string, matchId: string): NewMatchEvent {
  return {
    player_id: playerId,
    match_id: matchId,
    event_type: 'no_show',
    points_delta: NO_SHOW_DELTA,
    note: null,
  }
}

interface TeamMatchInput {
  id: string
  team_a_id: string | null
  team_b_id: string | null
  score_a: number | null
  score_b: number | null
  status: string
  resolution: string | null
}

// Team-vs-team sibling of matchEventsFor (spec §7.4). Solo matches never
// reach here — regenerateMatchEvents (lib/scoring/apply.ts) branches on
// team_a_id/team_b_id before choosing which of the two to call. The one rule
// this function adds beyond matchEventsFor's shape: for a match that
// completed normally (no walkover/no_show_draw resolution), a roster member
// is credited only if they personally checked in — their team can win 3
// rounds to 4 while one teammate who never showed up is individually
// no-showed, not carried along on the team's result.
export function teamMatchEventsFor(
  match: TeamMatchInput,
  rosterA: string[],
  rosterB: string[],
  checkedInPlayerIds: Set<string>,
): NewMatchEvent[] {
  const { id, team_a_id, team_b_id, score_a, score_b, status, resolution } = match

  // Whole-team double no-show: identical to matchEventsFor's forfeited
  // branch, applied to every roster member on both sides.
  if (status === 'forfeited') {
    if (!team_a_id || !team_b_id) return []
    return [...rosterA, ...rosterB].map((pid) => noShowEvent(pid, id))
  }

  if (status !== 'completed') return []
  if (!team_a_id || !team_b_id || score_a == null || score_b == null) return []

  // Single-side no-show, admin-declared: every present-side member credited,
  // every absent-side member penalized — matchEventsFor's walkover branch,
  // applied per roster member.
  if (resolution === 'walkover') {
    if (score_a === score_b) return []
    const winningRoster = score_a > score_b ? rosterA : rosterB
    const losingRoster = score_a > score_b ? rosterB : rosterA
    return [...winningRoster.map((pid) => completedEvent(pid, id)), ...losingRoster.map((pid) => noShowEvent(pid, id))]
  }

  // Mutual no-show (group stage only): both rosters penalized, matching
  // matchEventsFor's no_show_draw branch.
  if (resolution === 'no_show_draw') {
    return [...rosterA, ...rosterB].map((pid) => noShowEvent(pid, id))
  }

  // Normal completion — the new per-player rule (spec §7.4): a checked-in
  // roster member is credited (plus the win bonus if their side won and the
  // scores differ); one who never checked in is no-showed individually, even
  // though their team's match proceeded and completed normally.
  const winningRoster = score_a === score_b ? null : score_a > score_b ? rosterA : rosterB
  const events: NewMatchEvent[] = []
  for (const pid of [...rosterA, ...rosterB]) {
    if (checkedInPlayerIds.has(pid)) {
      events.push(completedEvent(pid, id))
      if (winningRoster?.includes(pid)) {
        events.push({ player_id: pid, match_id: id, event_type: 'win_no_dispute', points_delta: WIN_DELTA, note: null })
      }
    } else {
      events.push(noShowEvent(pid, id))
    }
  }
  return events
}
