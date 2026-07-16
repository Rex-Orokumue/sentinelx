import { renderOgImage, OG_SIZE } from '@/lib/og/template'
import { SITE_TAGLINE } from '@/lib/seo/site'

export const size = OG_SIZE
export const contentType = 'image/png'

export default async function Image() {
  return renderOgImage({ title: 'SentinelX Esports', subtitle: SITE_TAGLINE })
}
