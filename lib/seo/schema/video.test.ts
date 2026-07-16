import { describe, it, expect } from 'vitest'
import { buildVideoJsonLd } from './video'

describe('buildVideoJsonLd', () => {
  it('includes all four Google-required VideoObject fields', () => {
    const result = buildVideoJsonLd({
      name: 'SniperKing vs GoalMachine',
      description: 'DLS 26 Championship final.',
      thumbnailUrl: 'https://img.youtube.com/vi/abc123/hqdefault.jpg',
      embedUrl: 'https://www.youtube.com/embed/abc123',
      uploadDate: '2026-07-10T00:00:00.000Z',
    })
    expect(result.name).toBeTruthy()
    expect(result.description).toBeTruthy()
    expect(result.thumbnailUrl).toBeTruthy()
    expect(result.uploadDate).toBe('2026-07-10T00:00:00.000Z')
    expect(result.embedUrl).toBe('https://www.youtube.com/embed/abc123')
  })

  it('falls back to a generated description when none is given', () => {
    const result = buildVideoJsonLd({
      name: 'Highlight Reel',
      description: null,
      thumbnailUrl: 'https://img.youtube.com/vi/xyz/hqdefault.jpg',
      embedUrl: 'https://www.youtube.com/embed/xyz',
      uploadDate: '2026-07-01T00:00:00.000Z',
    })
    expect(result.description).toContain('Highlight Reel')
  })
})
