import { knockoutRound1, roundNameForBracketSize, nextPow2 } from './draw'
import { pairWinners, matchWinnerId, roundResolved, nextRoundName } from './advancement'
import { collectAdvancers } from './results'
import { ROUND_ORDER, ROUND_LABELS, type BracketMatch } from './bracket'

export interface SlotShape {
  byeCount: number
  matchCount: number
}

export interface PairingAssignment {
  byePlayerIds: string[]
  matchPairs: [string, string][]
}

export type AssignmentCheck = { ok: true } | { ok: false; reason: string }

// Editor pre-fill for the FIRST knockout round: mirrors knockoutRound1
// (top (2^k - n) seeds get byes, the rest pair highest-vs-lowest).
export function defaultAssignmentFirstRound(orderedParticipantIds: string[]): PairingAssignment {
  const { matches, byePlayerIds } = knockoutRound1(orderedParticipantIds)
  return { byePlayerIds, matchPairs: matches }
}

// Editor pre-fill for a SUBSEQUENT knockout round: mirrors pairWinners
// (interleave the previous round's bye-winners with its match-winners, pair
// sequentially, the odd one out gets a bye).
export function defaultAssignmentNextRound(
  byeWinnerIds: string[],
  matchWinnerIds: string[],
): PairingAssignment {
  const { pairs, leftover } = pairWinners(byeWinnerIds, matchWinnerIds)
  return { byePlayerIds: leftover ? [leftover] : [], matchPairs: pairs }
}

export function shapeOf(assignment: PairingAssignment): SlotShape {
  return { byeCount: assignment.byePlayerIds.length, matchCount: assignment.matchPairs.length }
}

// Every true participant used exactly once; slot counts respected; no blanks.
export function validateAssignment(
  trueParticipantIds: string[],
  shape: SlotShape,
  assignment: PairingAssignment,
): AssignmentCheck {
  if (assignment.byePlayerIds.length !== shape.byeCount)
    return { ok: false, reason: `Expected ${shape.byeCount} bye slot(s).` }
  if (assignment.matchPairs.length !== shape.matchCount)
    return { ok: false, reason: `Expected ${shape.matchCount} match(es).` }

  const used = [...assignment.byePlayerIds, ...assignment.matchPairs.flat()]
  if (used.some((id) => !id)) return { ok: false, reason: 'Every slot must have a player.' }

  const truth = new Set(trueParticipantIds)
  for (const id of used) {
    if (!truth.has(id)) return { ok: false, reason: 'That player is not in this round.' }
  }
  if (used.length !== trueParticipantIds.length)
    return { ok: false, reason: 'Wrong number of players for this round.' }
  if (new Set(used).size !== used.length)
    return { ok: false, reason: 'A player is in more than one slot.' }

  return { ok: true }
}

// --- Pending / rearrangeable round detection ---

export interface PairingParticipant {
  id: string
  name: string
  source: string
}

export interface PendingKnockoutRound {
  round: string
  label: string
  shape: SlotShape
  participants: PairingParticipant[]
  defaultAssignment: PairingAssignment
}

interface StandingGroupInput {
  groupName: string
  rows: { playerId: string; name: string; advancing: boolean }[]
}

export interface PendingInput {
  manualPairingEnabled: boolean
  hasGroups: boolean
  groupStageComplete: boolean
  standings: StandingGroupInput[]
  knockoutRounds: { round: string; matches: BracketMatch[] }[]
}

const knockoutIndex = (round: string) => ROUND_ORDER.indexOf(round as (typeof ROUND_ORDER)[number])

type AdvanceLike = {
  status: string
  score_a: number | null
  score_b: number | null
  player_a_id: string | null
  player_b_id: string | null
}
function toAdvance(matches: BracketMatch[]): AdvanceLike[] {
  return matches.map((m) => ({
    status: m.status,
    score_a: m.score_a,
    score_b: m.score_b,
    player_a_id: m.playerA.id || null,
    player_b_id: m.playerB.id || null,
  }))
}
function winnerOf(m: BracketMatch): string | null {
  return matchWinnerId({
    status: m.status,
    score_a: m.score_a,
    score_b: m.score_b,
    player_a_id: m.playerA.id || null,
    player_b_id: m.playerB.id || null,
  })
}

