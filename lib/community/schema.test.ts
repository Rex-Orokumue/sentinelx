import { describe, it, expect } from 'vitest'
import { MAX_POST_IMAGES, clampImageUrls } from './schema'

describe('MAX_POST_IMAGES', () => {
  it('is 5', () => {
    expect(MAX_POST_IMAGES).toBe(5)
  })
})

describe('clampImageUrls', () => {
  it('passes through a list under the cap unchanged', () => {
    expect(clampImageUrls(['a', 'b'])).toEqual(['a', 'b'])
  })

  it('caps a list over the max at 5, keeping order', () => {
    const urls = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    expect(clampImageUrls(urls)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('trims whitespace on each url', () => {
    expect(clampImageUrls(['  a  ', 'b\n'])).toEqual(['a', 'b'])
  })

  it('drops blank/whitespace-only entries', () => {
    expect(clampImageUrls(['a', '   ', '', 'b'])).toEqual(['a', 'b'])
  })

  it('returns an empty array for an empty input', () => {
    expect(clampImageUrls([])).toEqual([])
  })
})
