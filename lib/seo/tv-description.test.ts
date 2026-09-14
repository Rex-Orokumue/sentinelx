import { describe, it, expect } from 'vitest'
import { tvDescription } from './tv-description'

describe('tvDescription', () => {
  it('falls back to the static description when nothing is live', () => {
    expect(tvDescription(null)).toBe(
      'Watch live mobile esports, highlights, finals, and match replays on Sentinel X TV.',
    )
  })

  it('mentions the live match by name when one is streaming', () => {
    const result = tvDescription('Sentinel vs Chuka')
    expect(result).toContain('Sentinel vs Chuka')
  })
})
