import { DEFAULT_OG_IMAGE } from '../site'

export type VideoObjectInput = {
  name: string
  description: string | null
  thumbnailUrl: string | null
  embedUrl: string
  /** Required by Google for VideoObject eligibility — only call this builder when a real date is known. */
  uploadDate: string
}

export function buildVideoJsonLd(v: VideoObjectInput) {
  return {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: v.name,
    description: v.description ?? `${v.name} — watch on Sentinel X TV.`,
    thumbnailUrl: v.thumbnailUrl ?? DEFAULT_OG_IMAGE,
    embedUrl: v.embedUrl,
    uploadDate: v.uploadDate,
  }
}
