import type { Metadata } from 'next'
import { SITE_URL, SITE_NAME, DEFAULT_OG_IMAGE } from './site'

export type BuildMetadataInput = {
  title: string
  description: string
  /** Route path with no query string, e.g. '/tournaments/dls-26-championship'. */
  path: string
  image?: string
  type?: 'website' | 'article'
}

export function buildMetadata({ title, description, path, image, type = 'website' }: BuildMetadataInput): Metadata {
  const url = `${SITE_URL}${path}`
  const ogImage = image ?? DEFAULT_OG_IMAGE
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      siteName: SITE_NAME,
      type,
      images: [ogImage],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImage],
    },
  }
}
