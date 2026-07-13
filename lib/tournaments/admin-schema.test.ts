import { describe, it, expect } from 'vitest'
import { tournamentSchema } from './admin-schema'

const valid = {
  title: 'DLS Cup',
  gameId: '11111111-1111-4111-8111-111111111111',
  slug: '',
  description: '',
  bannerUrl: '',
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
})
