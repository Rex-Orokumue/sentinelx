import { describe, it, expect } from 'vitest'
import { missingForPublish, type PublishableTournament } from './readiness'

function t(over: Partial<PublishableTournament> = {}): PublishableTournament {
  return {
    gameId: 'g1',
    maxPlayers: 16,
    registrationFee: 500,
    prizePool: 10000,
    dates: ['2026-08-01T10:00', null, null, null],
    ...over,
  }
}

describe('missingForPublish', () => {
  it('returns [] for a fully-configured tournament', () => {
    expect(missingForPublish(t())).toEqual([])
  })
  it('flags a missing game', () => {
    expect(missingForPublish(t({ gameId: null }))).toContain('game')
  })
  it('flags missing max players', () => {
    expect(missingForPublish(t({ maxPlayers: null }))).toContain('max players')
  })
  it('flags missing fee and prize', () => {
    const m = missingForPublish(t({ registrationFee: null, prizePool: null }))
    expect(m).toContain('registration fee')
    expect(m).toContain('prize pool')
  })
  it('flags no scheduled date when all four are absent', () => {
    expect(missingForPublish(t({ dates: [null, '', null, ''] }))).toContain(
      'at least one scheduled date',
    )
  })
  it('accepts a single populated date', () => {
    expect(missingForPublish(t({ dates: [null, null, '2026-09-01T10:00', null] }))).toEqual([])
  })
})
