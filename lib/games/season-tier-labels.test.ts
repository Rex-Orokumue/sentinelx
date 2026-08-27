import { describe, it, expect } from 'vitest'
import { seasonTierLabelsFor } from './season-tier-labels'

describe('seasonTierLabelsFor', () => {
  it('returns DLS\'s own labels, including the Champions Cup spotlight', () => {
    const labels = seasonTierLabelsFor('dls')
    expect(labels.communityClub).toBe('Community Clubs')
    expect(labels.masters).toBe('Masters')
    expect(labels.showChampionsCupSpotlight).toBe(true)
  })

  it('returns FC Mobile\'s own labels, with no Champions Cup spotlight', () => {
    const labels = seasonTierLabelsFor('ea-fc-mobile')
    expect(labels.communityClub).toBe('Circuit Cups')
    expect(labels.masters).toBe('Elite Cups')
    expect(labels.showChampionsCupSpotlight).toBe(false)
  })

  it('falls back to generic labels for an unlisted game slug', () => {
    const labels = seasonTierLabelsFor('some-future-game')
    expect(labels.showChampionsCupSpotlight).toBe(false)
    expect(labels.communityClub.length).toBeGreaterThan(0)
    expect(labels.masters.length).toBeGreaterThan(0)
    expect(labels.qualificationNote.length).toBeGreaterThan(0)
  })
})
