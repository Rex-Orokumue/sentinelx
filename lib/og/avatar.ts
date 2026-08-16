// Satori (the next/og renderer) fetches a remote <img src> itself, and on
// a network failure or an unreachable/non-image URL it silently renders a
// blank box rather than throwing or falling back. Fetching and inlining the
// image as a data URI ourselves, with a real try/catch, guarantees an
// unreachable image falls back to initials/a blank slot instead of shipping
// a blank circle.
//
// A second failure mode, confirmed live: some real user-uploaded PNGs are
// large phone-camera photos carrying embedded EXIF/ICC "raw profile" blocks
// (one confirmed case: 6.2MB, 1792×2392, with a full embedded JPEG thumbnail
// in an APP1 profile chunk) that Satori's PNG decoder silently fails to
// parse — no error surfaced to catch, it just renders blank. Routing the
// fetch through Supabase Storage's image-transform endpoint instead of the
// raw object URL re-encodes and shrinks the image, which strips those
// embedded profiles as a side effect — confirmed live that the transformed
// output decodes correctly where the original did not.
//
// Shared by lib/og/match-card.tsx and lib/og/community-post-card.tsx — kept
// here rather than duplicated so both OG renderers get the same fix.

const STORAGE_OBJECT_PATH = '/storage/v1/object/public/'
const STORAGE_RENDER_PATH = '/storage/v1/render/image/public/'

// Pure and exported for testing. Falls back to the original URL unchanged
// for anything that isn't a recognized Supabase Storage public-object URL,
// or that fails to parse as a URL at all — never breaks a working fetch.
export function transformedStorageUrl(url: string, width: number, height: number): string {
  try {
    const u = new URL(url)
    if (!u.pathname.includes(STORAGE_OBJECT_PATH)) return url
    u.pathname = u.pathname.replace(STORAGE_OBJECT_PATH, STORAGE_RENDER_PATH)
    u.searchParams.set('width', String(width))
    u.searchParams.set('height', String(height))
    u.searchParams.set('resize', 'cover')
    return u.toString()
  } catch {
    return url
  }
}

export async function resolveAvatarDataUri(
  url: string,
  dims: { width: number; height: number } = { width: 240, height: 240 },
): Promise<string | null> {
  try {
    const res = await fetch(transformedStorageUrl(url, dims.width, dims.height), { signal: AbortSignal.timeout(3000) })
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
