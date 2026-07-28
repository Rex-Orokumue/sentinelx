import { describe, it, expect } from 'vitest'
import { disqualifySchema, substituteSchema } from './disqualify-schema'

describe('disqualifySchema', () => {
  it('requires a non-empty reason', () => {
    expect(disqualifySchema.safeParse({ reason: '' }).success).toBe(false)
    expect(disqualifySchema.safeParse({ reason: '  ' }).success).toBe(false)
  })
  it('accepts a real reason and trims it', () => {
    const parsed = disqualifySchema.safeParse({ reason: '  Repeated no-shows  ' })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.reason).toBe('Repeated no-shows')
  })
  it('rejects an overly long reason', () => {
    expect(disqualifySchema.safeParse({ reason: 'x'.repeat(301) }).success).toBe(false)
  })
})

describe('substituteSchema', () => {
  it('requires a non-empty username', () => {
    expect(substituteSchema.safeParse({ username: '' }).success).toBe(false)
  })
  it('accepts and trims a username', () => {
    const parsed = substituteSchema.safeParse({ username: '  NewPlayer  ' })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.username).toBe('NewPlayer')
  })
})
