export interface FriendshipRow {
  requesterId: string
  recipientId: string
  status: string
}

export function isFriendsWith(rows: FriendshipRow[], playerId: string, otherId: string): boolean {
  return rows.some(
    (r) =>
      r.status === 'accepted' &&
      ((r.requesterId === playerId && r.recipientId === otherId) ||
        (r.requesterId === otherId && r.recipientId === playerId)),
  )
}

// Stable partition: friends first (in their original relative order), then
// everyone else (in their original relative order).
export function sortFriendsFirst<T extends { id: string }>(players: T[], friendIds: Set<string>): T[] {
  const friends = players.filter((p) => friendIds.has(p.id))
  const others = players.filter((p) => !friendIds.has(p.id))
  return [...friends, ...others]
}
