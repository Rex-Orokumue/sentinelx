import { createClient } from '@/lib/supabase/server'
import { renderOgImage, OG_SIZE } from '@/lib/og/template'

export const runtime = 'edge'
export const size = OG_SIZE
export const contentType = 'image/png'

type NameRef = { username: string | null; display_name: string | null } | { username: string | null; display_name: string | null }[] | null
function nameOf(p: NameRef): string {
  const r = Array.isArray(p) ? p[0] ?? null : p
  return r?.display_name ?? r?.username ?? 'TBD'
}

export default async function Image({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: m } = await supabase
    .from('matches')
    .select(
      'score_a, score_b, status, player_a:profiles!matches_player_a_id_fkey(username, display_name), player_b:profiles!matches_player_b_id_fkey(username, display_name)',
    )
    .eq('id', params.id)
    .maybeSingle()

  const a = nameOf(m?.player_a ?? null)
  const b = nameOf(m?.player_b ?? null)
  const scored = m?.status === 'completed' && m.score_a != null && m.score_b != null

  return renderOgImage({
    title: `${a} vs ${b}`,
    subtitle: scored ? `${m!.score_a} – ${m!.score_b}` : undefined,
  })
}
