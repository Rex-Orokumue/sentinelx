import { describe, it, expect } from 'vitest'
import { isTabActive, initialsFrom, PILLAR_TABS } from './tabs'

const compete = PILLAR_TABS.find((t) => t.key === 'compete')!
const watch = PILLAR_TABS.find((t) => t.key === 'watch')!

describe('isTabActive', () => {
  it('marks a path-matched tab active on its route and subroutes', () => {
    expect(isTabActive(compete, '/tournaments', null)).toBe(true)
    expect(isTabActive(compete, '/tournaments/dls-cup', null)).toBe(true)
    expect(isTabActive(compete, '/rankings', null)).toBe(false)
  })

  it('marks a coming-soon tab active only for its feature', () => {
    expect(isTabActive(watch, '/coming-soon', 'Watch')).toBe(true)
    expect(isTabActive(watch, '/coming-soon', 'Trade')).toBe(false)
    expect(isTabActive(watch, '/tournaments', 'Watch')).toBe(false)
  })
})

describe('initialsFrom', () => {
  it('uses two-word display names', () => {
    expect(initialsFrom('Rex Orokumue', 'rexo')).toBe('RO')
  })
  it('falls back to the first two letters of a single token', () => {
    expect(initialsFrom(null, 'rexorokumue')).toBe('RE')
    expect(initialsFrom('Rex', null)).toBe('RE')
  })
  it('returns ? when nothing is available', () => {
    expect(initialsFrom(null, null)).toBe('?')
  })
})
