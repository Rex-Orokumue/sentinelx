import { renderOgImage, OG_SIZE } from '@/lib/og/template'

export const runtime = 'edge'
export const size = OG_SIZE
export const contentType = 'image/png'

export default async function Image() {
  return renderOgImage({ title: 'Store' })
}
