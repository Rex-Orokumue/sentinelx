import { describe, it, expect } from 'vitest'
import { buildAdminPlayerWhatsAppUrl, buildFixtureContactMap } from './admin-whatsapp'

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

describe('buildFixtureContactMap', () => {
  const fixture = {
    id: 'm1',
    playerA: { id: 'pa', name: 'Chidi' },
    playerB: { id: 'pb', name: 'Tunde' },
    scheduled_at: '2026-07-08T19:00:00Z',
    is_full_day: false,
  }

  it('keys by match id and addresses each player about the other', () => {
    const map = buildFixtureContactMap({
      fixtures: [fixture],
      tournamentTitle: 'DLS Cup 4',
      regWhatsappByPlayer: new Map([
        ['pa', '08012345678'],
        ['pb', '08087654321'],
      ]),
      profileWhatsappByPlayer: new Map(),
    })
    expect(Object.keys(map)).toEqual(['m1'])
    expect(map.m1.a!.startsWith('https://wa.me/2348012345678?text=')).toBe(true)
    expect(map.m1.b!.startsWith('https://wa.me/2348087654321?text=')).toBe(true)
    expect(decodeURIComponent(map.m1.a!.split('?text=')[1])).toContain('Hi Chidi')
    expect(decodeURIComponent(map.m1.a!.split('?text=')[1])).toContain('vs Tunde')
    expect(decodeURIComponent(map.m1.b!.split('?text=')[1])).toContain('Hi Tunde')
    expect(decodeURIComponent(map.m1.b!.split('?text=')[1])).toContain('vs Chidi')
  })

  it('nulls only the unreachable side, keeping the other usable', () => {
    const map = buildFixtureContactMap({
      fixtures: [fixture],
      tournamentTitle: 'DLS Cup 4',
      regWhatsappByPlayer: new Map([['pa', '08012345678']]),
      profileWhatsappByPlayer: new Map(),
    })
    expect(map.m1.a).not.toBeNull()
    expect(map.m1.b).toBeNull()
  })

  it('falls back to the profile number per player', () => {
    const map = buildFixtureContactMap({
      fixtures: [fixture],
      tournamentTitle: 'DLS Cup 4',
      regWhatsappByPlayer: new Map(),
      profileWhatsappByPlayer: new Map([['pb', '08087654321']]),
    })
    expect(map.m1.a).toBeNull()
    expect(map.m1.b!.startsWith('https://wa.me/2348087654321?text=')).toBe(true)
  })

  it('carries each fixture own schedule state into its message', () => {
    const map = buildFixtureContactMap({
      fixtures: [fixture, { ...fixture, id: 'm2', scheduled_at: null }],
      tournamentTitle: 'DLS Cup 4',
      regWhatsappByPlayer: new Map([['pa', '08012345678']]),
      profileWhatsappByPlayer: new Map(),
    })
    expect(decodeURIComponent(map.m1.a!.split('?text=')[1])).toContain('is scheduled for 8 Jul, 20:00')
    expect(decodeURIComponent(map.m2.a!.split('?text=')[1])).toContain("It's not scheduled yet")
  })

  it('returns an empty map for no fixtures', () => {
    expect(
      buildFixtureContactMap({
        fixtures: [],
        tournamentTitle: 'DLS Cup 4',
        regWhatsappByPlayer: new Map(),
        profileWhatsappByPlayer: new Map(),
      }),
    ).toEqual({})
  })
})
