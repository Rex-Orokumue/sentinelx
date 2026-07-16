import { describe, it, expect } from 'vitest'
import { homepageDescription } from './homepage-description'
import { SITE_DESCRIPTION } from './site'

describe('homepageDescription', () => {
  it('falls back to the static site description when nothing is live', () => {
    expect(homepageDescription(null)).toBe(SITE_DESCRIPTION)
  })

  it('mentions the live tournament by name when one is open', () => {
    const result = homepageDescription('DLS 26 Championship Season 2')
    expect(result).toContain('DLS 26 Championship Season 2')
  })
})
