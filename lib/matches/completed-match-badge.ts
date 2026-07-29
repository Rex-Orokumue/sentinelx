// Label shown next to a completed match when it wasn't a normally-played
// result — null means no badge (a normally confirmed match).
export function completedMatchBadge(status: string, resolution: string | null): string | null {
  if (status === 'forfeited') return 'FORFEITED'
  if (resolution === 'walkover') return 'WALKOVER'
  if (resolution === 'no_show_draw') return 'NO-SHOW DRAW'
  return null
}