// The advancing knockout round that still needs to be created, or null.
export function computePendingKnockoutRound(input: PendingInput): PendingKnockoutRound | null {
  if (!input.manualPairingEnabled) return null

  const existing = new Set(input.knockoutRounds.map((r) => r.round))

  // First knockout round: group stage done, no knockout rounds yet.
  if (input.hasGroups && input.knockoutRounds.length === 0) {
    if (!input.groupStageComplete) return null
    const nameById = new Map<string, string>()
    for (const g of input.standings) for (const r of g.rows) nameById.set(r.playerId, r.name)
    const advancerIds = collectAdvancers(
      input.standings.map((g) =>
        g.rows.map((r) => ({ playerId: r.playerId, advancing: r.advancing })),
      ),
    )
    if (advancerIds.length < 2) return null
    const round = roundNameForBracketSize(nextPow2(advancerIds.length))
    const def = defaultAssignmentFirstRound(advancerIds)
    return {
      round,
      label: ROUND_LABELS[round] ?? round,
      shape: shapeOf(def),
      participants: advancerIds.map((id, i) => ({
        id,
        name: nameById.get(id) ?? 'Player',
        source: i < input.standings.length ? 'Group winner' : 'Group runner-up',
      })),
      defaultAssignment: def,
    }
  }

  // Subsequent round: the most advanced resolved round whose successor exists in
  // ROUND_ORDER and has not been created yet.
  const resolvedRounds = input.knockoutRounds
    .filter((r) => knockoutIndex(r.round) !== -1 && roundResolved(toAdvance(r.matches)))
    .sort((a, b) => knockoutIndex(b.round) - knockoutIndex(a.round))

  for (const r of resolvedRounds) {
    const next = nextRoundName(r.round)
    if (!next || existing.has(next)) continue
    const byeWinners = r.matches
      .filter((m) => m.status === 'bye')
      .map((m) => m.playerA.id)
      .filter(Boolean)
    const matchWinners = r.matches
      .filter((m) => m.status === 'completed')
      .map((m) => winnerOf(m))
      .filter((x): x is string => !!x)
    const nameById = new Map<string, string>()
    for (const m of r.matches) {
      if (m.playerA.id) nameById.set(m.playerA.id, m.playerA.name)
      if (m.playerB.id) nameById.set(m.playerB.id, m.playerB.name)
    }
    const participantIds = [...byeWinners, ...matchWinners]
    if (participantIds.length < 2) return null
    const def = defaultAssignmentNextRound(byeWinners, matchWinners)
    return {
      round: next,
      label: ROUND_LABELS[next] ?? next,
      shape: shapeOf(def),
      participants: participantIds.map((id) => ({
        id,
        name: nameById.get(id) ?? 'Player',
        source: byeWinners.includes(id) ? 'Bye' : 'Round winner',
      })),
      defaultAssignment: def,
    }
  }
  return null
}

export interface RearrangeableKnockoutRound {
  round: string
  label: string
  shape: SlotShape
  participants: PairingParticipant[]
  currentAssignment: PairingAssignment
  matchIdByPairIndex: string[]
  byeMatchIdByIndex: string[]
}

export interface RearrangeInput {
  knockoutRounds: { round: string; matches: BracketMatch[] }[]
}

// The most advanced knockout round whose matches are ALL still unplayed
// (scheduled or bye, no score) — safe to re-pair in place.
export function computeRearrangeableKnockoutRound(
  input: RearrangeInput,
): RearrangeableKnockoutRound | null {
  const r = input.knockoutRounds
    .filter((x) => knockoutIndex(x.round) !== -1 && x.matches.length > 0)
    .filter((x) =>
      x.matches.every(
        (m) =>
          (m.status === 'scheduled' || m.status === 'bye') &&
          m.score_a == null &&
          m.score_b == null,
      ),
    )
    .sort((a, b) => knockoutIndex(b.round) - knockoutIndex(a.round))[0]
  if (!r) return null

  const pairMatches = r.matches.filter((m) => m.status === 'scheduled')
  const byeMatches = r.matches.filter((m) => m.status === 'bye')
  const nameById = new Map<string, string>()
  for (const m of r.matches) {
    if (m.playerA.id) nameById.set(m.playerA.id, m.playerA.name)
    if (m.playerB.id) nameById.set(m.playerB.id, m.playerB.name)
  }
  const currentAssignment: PairingAssignment = {
    byePlayerIds: byeMatches.map((m) => m.playerA.id),
    matchPairs: pairMatches.map((m) => [m.playerA.id, m.playerB.id] as [string, string]),
  }
  const participantIds = [...currentAssignment.byePlayerIds, ...currentAssignment.matchPairs.flat()]
  return {
    round: r.round,
    label: ROUND_LABELS[r.round] ?? r.round,
    shape: shapeOf(currentAssignment),
    participants: participantIds.map((id) => ({
      id,
      name: nameById.get(id) ?? 'Player',
      source: currentAssignment.byePlayerIds.includes(id) ? 'Bye' : 'Player',
    })),
    currentAssignment,
    matchIdByPairIndex: pairMatches.map((m) => m.id),
    byeMatchIdByIndex: byeMatches.map((m) => m.id),
  }
}
