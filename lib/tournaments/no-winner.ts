import { sideAId, sideBId, type AdvanceMatch } from './advancement'

// A tournament can be ended with no champion when its grand final is stuck in
// 'disputed'. That state is derived, not stored: the only other route to
// tournaments.status = 'completed' is completeTournamentIfFinal, which fires
// only from a RESOLVED final — so "completed + final still disputed" can only
// be this action's doing.

export interface FinalMatchRow extends AdvanceMatch {
  id: string
  round: string
  admin_note?: string | null
}

export type CloseCheck = { ok: true; final: FinalMatchRow } | { ok: false; reason: string }

export function canCloseWithoutWinner(tournamentStatus: string, matches: FinalMatchRow[]): CloseCheck {
  if (tournamentStatus !== 'active') {
    return { ok: false, reason: 'Only an active tournament can be closed without a winner.' }
  }
  const final = matches.find((m) => m.round === 'final')
  if (!final) return { ok: false, reason: 'This tournament has no final match.' }
  if (final.status !== 'disputed') {
    return {
      ok: false,
      reason: 'Only a tournament whose final is disputed can be closed without a winner. Resolve the final normally instead.',
    }
  }
  return { ok: true, final }
}

export function isClosedWithoutWinner(
  tournamentStatus: string,
  matches: { round: string; status: string }[],
): boolean {
  return tournamentStatus === 'completed' && matches.some((m) => m.round === 'final' && m.status === 'disputed')
}

// The two sides of the final as opaque ids — player ids for a solo final,
// squad ids for a team final.
export function finalSideIds(final: AdvanceMatch): string[] {
  return [sideAId(final), sideBId(final)].filter((id): id is string => id != null)
}

// Drops every player whose entity (themselves, or their squad in a team
// tournament) is in the exclusion list. Same player->entity translation
// bandsForPlacements uses, so a squad exclusion removes its whole roster.
export function withoutEntities(
  playerIds: string[],
  excludeEntityIds: string[],
  playerToEntityId?: Map<string, string>,
): string[] {
  if (excludeEntityIds.length === 0) return playerIds
  const excluded = new Set(excludeEntityIds)
  return playerIds.filter((p) => !excluded.has(playerToEntityId?.get(p) ?? p))
}
