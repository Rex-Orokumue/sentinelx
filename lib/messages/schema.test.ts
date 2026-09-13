import { describe, it, expect } from 'vitest'
import { messageBodySchema, reportReasonSchema } from './schema'

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
