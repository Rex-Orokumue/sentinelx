import { describe, it, expect } from 'vitest'
import {
  staticSitemapEntries,
  tournamentSitemapEntry,
  playerSitemapEntry,
  matchSitemapEntry,
  listingSitemapEntry,
} from './sitemap-entries'
import { SITE_URL } from './site'

describe('staticSitemapEntries', () => {
  it('includes every top-level public route', () => {
    const urls = staticSitemapEntries().map((e) => e.url)
    expect(urls).toEqual([
      `${SITE_URL}/`,
      `${SITE_URL}/tournaments`,
      `${SITE_URL}/players`,
      `${SITE_URL}/rankings`,
      `${SITE_URL}/hall-of-fame`,
      `${SITE_URL}/tv`,
      `${SITE_URL}/exchange`,
      `${SITE_URL}/community`,
    ])
  })
})

describe('tournamentSitemapEntry', () => {
  it('builds a url and lastModified from a tournament row', () => {
    const entry = tournamentSitemapEntry({ slug: 'dls-26-championship', updated_at: '2026-07-10T00:00:00.000Z' })
    expect(entry.url).toBe(`${SITE_URL}/tournaments/dls-26-championship`)
    expect(entry.lastModified).toBe('2026-07-10T00:00:00.000Z')
  })
})

describe('playerSitemapEntry', () => {
  it('builds a url from a player row', () => {
    const entry = playerSitemapEntry({ username: 'sniperking', updated_at: '2026-07-01T00:00:00.000Z' })
    expect(entry.url).toBe(`${SITE_URL}/players/sniperking`)
  })
})

describe('matchSitemapEntry', () => {
  it('builds a url from a match row', () => {
    const entry = matchSitemapEntry({ id: 'match-1', completed_at: '2026-07-02T00:00:00.000Z' })
    expect(entry.url).toBe(`${SITE_URL}/matches/match-1`)
    expect(entry.lastModified).toBe('2026-07-02T00:00:00.000Z')
  })
})

describe('listingSitemapEntry', () => {
  it('builds a url from a listing row', () => {
    const entry = listingSitemapEntry({ id: 'listing-1', updated_at: '2026-07-03T00:00:00.000Z' })
    expect(entry.url).toBe(`${SITE_URL}/exchange/listing-1`)
  })
})
