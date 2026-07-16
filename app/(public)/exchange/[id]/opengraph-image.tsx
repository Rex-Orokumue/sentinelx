import { createClient } from '@/lib/supabase/server'
import { renderOgImage, OG_SIZE } from '@/lib/og/template'

export const runtime = 'edge'
export const size = OG_SIZE
export const contentType = 'image/png'

export default async function Image({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: l } = await supabase
    .from('marketplace_listings')
    .select('title, price')
    .eq('id', params.id)
    .maybeSingle()

  // Plain "NGN" instead of formatNaira's "₦": Satori's default fallback font
  // (see lib/og/template.tsx) has no glyph for the Naira sign.
  return renderOgImage({
    title: l?.title ?? 'Gaming Exchange listing',
    subtitle: l ? `NGN ${l.price.toLocaleString('en-NG')}` : undefined,
  })
}
