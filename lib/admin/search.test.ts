import { describe, it, expect } from 'vitest'
import { matchesPlayerQuery } from './search'

describe('matchesPlayerQuery', () => {
  it('matches a blank query against anything', () => {
    expect(matchesPlayerQuery({ username: 'zee', displayName: null, clubName: null }, '')).toBe(true)
    expect(matchesPlayerQuery({ username: null, displayName: null, clubName: null }, '')).toBe(true)
  })

  it('matches a case-insensitive username substring', () => {
    expect(matchesPlayerQuery({ username: 'DarkStrikerNG', displayName: null, clubName: null }, 'strike')).toBe(
      true,
    )
  })

  it('matches a case-insensitive display name substring', () => {
    expect(
      matchesPlayerQuery({ username: null, displayName: 'Samuel Okoro', clubName: null }, 'okoro'),
    ).toBe(true)
  })

  it('matches a case-insensitive club name substring', () => {
    expect(
      matchesPlayerQuery({ username: 'x', displayName: null, clubName: 'Lagos Ronin' }, 'ronin'),
    ).toBe(true)
  })

  it('returns false when nothing matches', () => {
    expect(
      matchesPlayerQuery({ username: 'zee', displayName: 'Zee Player', clubName: 'Ronin' }, 'nomatch'),
    ).toBe(false)
  })

  it('does not crash when all fields are null and query is non-empty', () => {
    expect(matchesPlayerQuery({ username: null, displayName: null, clubName: null }, 'x')).toBe(false)
  })

  it('trims and ignores leading/trailing whitespace in the query', () => {
    expect(matchesPlayerQuery({ username: 'zee', displayName: null, clubName: null }, '  zee  ')).toBe(
      true,
    )
  })
})
