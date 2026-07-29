import { describe, it, expect } from 'vitest'
import { isTabActive, initialsFrom, PILLAR_TABS } from './tabs'

const compete = PILLAR_TABS.find((t) => t.key === 'compete')!
const watch = PILLAR_TABS.find((t) => t.key === 'watch')!

describe('isTabActive', () => {
  it('marks a tab active on its route and subroutes', () => {
    expect(isTabActive(compete, '/tournaments')).toBe(true)
    expect(isTabActive(compete, '/tournaments/dls-cup')).toBe(true)
    expect(isTabActive(compete, '/tournaments/dls-cup/bracket')).toBe(true)
    expect(isTabActive(compete, '/rankings')).toBe(false)
  })

  it('does not match a route that merely shares a string prefix', () => {
    expect(isTabActive(watch, '/tvshows')).toBe(false)
  })

  it('marks each pillar active on its own route only', () => {
    const community = PILLAR_TABS.find((t) => t.key === 'community')!
    const trade = PILLAR_TABS.find((t) => t.key === 'trade')!
    expect(isTabActive(watch, '/tv')).toBe(true)
    expect(isTabActive(community, '/community')).toBe(true)
    expect(isTabActive(trade, '/exchange')).toBe(true)
    expect(isTabActive(trade, '/community')).toBe(false)
  })
})

describe('PILLAR_TABS', () => {
  it('covers the four product pillars', () => {
    expect(PILLAR_TABS.map((t) => t.key)).toEqual(['compete', 'watch', 'community', 'trade'])
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
