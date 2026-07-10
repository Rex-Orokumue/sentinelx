// Extracts an 11-char YouTube video id from the common URL shapes, or null.
export function parseYouTubeId(url: string | null | undefined): string | null {
  if (!url) return null
  const patterns = [
    /[?&]v=([A-Za-z0-9_-]{11})/, // watch?v=
    /youtu\.be\/([A-Za-z0-9_-]{11})/, // youtu.be/
    /\/live\/([A-Za-z0-9_-]{11})/, // /live/
    /\/embed\/([A-Za-z0-9_-]{11})/, // /embed/
    /\/shorts\/([A-Za-z0-9_-]{11})/, // /shorts/
  ]
  for (const re of patterns) {
    const m = url.match(re)
    if (m) return m[1]
  }
  return null
}

export function youtubeEmbedUrl(
  id: string,
  opts: { autoplay?: boolean; mute?: boolean } = {},
): string {
  const params = new URLSearchParams()
  if (opts.autoplay) params.set('autoplay', '1')
  if (opts.mute) params.set('mute', '1')
  const qs = params.toString()
  return `https://www.youtube.com/embed/${id}${qs ? `?${qs}` : ''}`
}
