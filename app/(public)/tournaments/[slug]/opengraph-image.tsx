import { createClient } from '@/lib/supabase/server'
import { renderOgImage, OG_SIZE } from '@/lib/og/template'

export const runtime = 'edge'
export const size = OG_SIZE
export const contentType = 'image/png'

export default async function Image({ params }: { params: { slug: string } }) {
  const supabase = createClient()
  const { data: t } = await supabase
    .from('tournaments')
    .select('title, prize_pool')
    .eq('slug', params.slug)
    .maybeSingle()

  // Plain "NGN" instead of formatNaira's "₦": Satori's default fallback font
  // (see lib/og/template.tsx) has no glyph for the Naira sign.
  return renderOgImage({
    title: t?.title ?? 'Tournament',
    subtitle: t ? `NGN ${t.prize_pool.toLocaleString('en-NG')} prize pool` : undefined,
  })
}
