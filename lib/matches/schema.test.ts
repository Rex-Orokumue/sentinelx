import { describe, it, expect } from 'vitest'
import { submitResultSchema } from './schema'

describe('submitResultSchema', () => {
  it('accepts valid scores with an empty recording URL', () => {
    const r = submitResultSchema.safeParse({ scoreA: '3', scoreB: '1', recordingUrl: '' })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.scoreA).toBe(3)
      expect(r.data.scoreB).toBe(1)
    }
  })

  it('accepts a valid https recording URL', () => {
    const r = submitResultSchema.safeParse({ scoreA: '2', scoreB: '2', recordingUrl: 'https://youtu.be/abc' })
    expect(r.success).toBe(true)
  })

  it('rejects negative scores', () => {
    expect(submitResultSchema.safeParse({ scoreA: '-1', scoreB: '0', recordingUrl: '' }).success).toBe(false)
  })

  it('rejects non-numeric scores', () => {
    expect(submitResultSchema.safeParse({ scoreA: 'x', scoreB: '0', recordingUrl: '' }).success).toBe(false)
  })

  it('rejects a non-http(s) recording URL', () => {
    expect(submitResultSchema.safeParse({ scoreA: '1', scoreB: '0', recordingUrl: 'ftp://x/y' }).success).toBe(false)
  })

  it('allows recordingUrl to be omitted', () => {
    expect(submitResultSchema.safeParse({ scoreA: '1', scoreB: '0' }).success).toBe(true)
  })
})
