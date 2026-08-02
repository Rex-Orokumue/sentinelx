import { createClient } from '@/lib/supabase/server'
import { loadMatchCardInput } from '@/lib/og/match-card-data'
import { renderMatchCard } from '@/lib/og/match-card'

export const runtime = 'edge'

// No Content-Disposition: attachment — the Share button reads this as a
// blob for navigator.share()/an object URL, not a browser-triggered
// download. Deliberately the same render path as opengraph-image.tsx so
// the passive link preview and the active share/download never drift.
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const input = await loadMatchCardInput(supabase, params.id)
  if (!input) return new Response('Not found', { status: 404 })
  return renderMatchCard(input)
}
