import { describe, it, expect } from 'vitest'
import { tvVideoSchema } from './schema'

const valid = {
  title: 'Insane comeback',
  category: 'highlight',
  youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ',
  description: '',
  thumbnailUrl: '',
}

describe('tvVideoSchema', () => {
  it('accepts a valid video', () => {
    expect(tvVideoSchema.safeParse(valid).success).toBe(true)
  })
  it('rejects a non-YouTube URL', () => {
    expect(tvVideoSchema.safeParse({ ...valid, youtubeUrl: 'https://vimeo.com/1' }).success).toBe(false)
  })
  it('rejects an unknown category', () => {
    expect(tvVideoSchema.safeParse({ ...valid, category: 'meme' }).success).toBe(false)
  })
  it('rejects an empty title', () => {
    expect(tvVideoSchema.safeParse({ ...valid, title: '   ' }).success).toBe(false)
  })
})
