import { describe, it, expect } from 'vitest'
import { squadNameSchema, inviteCodeSchema } from './squad-schema'

describe('squadNameSchema', () => {
  it('accepts a 2-30 character name, trimmed', () => {
    expect(squadNameSchema.parse('  Lagos Vipers  ')).toBe('Lagos Vipers')
  })
  it('rejects a 1-character name', () => {
    expect(squadNameSchema.safeParse('A').success).toBe(false)
  })
  it('rejects a 31-character name', () => {
    expect(squadNameSchema.safeParse('A'.repeat(31)).success).toBe(false)
  })
})

describe('inviteCodeSchema', () => {
  it('uppercases and accepts a valid code', () => {
    expect(inviteCodeSchema.parse(' abcdefgh ')).toBe('ABCDEFGH')
  })
  it('rejects a code with a banned character', () => {
    expect(inviteCodeSchema.safeParse('ABCDEFG0').success).toBe(false)
  })
})
