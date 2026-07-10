import { describe, it, expect } from 'vitest'
import { youtubeThumbnail } from './thumbnail'

describe('youtubeThumbnail', () => {
  it('builds a thumbnail URL from a watch link', () => {
    expect(youtubeThumbnail('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(
      'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    )
  })
  it('returns null for an unparseable or missing URL', () => {
    expect(youtubeThumbnail('https://example.com/nope')).toBeNull()
    expect(youtubeThumbnail(null)).toBeNull()
  })
})
