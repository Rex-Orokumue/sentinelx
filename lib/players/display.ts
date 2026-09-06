export const DELETED_PLAYER_NAME = 'Deleted player'

export type ProfileRef = {
  username: string | null
  display_name: string | null
  deleted_at: string | null
} | null

export function isDeleted(p: ProfileRef): boolean {
  return p?.deleted_at != null
}

// The deleted check runs before any identity field is read, so an anonymised
// row can never leak its 'deleted_<id>' placeholder into the UI — nor any
// stale value an incomplete anonymisation left behind.
export function displayNameFor(p: ProfileRef): string {
  if (p == null) return 'Player'
  if (isDeleted(p)) return DELETED_PLAYER_NAME
  return p.display_name ?? p.username ?? 'Player'
}

// null means "render as plain text, not a link": /players/[username] returns
// notFound() for a retired handle, so a link would be a dead end.
export function profileHrefFor(p: ProfileRef): string | null {
  if (p == null || isDeleted(p) || p.username == null) return null
  return `/players/${p.username}`
}
