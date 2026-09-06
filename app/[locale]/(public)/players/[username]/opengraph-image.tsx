import { createClient } from '@/lib/supabase/server'
import { renderOgImage, OG_SIZE } from '@/lib/og/template'
import { DELETED_PLAYER_NAME } from '@/lib/players/display'

export const runtime = 'edge'
export const size = OG_SIZE
export const contentType = 'image/png'

export default async function Image({ params }: { params: { username: string } }) {
  const supabase = createClient()
  const { data: p } = await supabase
    .from('profiles')
    .select('display_name, username, sentinel_tier, deleted_at')
    .eq('username', params.username)
    .maybeSingle()

  // The page 404s for a tombstone, but the OG route is generated
  // independently — without this it would still render a card, and a stale
  // WhatsApp link would preview the deleted player's tier.
  if (p?.deleted_at) {
    return renderOgImage({ title: DELETED_PLAYER_NAME })
  }

  return renderOgImage({
    title: p?.display_name ?? p?.username ?? params.username,
    subtitle: p?.sentinel_tier ? `${p.sentinel_tier} tier` : undefined,
  })
}
