import { ImageResponse } from 'next/og'
import { SITE_TAGLINE } from '@/lib/seo/site'

export const OG_SIZE = { width: 1200, height: 630 }

export async function renderOgImage({ title, subtitle }: { title: string; subtitle?: string }) {
  const geistBold = await fetch(new URL('../../app/fonts/GeistVF.woff', import.meta.url)).then((res) =>
    res.arrayBuffer(),
  )

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#020617',
          color: '#ffffff',
          fontFamily: 'Geist',
          padding: '80px',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: '0.1em', color: '#a78bfa' }}>SENTINEL X</div>
        <div style={{ fontSize: 64, fontWeight: 700, marginTop: 24, lineHeight: 1.15 }}>{title}</div>
        <div style={{ fontSize: 32, marginTop: 20, color: '#94a3b8' }}>{subtitle ?? SITE_TAGLINE}</div>
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: [{ name: 'Geist', data: geistBold, weight: 700 }],
    },
  )
}
