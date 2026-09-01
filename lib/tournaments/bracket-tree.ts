import type { BracketMatch } from './bracket'
import { ROUND_LABELS } from './bracket'
import { nextPow2, roundNameForBracketSize } from './draw'

export interface ProjectedRound {
  round: string
  label: string
  matchCount: number
}

export interface DisplayRound {
  round: string
  label: string
  // Slots grouped by the next-round slot they feed. `null` is a slot that
  // exists on the chart but has no match yet — either the round hasn't been
  // generated, or the player who fills it arrived via a bye.
  groups: (BracketMatch | null)[][]
}

// The full knockout shape a tournament will end up with, derived from how many
// players qualify. Knockout rows are only created a round at a time, as each
// previous round finishes, so without this the bracket is invisible until the
// group stage ends — the chart should be up from the start with empty slots
// that fill in as players advance.
export function projectBracketRounds(advancerCount: number): ProjectedRound[] {
  if (advancerCount < 2) return []
  const rounds: ProjectedRound[] = []
  for (let size = nextPow2(advancerCount); size >= 2; size /= 2) {
    const round = roundNameForBracketSize(size)
    rounds.push({ round, label: ROUND_LABELS[round] ?? round, matchCount: size / 2 })
  }
  return rounds
}

// Merges the rounds that actually exist into the projected shape, so the chart
// always shows every round through to the final.
//
// `matches` has no next_match_id column — advancement pairs winners at
// generation time and stores nothing about the resulting tree — so wherever the
// following round exists, topology is recovered from the players themselves: a
// round's winners are the next round's participants, so whichever match a
// next-round player came out of is that slot's feeder. Rounds whose successor
// hasn't been generated yet fall back to pairing in order, and self-correct to
// the true pairing once that successor appears.
export function buildBracketDisplay(
  actualRounds: { round: string; label: string; matches: BracketMatch[] }[],
  projected: ProjectedRound[],
  // The bronze match: built from the two semifinal losers, feeding nothing —
  // it doesn't fit the winners-advance topology above, so it isn't part of
  // that pairing at all. It's a sibling of the Final, not a successor, so it
  // rides along as one more slot in the Final's column once it exists.
  thirdPlace?: BracketMatch | null,
): DisplayRound[] {
  const shape: ProjectedRound[] =
    projected.length > 0
      ? projected
      : actualRounds.map((r) => ({ round: r.round, label: r.label, matchCount: r.matches.length }))
  if (shape.length === 0) return []

  const actualByRound = new Map(actualRounds.map((r) => [r.round, r.matches]))

  const lastShape = shape[shape.length - 1]
  const lastMatches = actualByRound.get(lastShape.round) ?? []
  const display: DisplayRound[] = [
    {
      round: lastShape.round,
      label: lastShape.label,
      groups: Array.from({ length: lastShape.matchCount }, (_, i) => [lastMatches[i] ?? null]),
    },
  ]

  for (let i = shape.length - 2; i >= 0; i--) {
    const s = shape[i]
    const matches = actualByRound.get(s.round) ?? []
    const consumers = display[0].groups.flat()

    const byPlayer = new Map<string, BracketMatch>()
    for (const m of matches) {
      if (m.playerA.id) byPlayer.set(m.playerA.id, m)
      if (m.playerB.id) byPlayer.set(m.playerB.id, m)
    }

    const claimed = new Set<string>()
    const groups: (BracketMatch | null)[][] = consumers.map((consumer) => {
      const group: (BracketMatch | null)[] = []
      if (!consumer) return group
      for (const playerId of [consumer.playerA.id, consumer.playerB.id]) {
        if (!playerId) continue
        const feeder = byPlayer.get(playerId)
        if (feeder && !claimed.has(feeder.id)) {
          claimed.add(feeder.id)
          group.push(feeder)
        }
      }
      return group
    })

    // Whatever the players didn't account for: this round exists but the next
    // one doesn't yet, or a match produced no advancer (double forfeit).
    const leftovers = matches.filter((m) => !claimed.has(m.id))
    let next = 0
    for (const group of groups) {
      while (group.length < 2 && next < leftovers.length) group.push(leftovers[next++])
      while (group.length < 2) group.push(null)
    }
    for (; next < leftovers.length; next += 2) {
      groups.push([leftovers[next], leftovers[next + 1] ?? null])
    }

    display.unshift({ round: s.round, label: s.label, groups })
  }

  if (thirdPlace && display[display.length - 1].round === 'final') {
    display[display.length - 1].groups.push([thirdPlace])
  }

  return display
}
