export interface LeaderboardEntry {
  playerId: string
  points: number
  sxScore: number
}

export const MIN_SX_SCORE_FOR_INVITATION = 400

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
    .sort((a, b) => b.points - a.points)
    .slice(0, openSlots)
    .map((e) => e.playerId)
}
