// The admin's lobby grid: every entrant on a row, their own submission
// pre-filled, blanks where nobody reported.
//
// One grid confirmed in one action, rather than one approval per player: a
// 48-entrant lobby would otherwise need 48 approvals per round, and a review
// queue nobody works is worse than no queue at all.
//
// Pure, because the rule that matters — every entrant gets a row whether or not
// they submitted — is invisible in a UI test and load-bearing: an entrant
// missing from the grid cannot be scored and the admin has no way to notice.

export interface GridEntrant {
  entrantId: string
  displayName: string
}

export interface GridSubmission {
  entrantId: string
  placement: number
  kills: number
  screenshotUrl: string | null
  status: string
}

export interface LobbyGridRow {
  entrantId: string
  displayName: string
  /** null means "nobody reported", never "reported zero". */
  placement: number | null
  kills: number | null
  screenshotUrl: string | null
  submitted: boolean
  status: string
}

export function buildLobbyGrid(
  entrants: GridEntrant[],
  submissions: GridSubmission[],
): LobbyGridRow[] {
  const byEntrant = new Map(submissions.map((s) => [s.entrantId, s]))

  // Entrant order drives the grid, not submission order — rows must not jump
  // around between renders as results arrive.
  return entrants.map((e) => {
    const s = byEntrant.get(e.entrantId)
    return {
      entrantId: e.entrantId,
      displayName: e.displayName,
      placement: s?.placement ?? null,
      kills: s?.kills ?? null,
      screenshotUrl: s?.screenshotUrl ?? null,
      submitted: s !== undefined,
      status: s?.status ?? 'pending',
    }
  })
}
