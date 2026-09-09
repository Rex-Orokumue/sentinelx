import { scoreLobbyResult, type PointsConfig } from './points-config'

export interface ConfirmRowInput {
  entrantId: string
  placement: number
  kills: number
}

export interface FrozenResultRow {
  lobby_id: string
  entrant_id: string
  placement: number
  kills: number
  placement_points: number
  kill_points: number
  status: 'confirmed'
}

// Points are written ONTO the row here and never recomputed on read. An admin
// editing a stage's points table afterwards must not silently rewrite the
// scoreboard of rounds already played.
export function frozenResultRows(
  config: PointsConfig,
  lobbyId: string,
  rows: ConfirmRowInput[],
): FrozenResultRow[] {
  return rows.map((r) => {
    const { placementPoints, killPoints } = scoreLobbyResult(config, r)
    return {
      lobby_id: lobbyId,
      entrant_id: r.entrantId,
      placement: r.placement,
      kills: r.kills,
      placement_points: placementPoints,
      kill_points: killPoints,
      status: 'confirmed' as const,
    }
  })
}

// A stage is finished only when all of its rounds have been DRAWN and all of
// their lobbies confirmed. Checking confirmations alone would complete a
// three-round stage after two, advancing players a round early.
export function stageIsComplete(
  roundsCount: number,
  lobbies: { roundNo: number; status: string }[],
): boolean {
  if (lobbies.length === 0) return false
  const rounds = new Set(lobbies.map((l) => l.roundNo))
  if (rounds.size < roundsCount) return false
  return lobbies.every((l) => l.status === 'confirmed')
}
