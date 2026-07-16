import { ImageResponse } from 'next/og'
import { SITE_TAGLINE } from '@/lib/seo/site'

export const OG_SIZE = { width: 1200, height: 630 }

// No custom font is loaded here: the brand fonts (GeistVF, Rajdhani) are variable
// fonts, and @vercel/og's Satori renderer can't parse the fvar (variation axis)
// table in variable fonts — it throws regardless of platform. Satori's built-in
// default font renders reliably instead.
export async function renderOgImage({ title, subtitle }: { title: string; subtitle?: string }) {
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
          padding: '80px',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: '0.1em', color: '#a78bfa' }}>SENTINEL X</div>
        <div style={{ fontSize: 64, fontWeight: 700, marginTop: 24, lineHeight: 1.15 }}>{title}</div>
        <div style={{ fontSize: 32, marginTop: 20, color: '#94a3b8' }}>{subtitle ?? SITE_TAGLINE}</div>
      </div>
    ),
    OG_SIZE,
  )
}
