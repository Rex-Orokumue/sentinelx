import { ImageResponse } from 'next/og'

// edge, not Node runtime: @vercel/og's Node-runtime default-font loader
// constructs a malformed file: URL on Windows (ERR_INVALID_URL) — a
// platform bug in that code path, reproduced both at build-time
// prerendering and at live request time, not something fixable from here.
// app/opengraph-image.tsx already proves edge runtime works cleanly in
// this exact repo. Edge has no node:fs, so the logo is fetched over HTTP
// instead of read from disk — Satori/resvg (which ImageResponse renders
// through) fetches a plain URL string passed as an <img src>, no manual
// base64 encoding needed.
//
// Source is public/logo.png, not logo-icon.png — logo-icon.png has an
// "ICON ONLY" text label baked into the pixels (a design-file annotation
// that leaked into that export) which is invisible at the 32px header
// size it's used at today but glaring at icon/splash-screen sizes.
// logo.png is the clean mark alone with a real transparent background
// (RGBA, verified) and no baked-in text.
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
        <img src={logoUrl} width={154} height={143} alt="" />
      </div>
    ),
    { width: 192, height: 192 },
  )
}
