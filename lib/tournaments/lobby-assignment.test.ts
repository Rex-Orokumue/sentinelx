import { describe, it, expect } from 'vitest'
import { assignLobbies, lobbyCountFor, lobbyLabel } from './lobby-assignment'

describe('lobbyCountFor', () => {
  it('fits everyone into as few lobbies as the size allows', () => {
    expect(lobbyCountFor(48, 48)).toBe(1)
    expect(lobbyCountFor(49, 48)).toBe(2)
    expect(lobbyCountFor(96, 48)).toBe(2)
    expect(lobbyCountFor(12, 4)).toBe(3)
  })

  it('returns zero lobbies for no entrants', () => {
    expect(lobbyCountFor(0, 48)).toBe(0)
  })

  it('never returns zero lobbies while entrants exist', () => {
    expect(lobbyCountFor(1, 48)).toBe(1)
  })

  it('treats a nonsensical lobby size as one lobby rather than dividing by zero', () => {
    expect(lobbyCountFor(10, 0)).toBe(1)
    expect(lobbyCountFor(10, -5)).toBe(1)
  })
})

describe('lobbyLabel', () => {
  it('labels lobbies A, B, C', () => {
    expect(lobbyLabel(0)).toBe('A')
    expect(lobbyLabel(1)).toBe('B')
    expect(lobbyLabel(25)).toBe('Z')
  })

  it('continues past Z without repeating a label', () => {
    expect(lobbyLabel(26)).toBe('AA')
    expect(lobbyLabel(27)).toBe('AB')
  })
})

describe('assignLobbies', () => {
  it('splits entrants across the right number of lobbies', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `e${i}`)
    const lobbies = assignLobbies(ids, 4)

    expect(lobbies).toHaveLength(3)
    expect(lobbies.map((l) => l.label)).toEqual(['A', 'B', 'C'])
    expect(lobbies.flatMap((l) => l.entrantIds)).toHaveLength(12)
  })

  it('places every entrant exactly once', () => {
    const ids = Array.from({ length: 25 }, (_, i) => `e${i}`)
    const placed = assignLobbies(ids, 8).flatMap((l) => l.entrantIds)

    expect(new Set(placed).size).toBe(25)
    expect(placed.sort()).toEqual([...ids].sort())
  })

  it('keeps lobby sizes within one of each other on an uneven split', () => {
    // 10 entrants, size 4 -> 3 lobbies. 4/3/3, never 4/4/2.
    const ids = Array.from({ length: 10 }, (_, i) => `e${i}`)
    const sizes = assignLobbies(ids, 4).map((l) => l.entrantIds.length)

    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1)
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(10)
  })

  it('never exceeds the lobby size', () => {
    const ids = Array.from({ length: 100 }, (_, i) => `e${i}`)
    for (const lobby of assignLobbies(ids, 48)) {
      expect(lobby.entrantIds.length).toBeLessThanOrEqual(48)
    }
  })

  it('seeds by snake draft so the strongest are spread, not stacked', () => {
    // Input is ordered strongest first. Ranks 1 and 2 must not share a lobby
    // while ranks 3 and 4 get an easy one.
    const ids = ['r1', 'r2', 'r3', 'r4']
    const lobbies = assignLobbies(ids, 2)

    const withR1 = lobbies.find((l) => l.entrantIds.includes('r1'))!
    expect(withR1.entrantIds).not.toContain('r2')
  })

  it('returns no lobbies for no entrants', () => {
    expect(assignLobbies([], 48)).toEqual([])
  })
})
