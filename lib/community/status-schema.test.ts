import { describe, it, expect } from 'vitest'
import { statusCaptionSchema, validateStatusInput } from './status-schema'

describe('statusCaptionSchema', () => {
  it('trims surrounding whitespace', () => {
    expect(statusCaptionSchema.parse('  gg  ')).toBe('gg')
  })

  it('turns a blank caption into null', () => {
    expect(statusCaptionSchema.parse('   ')).toBeNull()
    expect(statusCaptionSchema.parse('')).toBeNull()
  })

  it('accepts a 200-character caption', () => {
    const c = 'x'.repeat(200)
    expect(statusCaptionSchema.parse(c)).toBe(c)
  })

  it('rejects a 201-character caption', () => {
    const res = statusCaptionSchema.safeParse('x'.repeat(201))
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error.issues[0].message).toMatch(/under 200/i)
  })
})

describe('validateStatusInput', () => {
  it('accepts an image with no caption', () => {
    const res = validateStatusInput({ imageUrl: 'https://cdn/x.jpg' })
    expect(res).toEqual({ ok: true, data: { imageUrl: 'https://cdn/x.jpg', caption: null } })
  })

  it('accepts a caption with no image', () => {
    const res = validateStatusInput({ caption: 'up 3-0, easy' })
    expect(res).toEqual({ ok: true, data: { imageUrl: null, caption: 'up 3-0, easy' } })
  })

  it('accepts an image and a caption together', () => {
    const res = validateStatusInput({ imageUrl: 'https://cdn/x.jpg', caption: 'clutch' })
    expect(res).toEqual({ ok: true, data: { imageUrl: 'https://cdn/x.jpg', caption: 'clutch' } })
  })

  it('rejects neither image nor caption', () => {
    const res = validateStatusInput({})
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/add a photo or write something/i)
  })

  it('rejects a blank-only caption with no image', () => {
    const res = validateStatusInput({ caption: '   ' })
    expect(res.ok).toBe(false)
  })

  it('rejects an over-long caption', () => {
    const res = validateStatusInput({ caption: 'x'.repeat(201) })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/under 200/i)
  })

  it('treats a whitespace-only imageUrl as absent', () => {
    const res = validateStatusInput({ imageUrl: '  ', caption: 'hi' })
    expect(res).toEqual({ ok: true, data: { imageUrl: null, caption: 'hi' } })
  })
})
