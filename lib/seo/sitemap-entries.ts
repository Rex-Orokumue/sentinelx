import type { MetadataRoute } from 'next'
import { SITE_URL } from './site'

export function staticSitemapEntries(): MetadataRoute.Sitemap {
  const paths = ['/', '/tournaments', '/players', '/rankings', '/hall-of-fame', '/tv', '/exchange', '/community']
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
