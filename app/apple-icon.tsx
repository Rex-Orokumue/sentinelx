import { ImageResponse } from 'next/og'
import { SITE_URL } from '@/lib/seo/site'

// See app/icon.tsx for why edge runtime + SITE_URL (not request.url) and
// public/logo.png (not logo-icon.png) — same reasoning applies here.
// Replaces the static app/apple-icon.png, which was still the raw,
// unfixed "ICON ONLY"-labeled export.
export const runtime = 'edge'
export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default async function AppleIcon() {
  const logoUrl = `${SITE_URL}/logo.png`
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#0B0B0F',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoUrl} width={144} height={134} alt="" />
      </div>
    ),
    size,
  )
}
