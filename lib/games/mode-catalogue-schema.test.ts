import { describe, it, expect } from 'vitest'
import { modeSchema, formatSchema, mapSchema, matchRuleSchema, matchTypeSchema } from './mode-catalogue-schema'

describe('modeSchema', () => {
  it('requires a name', () => {
    expect(modeSchema.safeParse({ name: '', competitionFormat: 'head_to_head' }).success).toBe(false)
  })
  it('rejects a competition format outside the two the DB permits', () => {
    expect(modeSchema.safeParse({ name: 'Battle Royale', competitionFormat: 'nonsense' }).success).toBe(false)
  })
  it('accepts a valid mode', () => {
    expect(modeSchema.safeParse({ name: 'Battle Royale', competitionFormat: 'points_race' }).success).toBe(true)
  })
})

describe('formatSchema', () => {
  it('rejects a team size outside 1-6', () => {
    expect(formatSchema.safeParse({ name: 'Squad', entryUnit: 'squad', teamSize: 8, available: false }).success).toBe(false)
  })
  it('coerces a string team size from form data', () => {
    const r = formatSchema.safeParse({ name: 'Duo', entryUnit: 'squad', teamSize: '2', available: false })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.teamSize).toBe(2)
  })
})

describe('mapSchema', () => {
  it('requires a name', () => {
    expect(mapSchema.safeParse({ name: '' }).success).toBe(false)
  })
})

describe('matchRuleSchema', () => {
  it('requires a name', () => {
    expect(matchRuleSchema.safeParse({ name: '' }).success).toBe(false)
  })
})

describe('matchTypeSchema', () => {
  it('requires a name', () => {
    expect(matchTypeSchema.safeParse({ name: '', available: false }).success).toBe(false)
  })
  it('accepts a valid match type', () => {
    expect(matchTypeSchema.safeParse({ name: 'Best of 7', available: false }).success).toBe(true)
  })
})
