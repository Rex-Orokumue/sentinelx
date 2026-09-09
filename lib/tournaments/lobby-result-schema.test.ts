import { describe, it, expect } from 'vitest'
import { lobbyResultSchema } from './lobby-result-schema'

const valid = { placement: '3', kills: '7' }

describe('lobbyResultSchema', () => {
  it('accepts a placement and kill count', () => {
    const r = lobbyResultSchema.safeParse(valid)
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.placement).toBe(3)
      expect(r.data.kills).toBe(7)
    }
  })

  it('accepts zero kills', () => {
    // Dying first with no kills is a real result, not a missing one.
    expect(lobbyResultSchema.safeParse({ placement: '12', kills: '0' }).success).toBe(true)
  })

  it('rejects a placement below 1', () => {
    // Placement is 1-indexed: 1 is the Booyah/WWCD. There is no 0th place.
    expect(lobbyResultSchema.safeParse({ ...valid, placement: '0' }).success).toBe(false)
  })

  it('rejects negative kills', () => {
    expect(lobbyResultSchema.safeParse({ ...valid, kills: '-1' }).success).toBe(false)
  })

  it('rejects non-integers', () => {
    expect(lobbyResultSchema.safeParse({ ...valid, placement: '2.5' }).success).toBe(false)
    expect(lobbyResultSchema.safeParse({ ...valid, kills: 'lots' }).success).toBe(false)
  })

  it('rejects absurd values that are almost certainly typos', () => {
    // 100 is the largest lobby the schema allows (stages_lobby_range), so a
    // placement above it cannot be real.
    expect(lobbyResultSchema.safeParse({ ...valid, placement: '500' }).success).toBe(false)
    expect(lobbyResultSchema.safeParse({ ...valid, kills: '500' }).success).toBe(false)
  })
})
