import type { MetadataRoute } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  staticSitemapEntries,
  tournamentSitemapEntry,
  playerSitemapEntry,
  matchSitemapEntry,
  listingSitemapEntry,
  seasonSitemapEntry,
  expandToLocales,
} from '@/lib/seo/sitemap-entries'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const supabase = createAdminClient()

  const [{ data: tournaments }, { data: players }, { data: matches }, { data: listings }, { data: seasons }] =
    await Promise.all([
      supabase.from('tournaments').select('slug, updated_at').neq('status', 'draft'),
      supabase.from('profiles').select('username, updated_at').gt('total_matches', 0).not('username', 'is', null),
      supabase.from('matches').select('id, completed_at').eq('status', 'completed'),
      supabase.from('marketplace_listings').select('id, updated_at').eq('status', 'active'),
      supabase.from('seasons').select('slug'),
    ])

  return [
    ...staticSitemapEntries(),
    ...(tournaments ?? []).map(tournamentSitemapEntry),
    ...(players ?? [])
      .filter((p): p is { username: string; updated_at: string } => p.username != null)
      .map(playerSitemapEntry),
    ...(matches ?? []).map(matchSitemapEntry),
    ...(listings ?? []).map(listingSitemapEntry),
    ...(seasons ?? []).map(seasonSitemapEntry),
  ].flatMap(expandToLocales)
}
