import { describe, it, expect } from 'vitest'
import { buildAdminPlayerWhatsAppUrl, buildFixtureContactMap } from './admin-whatsapp'

const base = {
  player: { regWhatsapp: '08012345678', profileWhatsapp: null as string | null },
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
      player: { regWhatsapp: null, profileWhatsapp: '+2348099999999' },
    })
    expect(url!.startsWith('https://wa.me/2348099999999?text=')).toBe(true)
  })

  it('falls back to the profile number when the registration number is unparseable', () => {
    const url = buildAdminPlayerWhatsAppUrl({
      ...base,
      player: { regWhatsapp: 'ask me on IG', profileWhatsapp: '08099999999' },
    })
    expect(url!.startsWith('https://wa.me/2348099999999?text=')).toBe(true)
  })

  it('prefers the registration number over the profile number', () => {
    const url = buildAdminPlayerWhatsAppUrl({
      ...base,
      player: { regWhatsapp: '08012345678', profileWhatsapp: '08099999999' },
    })
    expect(url!.startsWith('https://wa.me/2348012345678?text=')).toBe(true)
  })

  it('returns null when neither number is usable', () => {
    expect(
      buildAdminPlayerWhatsAppUrl({ ...base, player: { regWhatsapp: null, profileWhatsapp: null } }),
    ).toBeNull()
    expect(
      buildAdminPlayerWhatsAppUrl({ ...base, player: { regWhatsapp: '123', profileWhatsapp: 'nope' } }),
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

describe('opponent contact block', () => {
  const base = {
    player: { regWhatsapp: '08012345678', profileWhatsapp: null as string | null },
    playerName: 'Chidi',
    opponentName: 'Tunde',
    tournamentTitle: 'DLS Cup 4',
    scheduledAt: '2026-07-08T19:00:00Z',
    isFullDay: false,
  }

  it("appends the opponent's readable number and a tap-to-chat link", () => {
    const url = buildAdminPlayerWhatsAppUrl({
      ...base,
      opponentPhone: { waNumber: '2348087654321', e164: '+2348087654321', display: '+234 808 765 4321' },
    })!
    const text = decodeURIComponent(url.split('?text=')[1])
    expect(text).toContain('Tunde: +234 808 765 4321')
    expect(text).toContain('Message them: https://wa.me/2348087654321')
    // The chase message itself still comes first.
    expect(text.indexOf('Hi Chidi')).toBeLessThan(text.indexOf('Tunde: +234'))
  })

  it('omits the block entirely when the opponent is unreachable', () => {
    const text = decodeURIComponent(
      buildAdminPlayerWhatsAppUrl({ ...base, opponentPhone: null })!.split('?text=')[1],
    )
    expect(text).not.toContain('Message them:')
    expect(text.trimEnd()).toBe(text)
  })
})

describe('country-aware resolution', () => {
  const fixture = {
    id: 'm1',
    playerA: { id: 'pa', name: 'Kip' },
    playerB: { id: 'pb', name: 'Chidi' },
    scheduled_at: '2026-07-08T19:00:00Z',
    is_full_day: false,
  }

  it("parses a player's national-format number against their own country", () => {
    const map = buildFixtureContactMap({
      fixtures: [fixture],
      tournamentTitle: 'DLS Cup 4',
      // A Kenyan national number: mangled into a wrong Nigerian one before this.
      regWhatsappByPlayer: new Map([['pa', '0712345678']]),
      profileWhatsappByPlayer: new Map(),
      countryByPlayer: new Map([['pa', 'Kenya']]),
    })
    expect(map.m1.a!.startsWith('https://wa.me/254712345678?text=')).toBe(true)
  })

  it('falls through to the profile number when the registration one is foreign-invalid', () => {
    const map = buildFixtureContactMap({
      fixtures: [fixture],
      tournamentTitle: 'DLS Cup 4',
      regWhatsappByPlayer: new Map([['pa', '0712345678']]), // invalid as Nigerian
      profileWhatsappByPlayer: new Map([['pa', '+254712345678']]),
      countryByPlayer: new Map(), // country unknown => Nigeria
    })
    expect(map.m1.a!.startsWith('https://wa.me/254712345678?text=')).toBe(true)
  })

  it("carries each player's number into their opponent's message", () => {
    const map = buildFixtureContactMap({
      fixtures: [fixture],
      tournamentTitle: 'DLS Cup 4',
      regWhatsappByPlayer: new Map([
        ['pa', '+254712345678'],
        ['pb', '08012345678'],
      ]),
      profileWhatsappByPlayer: new Map(),
    })
    // Kip's message carries Chidi's number, and vice versa.
    expect(decodeURIComponent(map.m1.a!.split('?text=')[1])).toContain(
      'Message them: https://wa.me/2348012345678',
    )
    expect(decodeURIComponent(map.m1.b!.split('?text=')[1])).toContain(
      'Message them: https://wa.me/254712345678',
    )
  })
})
