import { describe, it, expect } from 'vitest'
import { gameSchema } from './schema'

const valid = { name: 'EA FC Mobile', category: 'football', iconUrl: '' }

describe('gameSchema', () => {
  it('accepts a valid submission', () => {
    expect(gameSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects a missing name', () => {
    expect(gameSchema.safeParse({ ...valid, name: '  ' }).success).toBe(false)
  })

  it('rejects an invalid category', () => {
    expect(gameSchema.safeParse({ ...valid, category: 'racing' }).success).toBe(false)
  })

  it('accepts each valid category', () => {
    for (const category of ['football', 'fighting', 'shooter', 'other']) {
      expect(gameSchema.safeParse({ ...valid, category }).success).toBe(true)
    }
  })

  it('accepts an empty icon URL', () => {
    expect(gameSchema.safeParse({ ...valid, iconUrl: '' }).success).toBe(true)
  })

  it('rejects a malformed icon URL', () => {
    expect(gameSchema.safeParse({ ...valid, iconUrl: 'not-a-url' }).success).toBe(false)
  })
})
