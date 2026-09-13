import { describe, it, expect } from 'vitest'
import { messageBodySchema, reportReasonSchema, audioDurationSchema } from './schema'

describe('messageBodySchema', () => {
  it('trims', () => {
    expect(messageBodySchema.parse('  hi  ')).toBe('hi')
  })
  it('rejects empty / whitespace', () => {
    expect(messageBodySchema.safeParse('   ').success).toBe(false)
  })
  it('rejects over 2000 chars', () => {
    const res = messageBodySchema.safeParse('x'.repeat(2001))
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error.issues[0].message).toMatch(/under 2000/i)
  })
  it('accepts exactly 2000', () => {
    expect(messageBodySchema.parse('x'.repeat(2000))).toHaveLength(2000)
  })
})

describe('reportReasonSchema', () => {
  it('rejects empty', () => {
    expect(reportReasonSchema.safeParse('').success).toBe(false)
  })
  it('accepts a short reason', () => {
    expect(reportReasonSchema.parse('  harassment ')).toBe('harassment')
  })
})

describe('audioDurationSchema', () => {
  it('accepts a typical duration', () => {
    expect(audioDurationSchema.parse(45)).toBe(45)
  })
  it('rejects zero, negative, and non-integer values', () => {
    expect(audioDurationSchema.safeParse(0).success).toBe(false)
    expect(audioDurationSchema.safeParse(-1).success).toBe(false)
    expect(audioDurationSchema.safeParse(1.5).success).toBe(false)
  })
  it('accepts up to the 130s ceiling and rejects beyond it', () => {
    expect(audioDurationSchema.safeParse(130).success).toBe(true)
    expect(audioDurationSchema.safeParse(131).success).toBe(false)
  })
})
