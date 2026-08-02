import { createClient } from '@/lib/supabase/server'
import { OG_SIZE } from '@/lib/og/template'
import { loadMatchCardInput } from '@/lib/og/match-card-data'
import { renderMatchCard } from '@/lib/og/match-card'

export const runtime = 'edge'
export const size = OG_SIZE
export const contentType = 'image/png'

export default async function Image({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const input = await loadMatchCardInput(supabase, params.id)
  if (!input) {
    // Same shape as before for a match that no longer exists — the route
    // itself 404s via the page's own notFound(), this only covers the rare
    // case where the OG image is requested for an id the page hasn't.
    return renderMatchCard({
      variant: 'hype',
      tournamentTitle: 'Sentinel X',
      playerA: { displayName: 'TBD', username: null, avatarUrl: null },
      playerB: { displayName: 'TBD', username: null, avatarUrl: null },
      scheduledLabel: null,
    })
  }
  return renderMatchCard(input)
}
