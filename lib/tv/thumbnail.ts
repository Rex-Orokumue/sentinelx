import { parseYouTubeId } from '@/lib/matches/youtube'

// A YouTube video's default thumbnail. Returns null when the URL isn't a YouTube link.
export function youtubeThumbnail(url: string | null): string | null {
  const id = parseYouTubeId(url)
  return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : null
}
