import { createClient } from '@/lib/supabase/server'
import { formatDate, formatDateTime } from '@/lib/format'

export interface UpcomingEventItem {
  id: string
  title: string
  date: string
  time: string
  ctaLabel: string
  ctaHref: string
}

interface TournamentRow {
  id: string
  title: string
  slug: string
  tournament_start: string | null
  status: string
}

// Adapter seam (spec §4.5): the mockup's "Upcoming Community Events" widget
// has no backing data source yet, so this sources it from real tournaments
// instead. The widget component only ever sees UpcomingEventItem — when a
// real `community_events` table ships later, only this function's body
// changes, not the widget or its prop shape.
export function mapTournamentToEventItem(row: TournamentRow): UpcomingEventItem {
  const dateTime = formatDateTime(row.tournament_start)
  return {
    id: row.id,
    title: row.title,
    date: formatDate(row.tournament_start) ?? 'Date TBD',
    time: dateTime ?? 'Time TBD',
    ctaLabel: row.status === 'registration_open' ? 'Register' : 'View',
    ctaHref: `/tournaments/${row.slug}`,
  }
}

export async function fetchUpcomingCommunityEvents(limit = 3): Promise<UpcomingEventItem[]> {
  const supabase = createClient()
  const { data } = await supabase
    .from('tournaments')
    .select('id, title, slug, tournament_start, status')
    .in('status', ['registration_open', 'active'])
    .order('tournament_start', { ascending: true })
    .limit(limit)
  return (data ?? []).map(mapTournamentToEventItem)
}
