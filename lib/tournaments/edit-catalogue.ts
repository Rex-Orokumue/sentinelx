import type { ModeCatalogue } from './mode-catalogue'

export interface RetiredLookups {
  mode: { id: string; game_id: string; slug: string; name: string; competition_format: string } | null
  format: { id: string; mode_id: string; slug: string; name: string; entry_unit: string; team_size: number; available: boolean } | null
  map: { id: string; mode_id: string; name: string } | null
  matchRule: { id: string; mode_id: string; name: string } | null
  matchType: { id: string; slug: string; name: string; available: boolean } | null
}

// A tournament's current mode/format/map/match-rule/match-type selection can
// go inactive after the tournament was saved (an admin retired it via the
// Game Designer). fetchModeCatalogue() only returns active rows, so without
// this the edit form's <select> has no matching <option> for the
// tournament's own value, and a later, unrelated save silently drops or
// swaps it. This merges the tournament's own selection back in, labeled
// "(retired)", scoped to the catalogue object passed in — it never touches
// the shared read other tournaments' edit pages use, so a retired option
// never leaks into an unrelated tournament's dropdown.
export function withRetiredSelections(catalogue: ModeCatalogue, lookups: RetiredLookups): ModeCatalogue {
  const modes =
    lookups.mode && !catalogue.modes.some((m) => m.id === lookups.mode!.id)
      ? [
          ...catalogue.modes,
          {
            id: lookups.mode.id,
            gameId: lookups.mode.game_id,
            slug: lookups.mode.slug,
            name: `${lookups.mode.name} (retired)`,
            competitionFormat: lookups.mode.competition_format,
          },
        ]
      : catalogue.modes

  const formats =
    lookups.format && !catalogue.formats.some((f) => f.id === lookups.format!.id)
      ? [
          ...catalogue.formats,
          {
            id: lookups.format.id,
            modeId: lookups.format.mode_id,
            slug: lookups.format.slug,
            name: `${lookups.format.name} (retired)`,
            entryUnit: lookups.format.entry_unit,
            teamSize: lookups.format.team_size,
            available: lookups.format.available,
          },
        ]
      : catalogue.formats

  const maps =
    lookups.map && !catalogue.maps.some((m) => m.id === lookups.map!.id)
      ? [...catalogue.maps, { id: lookups.map.id, modeId: lookups.map.mode_id, name: `${lookups.map.name} (retired)` }]
      : catalogue.maps

  const matchRules =
    lookups.matchRule && !catalogue.matchRules.some((r) => r.id === lookups.matchRule!.id)
      ? [...catalogue.matchRules, { id: lookups.matchRule.id, modeId: lookups.matchRule.mode_id, name: `${lookups.matchRule.name} (retired)` }]
      : catalogue.matchRules

  const matchTypes =
    lookups.matchType && !catalogue.matchTypes.some((t) => t.id === lookups.matchType!.id)
      ? [
          ...catalogue.matchTypes,
          { id: lookups.matchType.id, slug: lookups.matchType.slug, name: `${lookups.matchType.name} (retired)`, available: lookups.matchType.available },
        ]
      : catalogue.matchTypes

  return { modes, formats, maps, matchRules, matchTypes }
}
