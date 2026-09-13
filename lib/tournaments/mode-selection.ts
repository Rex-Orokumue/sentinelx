// Turning a Mode + Format choice into the columns the rest of the platform
// already reads.
//
// game_mode_formats is the CATALOGUE — it defines what "Clash Squad 4v4"
// means. tournaments.entry_unit / squad_size stay the authoritative stored
// values, because every existing constraint and closeRegistration read them.
// Selecting a Format WRITES them, so the admin is never asked twice and the
// two cannot drift.

export interface ModeOption {
  id: string
  slug: string
  name: string
  competitionFormat: string
}

export interface FormatOption {
  id: string
  slug: string
  name: string
  entryUnit: string
  teamSize: number
  available: boolean
}

export interface MapOption {
  id: string
  name: string
}

export function resolveModeSelection(
  mode: ModeOption | null,
  format: FormatOption | null,
): { competitionFormat: string; entryUnit: string; squadSize: number | '' } {
  // No mode: a football game, which must produce exactly the row it always did.
  if (!mode) return { competitionFormat: 'head_to_head', entryUnit: 'solo', squadSize: '' }

  // A format is only meaningful alongside its own mode; without one, fall back
  // to solo rather than carrying a stale selection across a mode change.
  const entryUnit = format?.entryUnit === 'squad' ? 'squad' : 'solo'

  return {
    competitionFormat: mode.competitionFormat,
    entryUnit,
    // tournaments_squad_size_present requires NULL for solo, and the schema
    // maps '' to NULL.
    squadSize: entryUnit === 'squad' && format ? format.teamSize : '',
  }
}

// Unavailable formats are KEPT, not filtered: they render greyed as "Coming
// soon" so the roadmap is legible. Dropping them here would hide it.
export function formatsForMode<T extends { modeId: string }>(all: T[], modeId: string | null): T[] {
  if (!modeId) return []
  return all.filter((f) => f.modeId === modeId)
}

export function mapsForMode<T extends MapOption & { modeId: string }>(
  all: T[],
  modeId: string | null,
): MapOption[] {
  if (!modeId) return []
  return all.filter((m) => m.modeId === modeId).map((m) => ({ id: m.id, name: m.name }))
}

// Match rules are a per-MODE catalogue (game_mode_match_rules), same shape as
// maps. This is deliberately not a global enum: Free Fire's "Headshot only"
// and PUBG's "TPP" are different axes entirely (custom-room rule vs camera
// perspective), and a flat list would offer PUBG's options on a Free Fire
// tournament — the exact cross-mode leak the Mode->Format->Map chain exists
// to prevent, just on a fourth field.
export function matchRulesForMode<T extends MapOption & { modeId: string }>(
  all: T[],
  modeId: string | null,
): MapOption[] {
  if (!modeId) return []
  return all.filter((r) => r.modeId === modeId).map((r) => ({ id: r.id, name: r.name }))
}
