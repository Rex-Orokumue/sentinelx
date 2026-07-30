import { describe, it, expect } from 'vitest'
import { buildAdminPlayerWhatsAppUrl } from './admin-whatsapp'

const base = {
  regWhatsapp: '08012345678',
  profileWhatsapp: null,
  playerName: 'Chidi',
  opponentName: 'Tunde',
  tournamentTitle: 'DLS Cup 4',
  scheduledAt: '2026-07-08T19:00:00Z',
  isFullDay: false,
}

function textOf(url: string): string {
  return decodeURIComponent(url.split('?text=')[1])
}

describe('buildAdminPlayerWhatsAppUrl', () => {
  it('builds a wa.me link with the date + time for a timed fixture', () => {
    const url = buildAdminPlayerWhatsAppUrl(base)!
    expect(url.startsWith('https://wa.me/2348012345678?text=')).toBe(true)
    expect(textOf(url)).toBe(
      'Hi Chidi — SentinelX admin here. Your DLS Cup 4 match vs Tunde is scheduled for ' +
        "8 Jul, 20:00. Please confirm you'll be ready to play.",
    )
  })

  it('says "any time that day" for a full-day fixture and omits the time', () => {
    const text = textOf(buildAdminPlayerWhatsAppUrl({ ...base, isFullDay: true })!)
    expect(text).toBe(
      'Hi Chidi — SentinelX admin here. Your DLS Cup 4 match vs Tunde is scheduled for ' +
        "8 Jul 2026 — you can play any time that day. Please confirm you'll be ready.",
    )
  })

  it('asks for availability when the fixture has no date yet', () => {
    const text = textOf(buildAdminPlayerWhatsAppUrl({ ...base, scheduledAt: null })!)
    expect(text).toBe(
      'Hi Chidi — SentinelX admin here about your DLS Cup 4 match vs Tunde. ' +
        "It's not scheduled yet — when are you available to play?",
    )
  })

  it('falls back to the profile number when the registration has none', () => {
    const url = buildAdminPlayerWhatsAppUrl({
      ...base,
      regWhatsapp: null,
      profileWhatsapp: '+2348099999999',
    })
    expect(url!.startsWith('https://wa.me/2348099999999?text=')).toBe(true)
  })

  it('falls back to the profile number when the registration number is unparseable', () => {
    const url = buildAdminPlayerWhatsAppUrl({
      ...base,
      regWhatsapp: 'ask me on IG',
      profileWhatsapp: '08099999999',
    })
    expect(url!.startsWith('https://wa.me/2348099999999?text=')).toBe(true)
  })

  it('prefers the registration number over the profile number', () => {
    const url = buildAdminPlayerWhatsAppUrl({ ...base, profileWhatsapp: '08099999999' })
    expect(url!.startsWith('https://wa.me/2348012345678?text=')).toBe(true)
  })

  it('returns null when neither number is usable', () => {
    expect(
      buildAdminPlayerWhatsAppUrl({ ...base, regWhatsapp: null, profileWhatsapp: null }),
    ).toBeNull()
    expect(
      buildAdminPlayerWhatsAppUrl({ ...base, regWhatsapp: '123', profileWhatsapp: 'nope' }),
    ).toBeNull()
  })

  it('uses "your opponent" when the opposing player is not yet decided', () => {
    const text = textOf(buildAdminPlayerWhatsAppUrl({ ...base, opponentName: null })!)
    expect(text).toContain('match vs your opponent is scheduled for')
  })
})
