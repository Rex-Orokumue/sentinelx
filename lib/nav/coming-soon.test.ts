import { describe, it, expect } from 'vitest'
import { resolveComingSoon } from './coming-soon'

describe('resolveComingSoon', () => {
  it('returns branded copy for known features', () => {
    expect(resolveComingSoon('Watch').title).toBe('Watch')
    expect(resolveComingSoon('Watch').blurb).toMatch(/replays/i)
    expect(resolveComingSoon('Community').title).toBe('Community')
    expect(resolveComingSoon('Trade').title).toBe('Trade')
  })

  it('falls back for unknown or missing features', () => {
    expect(resolveComingSoon('Nope').title).toBe('Coming soon')
    expect(resolveComingSoon(undefined).title).toBe('Coming soon')
  })
})
