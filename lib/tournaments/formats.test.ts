import { describe, it, expect } from 'vitest'
import {
  COMPETITION_FORMATS,
  FORMAT_LABEL,
  formatsForGame,
  isCompetitionFormat,
  isEntryUnit,
} from './formats'

describe('isCompetitionFormat', () => {
  it('accepts the two real formats', () => {
    expect(isCompetitionFormat('head_to_head')).toBe(true)
    expect(isCompetitionFormat('points_race')).toBe(true)
  })

  it('rejects anything else, including near-misses and non-strings', () => {
    expect(isCompetitionFormat('group_knockout')).toBe(false)
    expect(isCompetitionFormat('')).toBe(false)
    expect(isCompetitionFormat(null)).toBe(false)
    expect(isCompetitionFormat(undefined)).toBe(false)
    expect(isCompetitionFormat(1)).toBe(false)
  })
})

describe('isEntryUnit', () => {
  it('accepts solo and squad only', () => {
    expect(isEntryUnit('solo')).toBe(true)
    expect(isEntryUnit('squad')).toBe(true)
    expect(isEntryUnit('team')).toBe(false)
    expect(isEntryUnit(null)).toBe(false)
  })
})

describe('formatsForGame', () => {
  it('returns the formats a game declares', () => {
    expect(formatsForGame(['head_to_head', 'points_race'])).toEqual(['head_to_head', 'points_race'])
  })

  it('preserves the canonical order regardless of how the column is stored', () => {
    // The array column has no ordering guarantee, but the format picker must
    // not reshuffle between page loads.
    expect(formatsForGame(['points_race', 'head_to_head'])).toEqual(['head_to_head', 'points_race'])
  })

  it('drops values that are not real formats', () => {
    // Defensive: this column is hand-editable data.
    expect(formatsForGame(['head_to_head', 'battle_royale'])).toEqual(['head_to_head'])
  })

  it('falls back to head_to_head when the column is empty or missing', () => {
    // A game row predating this migration, or one an admin emptied. Every game
    // can always at least run 1v1 — never offer an empty picker.
    expect(formatsForGame([])).toEqual(['head_to_head'])
    expect(formatsForGame(null)).toEqual(['head_to_head'])
    expect(formatsForGame(undefined)).toEqual(['head_to_head'])
  })
})

describe('FORMAT_LABEL', () => {
  it('names every format for the admin picker', () => {
    for (const f of COMPETITION_FORMATS) {
      expect(FORMAT_LABEL[f].length).toBeGreaterThan(0)
    }
  })
})
