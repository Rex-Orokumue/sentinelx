import { createClient } from '@/lib/supabase/server'
import { renderOgImage, OG_SIZE } from '@/lib/og/template'

export const runtime = 'edge'
export const size = OG_SIZE
export const contentType = 'image/png'

export default async function Image({ params }: { params: { username: string } }) {
  const supabase = createClient()
  const { data: p } = await supabase
    .from('profiles')
    .select('display_name, username, sentinel_tier')
    .eq('username', params.username)
    .maybeSingle()

  return renderOgImage({
    title: p?.display_name ?? p?.username ?? params.username,
    subtitle: p?.sentinel_tier ? `${p.sentinel_tier} tier` : undefined,
  })
}
