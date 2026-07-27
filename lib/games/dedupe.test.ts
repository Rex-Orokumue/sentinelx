import { describe, it, expect } from 'vitest'
import { dedupeGamesByName, type DedupableGame } from './dedupe'

function g(over: Partial<DedupableGame> & { name: string; slug: string }): DedupableGame {
  return {
    icon_url: null,
    active: false,
    created_at: '2026-01-01T00:00:00Z',
    ...over,
  }
}

describe('dedupeGamesByName', () => {
  it('picks the active row over inactive duplicates regardless of creation order', () => {
    const result = dedupeGamesByName([
      g({ name: 'Free Fire', slug: 'free-fire-old', active: false, created_at: '2026-01-01T00:00:00Z' }),
      g({ name: 'Free Fire', slug: 'free-fire', active: true, created_at: '2025-06-01T00:00:00Z' }),
      g({ name: 'Free Fire', slug: 'free-fire-new', active: false, created_at: '2026-07-01T00:00:00Z' }),
    ])
    expect(result).toHaveLength(1)
    expect(result[0].slug).toBe('free-fire')
  })

  it('picks the most recently created row when all duplicates are inactive', () => {
    const result = dedupeGamesByName([
      g({ name: 'Blood strike', slug: 'blood-strike', created_at: '2026-01-01T00:00:00Z' }),
      g({ name: 'Blood strike', slug: 'blood-strike-2', created_at: '2026-03-01T00:00:00Z' }),
    ])
    expect(result).toHaveLength(1)
    expect(result[0].slug).toBe('blood-strike-2')
  })

  it('passes a single row through unchanged', () => {
    const only = g({ name: 'Dream League Soccer', slug: 'dls', active: true })
    expect(dedupeGamesByName([only])).toEqual([only])
  })

  it('keeps distinct names as separate entries', () => {
    const result = dedupeGamesByName([
      g({ name: 'Dream League Soccer', slug: 'dls', active: true }),
      g({ name: 'COD Mobile', slug: 'cod-mobile' }),
    ])
    expect(result.map((r) => r.name).sort()).toEqual(['COD Mobile', 'Dream League Soccer'])
  })
})
