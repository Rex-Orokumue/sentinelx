import { describe, it, expect } from 'vitest'
import { stripUnsafeChars, sanitizeLabel } from './text-safety'

describe('stripUnsafeChars', () => {
  it('removes control and bidi-override characters but keeps newlines, emoji and ZWJ sequences', () => {
    expect(stripUnsafeChars('a\u0000b‮c⁦d‏e')).toBe('abcde')
    expect(stripUnsafeChars('line1\nline2\ttab')).toBe('line1\nline2\ttab')
    expect(stripUnsafeChars('👨‍👩‍👧 ok')).toBe('👨‍👩‍👧 ok')
  })
})
describe('sanitizeLabel', () => {
  it('caps length, strips unsafe characters and collapses whitespace', () => {
    expect(sanitizeLabel('  Squad‮   Alpha  ')).toBe('Squad Alpha')
    expect(sanitizeLabel('x'.repeat(100))).toHaveLength(40)
    expect(sanitizeLabel(null)).toBe('')
  })
})
