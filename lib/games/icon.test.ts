import { describe, it, expect, vi, beforeEach } from 'vitest'

const findOptionalPublicImage = vi.fn()
vi.mock('@/lib/media/optional-image', () => ({
  findOptionalPublicImage: (...args: unknown[]) => findOptionalPublicImage(...args),
}))

import { resolveGameIconUrl, resolveTournamentImageUrl } from './icon'

beforeEach(() => {
  findOptionalPublicImage.mockReset()
})

describe('resolveGameIconUrl', () => {
  it('prefers an admin-set icon_url over everything', () => {
    findOptionalPublicImage.mockReturnValue('/games/dls.jpeg')
    expect(
      resolveGameIconUrl({ icon_url: 'https://cdn.example.com/dls.png', slug: 'dls' }),
    ).toBe('https://cdn.example.com/dls.png')
    expect(findOptionalPublicImage).not.toHaveBeenCalled()
  })

  it('accepts the camelCase iconUrl shape too', () => {
    expect(resolveGameIconUrl({ iconUrl: 'https://cdn.example.com/x.png' })).toBe(
      'https://cdn.example.com/x.png',
    )
  })

  it('falls back to local key art by slug when no icon_url', () => {
    findOptionalPublicImage.mockReturnValue('/games/ea-fc-mobile.jpeg')
    expect(resolveGameIconUrl({ icon_url: null, slug: 'ea-fc-mobile' })).toBe(
      '/games/ea-fc-mobile.jpeg',
    )
    expect(findOptionalPublicImage).toHaveBeenCalledWith('games', 'ea-fc-mobile')
  })

  it('returns null when there is no icon_url and no local file', () => {
    findOptionalPublicImage.mockReturnValue(null)
    expect(resolveGameIconUrl({ icon_url: null, slug: 'blood-strike' })).toBeNull()
  })

  it('returns null for a missing game or a game with no slug', () => {
    expect(resolveGameIconUrl(null)).toBeNull()
    expect(resolveGameIconUrl(undefined)).toBeNull()
    expect(resolveGameIconUrl({ icon_url: null })).toBeNull()
    expect(findOptionalPublicImage).not.toHaveBeenCalled()
  })
})

describe('resolveTournamentImageUrl', () => {
  it('prefers the tournament card image over the game', () => {
    findOptionalPublicImage.mockReturnValue('/games/dls.jpeg')
    expect(
      resolveTournamentImageUrl('https://cdn.example.com/cup.png', { icon_url: null, slug: 'dls' }),
    ).toBe('https://cdn.example.com/cup.png')
    expect(findOptionalPublicImage).not.toHaveBeenCalled()
  })

  it('falls through to the game image when there is no card image', () => {
    findOptionalPublicImage.mockReturnValue('/games/dls.jpeg')
    expect(resolveTournamentImageUrl(null, { icon_url: null, slug: 'dls' })).toBe('/games/dls.jpeg')
    expect(resolveTournamentImageUrl('   ', { icon_url: null, slug: 'dls' })).toBe('/games/dls.jpeg')
  })

  it('returns null when neither the tournament nor the game has an image', () => {
    findOptionalPublicImage.mockReturnValue(null)
    expect(resolveTournamentImageUrl(null, { icon_url: null, slug: 'blood-strike' })).toBeNull()
    expect(resolveTournamentImageUrl(undefined, null)).toBeNull()
  })
})
