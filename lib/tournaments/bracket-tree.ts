import type { BracketMatch } from './bracket'

export interface TreeRound {
  round: string
  label: string
  // Matches grouped by the next-round match they feed into. Group N of a round
  // sits directly opposite match N of the following round, which is what lets
  // the tree draw connectors with plain CSS instead of measured coordinates.
  // A group holds two feeders normally, one when the opponent arrived via a bye
  // in an earlier round, and none when neither feeder is in this round.
  groups: BracketMatch[][]
}

// `matches` has no next_match_id column — advancement pairs winners at
// generation time (lib/tournaments/advancement.ts) and stores nothing about the
// resulting tree. So the topology is recovered from the players themselves: a
// round's winners are literally the next round's participants, so whichever
// match a next-round player came out of is that slot's feeder.
//
// Rounds are consumed last-to-first because the final is the only round whose
// order is unambiguous; every earlier round is then ordered to line up with the
// round it feeds.
export function buildBracketTree(
  rounds: { round: string; label: string; matches: BracketMatch[] }[],
): TreeRound[] {
  if (rounds.length === 0) return []

  const last = rounds[rounds.length - 1]
  const tree: TreeRound[] = [
    { round: last.round, label: last.label, groups: last.matches.map((m) => [m]) },
  ]

  for (let i = rounds.length - 2; i >= 0; i--) {
    const current = rounds[i]
    const consumers = tree[0].groups.flat()

    const byPlayer = new Map<string, BracketMatch>()
    for (const m of current.matches) {
      if (m.playerA.id) byPlayer.set(m.playerA.id, m)
      if (m.playerB.id) byPlayer.set(m.playerB.id, m)
    }

    const claimed = new Set<string>()
    const groups: BracketMatch[][] = consumers.map((consumer) => {
      const group: BracketMatch[] = []
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

    // A match nobody advanced out of — a knockout double-forfeit, or a round
    // whose next round hasn't been generated yet — still belongs on the tree.
    for (const m of current.matches) {
      if (!claimed.has(m.id)) groups.push([m])
    }

    tree.unshift({ round: current.round, label: current.label, groups })
  }

  return tree
}
