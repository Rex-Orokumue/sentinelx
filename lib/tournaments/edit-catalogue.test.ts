import { describe, it, expect } from 'vitest'
import { withRetiredSelections } from './edit-catalogue'
import type { ModeCatalogue } from './mode-catalogue'

function baseCatalogue(): ModeCatalogue {
  return {
    modes: [{ id: 'm-active', gameId: 'g1', slug: 'battle_royale', name: 'Battle Royale', competitionFormat: 'points_race' }],
    formats: [{ id: 'f-active', modeId: 'm-active', slug: 'solo', name: 'Solo', entryUnit: 'solo', teamSize: 1, available: true }],
    maps: [{ id: 'map-active', modeId: 'm-active', name: 'Bermuda' }],
    matchRules: [{ id: 'r-active', modeId: 'm-active', name: 'Normal' }],
    matchTypes: [{ id: 'mt-active', slug: 'bo1', name: 'Best of 1', available: true }],
  }
}

describe('withRetiredSelections', () => {
  it('leaves the catalogue untouched when nothing is retired', () => {
    const result = withRetiredSelections(baseCatalogue(), { mode: null, format: null, map: null, matchRule: null, matchType: null })
    expect(result).toEqual(baseCatalogue())
  })

  it('appends a retired mode, labeled, without touching the active list', () => {
    const result = withRetiredSelections(baseCatalogue(), {
      mode: { id: 'm-retired', game_id: 'g1', slug: 'clash_squad', name: 'Clash Squad', competition_format: 'head_to_head' },
      format: null,
      map: null,
      matchRule: null,
      matchType: null,
    })
    expect(result.modes).toEqual([
      ...baseCatalogue().modes,
      { id: 'm-retired', gameId: 'g1', slug: 'clash_squad', name: 'Clash Squad (retired)', competitionFormat: 'head_to_head' },
    ])
    expect(result.formats).toEqual(baseCatalogue().formats)
  })

  it('does not duplicate a mode that is already in the active catalogue', () => {
    const result = withRetiredSelections(baseCatalogue(), {
      mode: { id: 'm-active', game_id: 'g1', slug: 'battle_royale', name: 'Battle Royale', competition_format: 'points_race' },
      format: null,
      map: null,
      matchRule: null,
      matchType: null,
    })
    expect(result.modes).toEqual(baseCatalogue().modes)
  })

  it('appends a retired format, map, match rule and match type all together', () => {
    const result = withRetiredSelections(baseCatalogue(), {
      mode: null,
      format: { id: 'f-retired', mode_id: 'm-active', slug: '4v4', name: '4v4', entry_unit: 'squad', team_size: 4, available: false },
      map: { id: 'map-retired', mode_id: 'm-active', name: 'Purgatory' },
      matchRule: { id: 'r-retired', mode_id: 'm-active', name: 'Headshot only' },
      matchType: { id: 'mt-retired', slug: 'bo3', name: 'Best of 3', available: false },
    })
    expect(result.formats).toContainEqual({ id: 'f-retired', modeId: 'm-active', slug: '4v4', name: '4v4 (retired)', entryUnit: 'squad', teamSize: 4, available: false })
    expect(result.maps).toContainEqual({ id: 'map-retired', modeId: 'm-active', name: 'Purgatory (retired)' })
    expect(result.matchRules).toContainEqual({ id: 'r-retired', modeId: 'm-active', name: 'Headshot only (retired)' })
    expect(result.matchTypes).toContainEqual({ id: 'mt-retired', slug: 'bo3', name: 'Best of 3 (retired)', available: false })
  })
})
