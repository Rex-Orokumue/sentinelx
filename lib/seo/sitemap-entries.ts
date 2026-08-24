import type { MetadataRoute } from 'next'
import { SITE_URL } from './site'
import { LOCALES } from '@/i18n/locales'
import { withLocalePrefix } from '@/lib/i18n/locale-path'

// Expands one canonical (English, unprefixed) sitemap entry into one entry
// per locale — /tournaments/x, /fr/tournaments/x, /pcm/tournaments/x —
// each carrying an alternates.languages block covering all three, so search
// engines see every language variant instead of treating them as
// duplicate/unrelated pages. Every other field (lastModified, priority,
// changeFrequency) carries over unchanged onto each locale variant.
export function expandToLocales(entry: MetadataRoute.Sitemap[number]): MetadataRoute.Sitemap {
  const path = entry.url.replace(SITE_URL, '') || '/'
  const languages = Object.fromEntries(LOCALES.map((l) => [l, `${SITE_URL}${withLocalePrefix(path, l)}`]))
  return LOCALES.map((locale) => ({
    ...entry,
    url: `${SITE_URL}${withLocalePrefix(path, locale)}`,
    alternates: { languages },
  }))
}

export function staticSitemapEntries(): MetadataRoute.Sitemap {
  const paths = [
    '/',
    '/tournaments',
    '/players',
    '/rankings',
    '/hall-of-fame',
    '/tv',
    '/exchange',
    '/community',
    '/games',
    '/about',
    '/store',
  ]
  return paths.map((path) => ({ url: `${SITE_URL}${path === '/' ? '/' : path}` }))
}

export function tournamentSitemapEntry(row: { slug: string; updated_at: string | null }): MetadataRoute.Sitemap[number] {
  return {
    url: `${SITE_URL}/tournaments/${row.slug}`,
    lastModified: row.updated_at ?? undefined,
    changeFrequency: 'daily',
    priority: 0.8,
  }
}

export function playerSitemapEntry(row: { username: string; updated_at: string | null }): MetadataRoute.Sitemap[number] {
  return {
    url: `${SITE_URL}/players/${row.username}`,
    lastModified: row.updated_at ?? undefined,
    changeFrequency: 'weekly',
    priority: 0.5,
  }
}

export function matchSitemapEntry(row: { id: string; completed_at: string | null }): MetadataRoute.Sitemap[number] {
  return {
    url: `${SITE_URL}/matches/${row.id}`,
    lastModified: row.completed_at ?? undefined,
    changeFrequency: 'monthly',
    priority: 0.3,
  }
}

export function listingSitemapEntry(row: { id: string; updated_at: string | null }): MetadataRoute.Sitemap[number] {
  return {
    url: `${SITE_URL}/exchange/${row.id}`,
    lastModified: row.updated_at ?? undefined,
    changeFrequency: 'daily',
    priority: 0.4,
  }
}
