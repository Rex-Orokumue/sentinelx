export interface LeaderboardEntry {
  playerId: string
  points: number
  sxScore: number
}

export const MIN_SX_SCORE_FOR_INVITATION = 400

// Points desc, then SX Score desc so a tie at the cut-off is decided by the
// higher-rated player rather than by query order.
const byRank = (a: LeaderboardEntry, b: LeaderboardEntry) => b.points - a.points || b.sxScore - a.sxScore

// Highest points first. Skips anyone already invited (any status — pending,
// accepted, declined, or expired all count as "already tried") and anyone
// below the SX Score floor; that slot is simply skipped, not
// reassigned to nobody.
export function selectInvitees(
  leaderboard: LeaderboardEntry[],
  alreadyInvitedPlayerIds: ReadonlySet<string>,
  openSlots: number,
): string[] {
  if (openSlots <= 0) return []
  return leaderboard
    .filter(
      (e) =>
        e.sxScore >= MIN_SX_SCORE_FOR_INVITATION && !alreadyInvitedPlayerIds.has(e.playerId),
    )
    .sort(byRank)
    .slice(0, openSlots)
    .map((e) => e.playerId)
}

export interface InvitationStatusRow {
  playerId: string
  status: string
}

// Fills `openSlots` strictly by rank. A pending/accepted/declined player is
// never offered again. An expired player is skipped by default (the ordinary
// cascade treats expiry as "already tried"), but with `includeExpired` they
// compete for the slots on their current rank alongside never-invited
// players: used to recover from an invitation round nobody was notified of.
export function planInvitations(
  leaderboard: LeaderboardEntry[],
  invitations: InvitationStatusRow[],
  openSlots: number,
  opts: { includeExpired?: boolean } = {},
): { invite: string[]; reinvite: string[] } {
  if (openSlots <= 0) return { invite: [], reinvite: [] }
  const statusByPlayer = new Map(invitations.map((i) => [i.playerId, i.status]))
  const picked = leaderboard
    .filter((e) => {
      if (e.sxScore < MIN_SX_SCORE_FOR_INVITATION) return false
      const status = statusByPlayer.get(e.playerId)
      return status === undefined || (opts.includeExpired === true && status === 'expired')
    })
    .sort(byRank)
    .slice(0, openSlots)
    .map((e) => e.playerId)
  return {
    invite: picked.filter((id) => !statusByPlayer.has(id)),
    reinvite: picked.filter((id) => statusByPlayer.has(id)),
  }
}
