// Contradiction checks for the admin's lobby grid.
//
// These FLAG, never fix. The project rule is that automation may detect and
// surface, but only an admin takes the resolving action — a system that
// silently "corrected" two players both claiming first place would be deciding
// a disputed result on its own.
//
// Every problem is reported at once, not first-error-only: the admin fixes the
// grid in a single pass, and revealing one error at a time turns one correction
// into several round trips.

export type LobbyFlagCode =
  | 'duplicate_placement'
  | 'placement_out_of_range'
  | 'impossible_kills'
  | 'missing_submission'

export interface LobbyFlag {
  code: LobbyFlagCode
  message: string
  entrantIds: string[]
}

export function validateLobbyResults(input: {
  entrantIds: string[]
  rows: { entrantId: string; placement: number | null; kills: number | null }[]
}): LobbyFlag[] {
  const { entrantIds, rows } = input
  if (entrantIds.length === 0) return []

  const flags: LobbyFlag[] = []
  // A blank placement means "has not reported", never zeroth place.
  const reported = rows.filter((r) => r.placement !== null && r.placement !== undefined)

  const missing = entrantIds.filter((id) => !reported.some((r) => r.entrantId === id))
  if (missing.length > 0) {
    flags.push({
      code: 'missing_submission',
      message: `${missing.length} entrant(s) have not submitted a result.`,
      entrantIds: missing,
    })
  }

  const byPlacement = new Map<number, string[]>()
  for (const r of reported) {
    const p = r.placement as number
    byPlacement.set(p, [...(byPlacement.get(p) ?? []), r.entrantId])
  }
  const duplicated = Array.from(byPlacement.entries()).filter(([, ids]) => ids.length > 1)
  if (duplicated.length > 0) {
    flags.push({
      code: 'duplicate_placement',
      message: `Two or more entrants claim the same placement: ${duplicated
        .map(([p]) => `#${p}`)
        .join(', ')}.`,
      entrantIds: duplicated.flatMap(([, ids]) => ids),
    })
  }

  const outOfRange = reported
    .filter((r) => (r.placement as number) < 1 || (r.placement as number) > entrantIds.length)
    .map((r) => r.entrantId)
  if (outOfRange.length > 0) {
    flags.push({
      code: 'placement_out_of_range',
      message: `Placement must be between 1 and ${entrantIds.length} for this lobby.`,
      entrantIds: outOfRange,
    })
  }

  // At most everyone-but-one can be eliminated, so that caps the kills.
  const totalKills = rows.reduce((sum, r) => sum + (r.kills ?? 0), 0)
  const maxKills = entrantIds.length - 1
  if (totalKills > maxKills) {
    flags.push({
      code: 'impossible_kills',
      message: `Total kills (${totalKills}) exceeds the maximum possible (${maxKills}) for ${entrantIds.length} entrants.`,
      entrantIds: rows.filter((r) => (r.kills ?? 0) > 0).map((r) => r.entrantId),
    })
  }

  return flags
}
