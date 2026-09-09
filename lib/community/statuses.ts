export interface StatusRow {
  id: string
  playerId: string
  imageUrl: string | null
  caption: string | null
  createdAt: string
  expiresAt: string
  authorName: string
  authorUsername: string | null
  authorAvatarUrl: string | null
}

export interface StatusRing {
  playerId: string
  authorName: string
  authorUsername: string | null
  authorAvatarUrl: string | null
  /** Oldest first, so playback runs forwards like every other story format. */
  statuses: StatusRow[]
  hasUnseen: boolean
  isSelf: boolean
  latestAt: string
}

// Expiry is decided here and in the query filter — never by a cleanup job.
// A status is dead the instant it expires, whether or not anything has run.
export function isLive(status: StatusRow, now: Date = new Date()): boolean {
  return new Date(status.expiresAt).getTime() > now.getTime()
}

// Turns a flat list of live statuses into one ring per author, ordered the way
// a story tray is expected to read: your own first, then anyone with something
// you haven't watched, then the rest — most recent first within each band.
export function groupIntoRings(
  statuses: StatusRow[],
  viewedStatusIds: Set<string>,
  currentUserId: string | null,
  now: Date = new Date(),
): StatusRing[] {
  const byPlayer = new Map<string, StatusRow[]>()
  for (const status of statuses) {
    if (!isLive(status, now)) continue
    const list = byPlayer.get(status.playerId) ?? []
    list.push(status)
    byPlayer.set(status.playerId, list)
  }

  const rings: StatusRing[] = []
  byPlayer.forEach((rows, playerId) => {
    const ordered = [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    const newest = ordered[ordered.length - 1]
    rings.push({
      playerId,
      authorName: newest.authorName,
      authorUsername: newest.authorUsername,
      authorAvatarUrl: newest.authorAvatarUrl,
      statuses: ordered,
      // Unseen until every status in the ring has been watched — a half-watched
      // ring still has something new in it.
      hasUnseen: ordered.some((r) => !viewedStatusIds.has(r.id)),
      isSelf: currentUserId != null && playerId === currentUserId,
      latestAt: newest.createdAt,
    })
  })

  return rings.sort((a, b) => {
    if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1
    if (a.hasUnseen !== b.hasUnseen) return a.hasUnseen ? -1 : 1
    return b.latestAt.localeCompare(a.latestAt)
  })
}
