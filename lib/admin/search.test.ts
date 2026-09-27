import { describe, it, expect } from 'vitest'
import { matchesPlayerQuery } from './search'

describe('matchesPlayerQuery', () => {
  it('matches a blank query against anything', () => {
    expect(matchesPlayerQuery({ username: 'zee', displayName: null, registrationDetails: null }, '')).toBe(true)
    expect(matchesPlayerQuery({ username: null, displayName: null, registrationDetails: null }, '')).toBe(true)
  })

  it('matches a case-insensitive username substring', () => {
    expect(matchesPlayerQuery({ username: 'DarkStrikerNG', displayName: null, registrationDetails: null }, 'strike')).toBe(true)
  })

  it('matches a case-insensitive display name substring', () => {
    expect(matchesPlayerQuery({ username: null, displayName: 'Samuel Okoro', registrationDetails: null }, 'okoro')).toBe(true)
  })

  it('matches a case-insensitive value inside registrationDetails', () => {
    expect(
      matchesPlayerQuery({ username: 'x', displayName: null, registrationDetails: { club_name: 'Lagos Ronin' } }, 'ronin'),
    ).toBe(true)
  })

  it('matches any value inside registrationDetails, not just a fixed clubName field', () => {
    expect(
      matchesPlayerQuery({ username: 'ada', displayName: null, registrationDetails: { in_game_uid: '778899' } }, '7788'),
    ).toBe(true)
  })

  it('returns false when nothing matches', () => {
    expect(
      matchesPlayerQuery({ username: 'zee', displayName: 'Zee Player', registrationDetails: { club_name: 'Ronin' } }, 'nomatch'),
    ).toBe(false)
  })

  it('does not crash when all fields are null and query is non-empty', () => {
    expect(matchesPlayerQuery({ username: null, displayName: null, registrationDetails: null }, 'x')).toBe(false)
  })

  it('trims and ignores leading/trailing whitespace in the query', () => {
    expect(matchesPlayerQuery({ username: 'zee', displayName: null, registrationDetails: null }, '  zee  ')).toBe(true)
  })
})
