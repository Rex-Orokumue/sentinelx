import { describe, it, expect } from 'vitest'
import { truncateCaption } from './gallery-query'

describe('truncateCaption', () => {
  it('returns short content unchanged', () => {
    expect(truncateCaption('Epic goal!')).toBe('Epic goal!')
  })

  it('truncates long content with an ellipsis at the max length', () => {
    const long = 'This is a really long post caption that goes well past the default limit'
    expect(truncateCaption(long, 20)).toBe('This is a really lon…')
  })

  it('trims trailing whitespace before adding the ellipsis', () => {
    expect(truncateCaption('word word word word', 10)).toBe('word word…')
  })

  it('trims surrounding whitespace on short content too', () => {
    expect(truncateCaption('  padded  ')).toBe('padded')
  })
})
