import { describe, it, expect } from 'vitest'
import { parsePlacementList, stageSchema } from './stage-schema'

const valid = {
  name: 'Qualifiers',
  roundsCount: '3',
  lobbySize: '48',
  advanceCount: '24',
  placementPoints: '12, 9, 8, 7, 6, 5, 4, 3, 2, 1',
  perKill: '1',
}

describe('parsePlacementList', () => {
  it('reads a comma-separated table', () => {
    expect(parsePlacementList('12, 9, 8')).toEqual([12, 9, 8])
  })

  it('reads a space-separated table', () => {
    // Admins paste these out of rulebooks; the separator varies.
    expect(parsePlacementList('12 9 8')).toEqual([12, 9, 8])
  })

  it('tolerates trailing separators and extra whitespace', () => {
    expect(parsePlacementList(' 12,  9 , 8 , ')).toEqual([12, 9, 8])
  })

  it('returns null for anything non-numeric', () => {
    expect(parsePlacementList('12, nine, 8')).toBeNull()
  })

  it('returns null for negative points', () => {
    expect(parsePlacementList('12, -9')).toBeNull()
  })

  it('returns null for an empty table', () => {
    // A placement table with no entries would score every placing zero, which
    // is never what an admin means.
    expect(parsePlacementList('')).toBeNull()
    expect(parsePlacementList('   ')).toBeNull()
  })
})

describe('stageSchema', () => {
  it('accepts a well-formed stage and coerces the numbers', () => {
    const r = stageSchema.safeParse(valid)
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.roundsCount).toBe(3)
      expect(r.data.lobbySize).toBe(48)
      expect(r.data.advanceCount).toBe(24)
      expect(r.data.placementPoints).toEqual([12, 9, 8, 7, 6, 5, 4, 3, 2, 1])
      expect(r.data.perKill).toBe(1)
    }
  })

  it('requires a name', () => {
    expect(stageSchema.safeParse({ ...valid, name: '  ' }).success).toBe(false)
  })

  it('rejects a malformed placement table with a readable message', () => {
    const r = stageSchema.safeParse({ ...valid, placementPoints: '12, nine' })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0].path).toContain('placementPoints')
  })

  it('mirrors the database ranges', () => {
    // Same bounds as stages_rounds_range / stages_lobby_range, so an admin gets
    // a sentence rather than a constraint name.
    expect(stageSchema.safeParse({ ...valid, roundsCount: '0' }).success).toBe(false)
    expect(stageSchema.safeParse({ ...valid, roundsCount: '21' }).success).toBe(false)
    expect(stageSchema.safeParse({ ...valid, lobbySize: '1' }).success).toBe(false)
    expect(stageSchema.safeParse({ ...valid, lobbySize: '101' }).success).toBe(false)
    expect(stageSchema.safeParse({ ...valid, advanceCount: '0' }).success).toBe(false)
  })

  it('allows a placement-only ruleset', () => {
    const r = stageSchema.safeParse({ ...valid, perKill: '0' })
    expect(r.success).toBe(true)
  })
})
