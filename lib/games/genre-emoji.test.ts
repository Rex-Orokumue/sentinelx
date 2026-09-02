import { describe, it, expect } from 'vitest'
import { gameGenreEmoji } from './genre-emoji'

describe('gameGenreEmoji', () => {
  it('maps known categories to their genre emoji', () => {
    expect(gameGenreEmoji('football')).toBe('⚽')
    expect(gameGenreEmoji('fighting')).toBe('🥊')
    expect(gameGenreEmoji('shooter')).toBe('🎯')
    expect(gameGenreEmoji('racing')).toBe('🏎️')
  })

  it('falls back to the generic controller for unknown / missing categories', () => {
    expect(gameGenreEmoji('other')).toBe('🎮')
    expect(gameGenreEmoji('battle-royale')).toBe('🎮')
    expect(gameGenreEmoji(null)).toBe('🎮')
    expect(gameGenreEmoji(undefined)).toBe('🎮')
    expect(gameGenreEmoji('')).toBe('🎮')
  })
})
