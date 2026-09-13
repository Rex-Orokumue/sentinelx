import { describe, it, expect } from 'vitest'
import { generateInviteCode, isValidInviteCodeShape, autoGroupIntoSquads, squadNameFor } from './squad-lifecycle'

describe('generateInviteCode', () => {
  it('produces an 8-character code from the unambiguous alphabet', () => {
    const code = generateInviteCode(() => 0.5)
    expect(code).toHaveLength(8)
    expect(isValidInviteCodeShape(code)).toBe(true)
  })

  it('never emits an easily-confused character', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateInviteCode(() => i / 50)
      expect(code).not.toMatch(/[0O1IL]/)
    }
  })
})

describe('isValidInviteCodeShape', () => {
  it('accepts an 8-char uppercase code from the alphabet', () => {
    expect(isValidInviteCodeShape('ABCDEFGH')).toBe(true)
  })
  it('rejects the wrong length, lowercase, or a banned character', () => {
    expect(isValidInviteCodeShape('ABCDEFG')).toBe(false)
    expect(isValidInviteCodeShape('abcdefgh')).toBe(false)
    expect(isValidInviteCodeShape('ABCDEFG0')).toBe(false)
  })
})

describe('autoGroupIntoSquads', () => {
  it('splits an exact multiple of teamSize into full groups with no leftover', () => {
    const players = Array.from({ length: 8 }, (_, i) => `p${i}`)
    const { groups, leftover } = autoGroupIntoSquads(players, 4, () => 0.5)
    expect(groups).toHaveLength(2)
    expect(groups[0]).toHaveLength(4)
    expect(groups[1]).toHaveLength(4)
    expect(leftover).toHaveLength(0)
  })

  it('surfaces players that do not fill a final group as leftover, never as an undersized group', () => {
    const players = Array.from({ length: 10 }, (_, i) => `p${i}`)
    const { groups, leftover } = autoGroupIntoSquads(players, 4, () => 0.5)
    expect(groups).toHaveLength(2)
    expect(groups.every((g) => g.length === 4)).toBe(true)
    expect(leftover).toHaveLength(2)
  })

  it('every player appears in exactly one group or the leftover list', () => {
    const players = Array.from({ length: 11 }, (_, i) => `p${i}`)
    const { groups, leftover } = autoGroupIntoSquads(players, 4)
    const seen = [...groups.flat(), ...leftover].sort()
    expect(seen).toEqual([...players].sort())
  })

  it('returns everyone as leftover when teamSize is not positive', () => {
    const { groups, leftover } = autoGroupIntoSquads(['a', 'b'], 0)
    expect(groups).toEqual([])
    expect(leftover).toEqual(['a', 'b'])
  })
})

describe('squadNameFor', () => {
  it('numbers squads sequentially', () => {
    expect(squadNameFor(1)).toBe('Squad 1')
    expect(squadNameFor(12)).toBe('Squad 12')
  })
})
