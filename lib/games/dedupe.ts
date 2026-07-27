export interface DedupableGame {
  name: string
  slug: string
  icon_url: string | null
  active: boolean
  created_at: string
}

// One row per distinct name: prefer an active row if any exists for that name,
// otherwise the most recently created row. Duplicate rows are leftover QA data
// (same game, different slugs) — picking the active one keeps the link that
// actually has real tournaments; picking most-recent among inactive duplicates
// avoids surfacing a stale abandoned row.
export function dedupeGamesByName(games: DedupableGame[]): DedupableGame[] {
  const byName = new Map<string, DedupableGame>()
  for (const g of games) {
    const existing = byName.get(g.name)
    if (!existing) {
      byName.set(g.name, g)
      continue
    }
    const gScore = g.active ? 1 : 0
    const existingScore = existing.active ? 1 : 0
    if (gScore > existingScore || (gScore === existingScore && g.created_at > existing.created_at)) {
      byName.set(g.name, g)
    }
  }
  return Array.from(byName.values())
}
