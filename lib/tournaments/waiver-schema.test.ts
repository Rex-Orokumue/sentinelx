import { describe, it, expect } from 'vitest'
import { waiverGrantSchema } from './waiver-schema'

describe('waiverGrantSchema', () => {
  it('accepts a username with no reason', () => {
    const r = waiverGrantSchema.safeParse({ username: 'DarkStrikerNG', reason: '' })
    expect(r.success).toBe(true)
  })

  it('accepts a username with a reason', () => {
    const r = waiverGrantSchema.safeParse({ username: 'DarkStrikerNG', reason: 'Season 1 champion' })
    expect(r.success).toBe(true)
  })

  it('requires a non-empty username', () => {
    expect(waiverGrantSchema.safeParse({ username: '  ', reason: '' }).success).toBe(false)
  })

  it('trims surrounding whitespace from username', () => {
    const r = waiverGrantSchema.safeParse({ username: '  DarkStrikerNG  ', reason: '' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.username).toBe('DarkStrikerNG')
  })

  it('rejects a reason over 200 characters', () => {
    expect(
      waiverGrantSchema.safeParse({ username: 'DarkStrikerNG', reason: 'x'.repeat(201) }).success,
    ).toBe(false)
  })
})
