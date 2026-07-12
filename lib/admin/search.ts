export interface SearchablePlayer {
  username: string | null
  displayName: string | null
  clubName?: string | null
}

// Case-insensitive substring match against username, display name, and club
// name. A blank/whitespace-only query matches everything (no filter applied).
export function matchesPlayerQuery(item: SearchablePlayer, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [item.username, item.displayName, item.clubName].some(
    (field) => field != null && field.toLowerCase().includes(q),
  )
}
