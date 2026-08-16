// Satori (the next/og renderer) fetches a remote <img src> itself, and on
// a network failure or an unreachable/non-image URL it silently renders a
// blank box rather than throwing or falling back. Fetching and inlining the
// avatar as a data URI ourselves, with a real try/catch, guarantees an
// unreachable avatar falls back to initials instead of shipping a blank
// circle. This does not cover every failure mode: a small number of PNGs
// with unusual encodings can fail Satori's own decoder even once
// successfully fetched, with no error surfaced to catch — a known upstream
// limitation, not something fetch-side validation can detect (see
// lib/og/match-card.tsx's original comment / the Satori avatar memory).
//
// Shared by lib/og/match-card.tsx and lib/og/community-post-card.tsx — kept
// here rather than duplicated so both OG renderers get the same fix.
export async function resolveAvatarDataUri(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return null
    const contentType = res.headers.get('content-type') ?? ''
    if (!contentType.startsWith('image/')) return null
    const buf = await res.arrayBuffer()
    const base64 = Buffer.from(buf).toString('base64')
    return `data:${contentType};base64,${base64}`
  } catch {
    return null
  }
}
