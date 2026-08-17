import { ImageResponse } from 'next/og'

// edge runtime + fetch, not node:fs — see app/icon-192.png/route.tsx.
// Source is public/logo.png, not logo-icon.png — see app/icon-192.png/route.tsx.
// 60% of canvas (vs. 80% for the non-maskable variants) — extra padding
// for Android's adaptive-icon safe zone.
export const runtime = 'edge'

export async function GET(request: Request) {
  const logoUrl = new URL('/logo.png', request.url).toString()
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
        <img src={logoUrl} width={307} height={286} alt="" />
      </div>
    ),
    { width: 512, height: 512 },
  )
}
