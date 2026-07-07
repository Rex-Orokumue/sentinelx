import { describe, it, expect } from 'vitest'
import { slugify } from './slug'

describe('slugify', () => {
  it('lowercases and hyphenates words', () => {
    expect(slugify('DLS Season 5')).toBe('dls-season-5')
  })
  it('strips punctuation', () => {
    expect(slugify('DLS Season 5!')).toBe('dls-season-5')
  })
  it('collapses repeated separators and trims', () => {
    expect(slugify('  Multiple   Spaces  ')).toBe('multiple-spaces')
    expect(slugify('Under_scores')).toBe('under-scores')
  })
  it('strips diacritics', () => {
    expect(slugify('Café Cup')).toBe('cafe-cup')
  })
  it('returns empty string for all-symbol input', () => {
    expect(slugify('---')).toBe('')
    expect(slugify('!!!')).toBe('')
  })
})
