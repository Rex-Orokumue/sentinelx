import { describe, it, expect } from 'vitest'
import { tournamentSchema } from './admin-schema'

const valid = {
  title: 'DLS Cup',
  gameId: '11111111-1111-4111-8111-111111111111',
  slug: '',
  description: '',
  bannerUrl: '',
  cardImageUrl: '',
  registrationFee: '500',
  prizePool: '0',
  maxPlayers: '16',
  registrationStart: '',
  registrationEnd: '',
  tournamentStart: '2026-08-01T18:00',
  tournamentEnd: '',
  rules: '',
  dataSupportText: '',
  dataSupportWhatsapp: '',
  tournamentType: 'open' as const,
  seasonId: '',
}

describe('tournamentSchema', () => {
  it('accepts a valid tournament and coerces numbers', () => {
    const r = tournamentSchema.safeParse(valid)
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.registrationFee).toBe(500)
      expect(r.data.maxPlayers).toBe(16)
    }
  })
  it('requires a title', () => {
    expect(tournamentSchema.safeParse({ ...valid, title: '  ' }).success).toBe(false)
  })
  it('requires a uuid game', () => {
    expect(tournamentSchema.safeParse({ ...valid, gameId: 'dls' }).success).toBe(false)
  })
  it('allows an empty maxPlayers but rejects out-of-range', () => {
    expect(tournamentSchema.safeParse({ ...valid, maxPlayers: '' }).success).toBe(true)
    expect(tournamentSchema.safeParse({ ...valid, maxPlayers: '1' }).success).toBe(false)
    expect(tournamentSchema.safeParse({ ...valid, maxPlayers: '65' }).success).toBe(false)
  })
  it('rejects a malformed date', () => {
    expect(tournamentSchema.safeParse({ ...valid, tournamentStart: 'next week' }).success).toBe(
      false,
    )
  })
  it('rejects a non-url banner', () => {
    expect(tournamentSchema.safeParse({ ...valid, bannerUrl: 'notaurl' }).success).toBe(false)
  })
  it('accepts a Markdown rules string and leaves it as-is', () => {
    const r = tournamentSchema.safeParse({ ...valid, rules: '**No smurfing.**\n\n- Best of 3' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.rules).toBe('**No smurfing.**\n\n- Best of 3')
  })
  it('allows an empty rules field', () => {
    expect(tournamentSchema.safeParse({ ...valid, rules: '' }).success).toBe(true)
  })
  it('requires a season when tournamentType is not open', () => {
    expect(
      tournamentSchema.safeParse({ ...valid, tournamentType: 'community_club', seasonId: '' }).success,
    ).toBe(false)
  })
  it('accepts a season tournament with a seasonId', () => {
    expect(
      tournamentSchema.safeParse({
        ...valid,
        tournamentType: 'masters',
        seasonId: '11111111-1111-4111-8111-111111111111',
      }).success,
    ).toBe(true)
  })
  it('rejects an unknown tournamentType', () => {
    expect(tournamentSchema.safeParse({ ...valid, tournamentType: 'bogus' }).success).toBe(false)
  })
  it('defaults format to group_knockout when omitted, and accepts round_robin', () => {
    const r1 = tournamentSchema.safeParse(valid)
    expect(r1.success).toBe(true)
    if (r1.success) expect(r1.data.format).toBe('group_knockout')

    const r2 = tournamentSchema.safeParse({ ...valid, format: 'round_robin' })
    expect(r2.success).toBe(true)
    if (r2.success) expect(r2.data.format).toBe('round_robin')
  })
  it('rejects an unknown format', () => {
    expect(tournamentSchema.safeParse({ ...valid, format: 'bogus' }).success).toBe(false)
  })
  it('defaults manualKnockoutPairing to false and coerces a "true" checkbox value', () => {
    const r1 = tournamentSchema.safeParse(valid)
    expect(r1.success).toBe(true)
    if (r1.success) expect(r1.data.manualKnockoutPairing).toBe(false)

    const r2 = tournamentSchema.safeParse({ ...valid, manualKnockoutPairing: 'true' })
    expect(r2.success && r2.data.manualKnockoutPairing).toBe(true)

    const r3 = tournamentSchema.safeParse({ ...valid, manualKnockoutPairing: 'false' })
    expect(r3.success && r3.data.manualKnockoutPairing).toBe(false)
  })
  it('defaults prizeSecond/prizeThird to empty and accepts numeric values', () => {
    const r1 = tournamentSchema.safeParse(valid)
    expect(r1.success).toBe(true)
    if (r1.success) {
      expect(r1.data.prizeSecond).toBe('')
      expect(r1.data.prizeThird).toBe('')
    }

    const r2 = tournamentSchema.safeParse({ ...valid, prizePool: '15000', prizeSecond: '4000', prizeThird: '3000' })
    expect(r2.success).toBe(true)
    if (r2.success) {
      expect(r2.data.prizeSecond).toBe(4000)
      expect(r2.data.prizeThird).toBe(3000)
    }
  })
})
