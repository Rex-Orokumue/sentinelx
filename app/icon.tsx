import { ImageResponse } from 'next/og'
import { SITE_URL } from '@/lib/seo/site'

// edge, not Node runtime: @vercel/og's Node-runtime default-font loader
// constructs a malformed file: URL on Windows (ERR_INVALID_URL) — see
// app/icon-192.png/route.tsx for the full explanation. Edge has no
// node:fs, so the logo is fetched over HTTP instead of read from disk.
// Unlike that file, this is the real Next.js icon.tsx metadata convention,
// not a plain route handler — its default export receives no Request to
// derive an origin from, so the absolute URL comes from SITE_URL instead.
//
// Source is public/logo.png, not logo-icon.png — logo-icon.png has an
// "ICON ONLY" text label baked into the pixels (a design-file annotation
// that leaked into that export), invisible at the old 32px favicon size
// but part of why this needed replacing. logo.png is the clean mark alone
// with a real transparent background and no baked-in text. Replaces the
// static app/icon.png, which was still using the unfixed asset even after
// icon-192/512 were corrected.
export const runtime = 'edge'
export const size = { width: 32, height: 32 }
export const contentType = 'image/png'

export default async function Icon() {
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
        <img src={logoUrl} width={26} height={24} alt="" />
      </div>
    ),
    size,
  )
}
