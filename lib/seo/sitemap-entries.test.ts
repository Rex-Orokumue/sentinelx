import { describe, it, expect } from 'vitest'
import {
  staticSitemapEntries,
  tournamentSitemapEntry,
  playerSitemapEntry,
  matchSitemapEntry,
  listingSitemapEntry,
  seasonSitemapEntry,
  expandToLocales,
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
      `${SITE_URL}/games`,
      `${SITE_URL}/about`,
      `${SITE_URL}/store`,
      `${SITE_URL}/privacy`,
      `${SITE_URL}/terms`,
      `${SITE_URL}/refund-policy`,
      `${SITE_URL}/rules`,
      `${SITE_URL}/safety`,
      `${SITE_URL}/escrow`,
      `${SITE_URL}/community-rules`,
      `${SITE_URL}/how-it-works`,
      `${SITE_URL}/help`,
      `${SITE_URL}/contact`,
      `${SITE_URL}/tournament-guide`,
      `${SITE_URL}/tournament-faqs`,
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

describe('seasonSitemapEntry', () => {
  it('builds a url from a season row', () => {
    const entry = seasonSitemapEntry({ slug: 'season-3' })
    expect(entry.url).toBe(`${SITE_URL}/seasons/season-3`)
  })
})

describe('expandToLocales', () => {
  it('produces one entry per locale, each with hreflang alternates covering all three', () => {
    const entries = expandToLocales({ url: `${SITE_URL}/tournaments/x`, priority: 0.8 })
    expect(entries.map((e) => e.url)).toEqual([
      `${SITE_URL}/tournaments/x`,
      `${SITE_URL}/fr/tournaments/x`,
      `${SITE_URL}/pcm/tournaments/x`,
    ])
    expect(entries[0].alternates?.languages).toEqual({
      en: `${SITE_URL}/tournaments/x`,
      fr: `${SITE_URL}/fr/tournaments/x`,
      pcm: `${SITE_URL}/pcm/tournaments/x`,
    })
    // Other fields (priority, etc.) carry over onto every locale variant.
    entries.forEach((e) => expect(e.priority).toBe(0.8))
  })
})
