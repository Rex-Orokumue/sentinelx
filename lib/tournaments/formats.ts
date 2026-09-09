// The competition-format discriminator. Deliberately a property of the
// TOURNAMENT, not the game: COD Mobile can host a 1v1 gunfight cup or a
// battle-royale circuit, and both are legitimate uses of one games row.
//
// 'head_to_head' is everything that existed before multi-format work — two
// players, two scores, groups feeding a knockout bracket.
// 'points_race' is battle royale — lobbies of many entrants ranked by
// placement and kills, points accumulating across a stage's rounds.
export type CompetitionFormat = 'head_to_head' | 'points_race'
export type EntryUnit = 'solo' | 'squad'

// Canonical order — drives the admin picker, so it must be stable.
export const COMPETITION_FORMATS: readonly CompetitionFormat[] = ['head_to_head', 'points_race']
const ENTRY_UNITS: readonly EntryUnit[] = ['solo', 'squad']

export const FORMAT_LABEL: Record<CompetitionFormat, string> = {
  head_to_head: 'Head to head (groups + knockout)',
  points_race: 'Points race (battle royale lobbies)',
}

export function isCompetitionFormat(v: unknown): v is CompetitionFormat {
  return typeof v === 'string' && (COMPETITION_FORMATS as readonly string[]).includes(v)
}

export function isEntryUnit(v: unknown): v is EntryUnit {
  return typeof v === 'string' && (ENTRY_UNITS as readonly string[]).includes(v)
}

// Which formats a game may be run in, from its `supported_formats` column.
//
// Returns them in COMPETITION_FORMATS order rather than column order: a
// Postgres array has no ordering guarantee, and a picker that reshuffles
// between page loads looks broken.
//
// Always yields at least ['head_to_head'] — every game can run 1v1, and an
// empty picker would be a dead end for a game row predating this column or one
// an admin emptied by accident.
export function formatsForGame(supported: string[] | null | undefined): CompetitionFormat[] {
  const declared = (supported ?? []).filter(isCompetitionFormat)
  if (declared.length === 0) return ['head_to_head']
  return COMPETITION_FORMATS.filter((f) => declared.includes(f))
}
