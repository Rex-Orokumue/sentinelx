import { describe, it, expect } from 'vitest'
import { settingsCountryOptions } from './country-options'

describe('settingsCountryOptions', () => {
  it('preselects a canonical country with no extra option', () => {
    const { selected, legacyOption } = settingsCountryOptions('Ghana')
    expect(selected).toBe('Ghana')
    expect(legacyOption).toBeNull()
  })

  it('maps a legacy spelling to the canonical name so saving normalizes it', () => {
    for (const legacy of ['Nigerian', 'naija', 'NIGERIA ']) {
      const { selected, legacyOption } = settingsCountryOptions(legacy)
      expect(selected).toBe('Nigeria')
      expect(legacyOption).toBeNull()
    }
  })

  it('keeps a value that names no known country as its own option, so an unrelated save does not wipe it', () => {
    const { selected, legacyOption } = settingsCountryOptions('Lagos')
    expect(selected).toBe('Lagos')
    expect(legacyOption).toBe('Lagos')
  })

  it('selects nothing for an empty or missing country', () => {
    for (const empty of ['', '   ', null, undefined]) {
      const { selected, legacyOption } = settingsCountryOptions(empty)
      expect(selected).toBe('')
      expect(legacyOption).toBeNull()
    }
  })

  it('offers every country from the shared list, sorted by name', () => {
    const { countries } = settingsCountryOptions(null)
    expect(countries.length).toBeGreaterThan(200)
    expect(countries.map((c) => c.name)).toEqual([...countries.map((c) => c.name)].sort((a, b) => a.localeCompare(b)))
  })
})
