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
    const community = PILLAR_TABS.find((t) => t.key === 'community')!
    expect(isTabActive(community, '/coming-soon', 'Community')).toBe(true)
    expect(isTabActive(community, '/coming-soon', 'Trade')).toBe(false)
    expect(isTabActive(community, '/tournaments', 'Community')).toBe(false)
  })

  it('marks the Watch tab active on /tv (real page, not coming-soon)', () => {
    expect(isTabActive(watch, '/tv', null)).toBe(true)
    expect(isTabActive(watch, '/coming-soon', 'Watch')).toBe(false)
  })

  it('marks the Trade tab active on /exchange', () => {
    const trade = PILLAR_TABS.find((t) => t.key === 'trade')!
    expect(isTabActive(trade, '/exchange', null)).toBe(true)
    expect(isTabActive(trade, '/coming-soon', 'Trade')).toBe(false)
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
