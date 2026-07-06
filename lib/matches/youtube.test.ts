import { describe, it, expect } from 'vitest'
import { parseYouTubeId, youtubeEmbedUrl } from './youtube'

describe('parseYouTubeId', () => {
  it('parses watch?v= URLs', () => {
    expect(parseYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })
  it('parses youtu.be short URLs', () => {
    expect(parseYouTubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })
  it('parses /live/ URLs', () => {
    expect(parseYouTubeId('https://www.youtube.com/live/dQw4w9WgXcQ?feature=share')).toBe('dQw4w9WgXcQ')
  })
  it('parses /embed/ URLs', () => {
    expect(parseYouTubeId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })
  it('parses watch URLs with extra params', () => {
    expect(parseYouTubeId('https://www.youtube.com/watch?list=abc&v=dQw4w9WgXcQ&t=10s')).toBe('dQw4w9WgXcQ')
  })
  it('returns null for non-YouTube or junk', () => {
    expect(parseYouTubeId('https://example.com/video')).toBeNull()
    expect(parseYouTubeId('not a url')).toBeNull()
    expect(parseYouTubeId(null)).toBeNull()
    expect(parseYouTubeId('')).toBeNull()
  })
})

describe('youtubeEmbedUrl', () => {
  it('builds an embed URL', () => {
    expect(youtubeEmbedUrl('dQw4w9WgXcQ')).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ')
  })
  it('adds autoplay when requested', () => {
    expect(youtubeEmbedUrl('dQw4w9WgXcQ', { autoplay: true })).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1')
  })
})
