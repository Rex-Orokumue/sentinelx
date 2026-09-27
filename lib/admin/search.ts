export interface SearchablePlayer {
  username: string | null
  displayName: string | null
  registrationDetails?: Record<string, string> | null
}

// Case-insensitive substring match against username, display name, and every
// value in registrationDetails (club name, in-game UID, whatever the
// player's game asks for). A blank/whitespace-only query matches everything.
export function matchesPlayerQuery(item: SearchablePlayer, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const values = [item.username, item.displayName, ...Object.values(item.registrationDetails ?? {})]
  return values.some((field) => field != null && field.toLowerCase().includes(q))
}
