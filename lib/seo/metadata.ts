import type { Metadata } from 'next'
import { SITE_URL, SITE_NAME } from './site'
import { LOCALES } from '@/i18n/locales'
import { withLocalePrefix } from '@/lib/i18n/locale-path'
import type { Locale } from '@/i18n/locales'

export type BuildMetadataInput = {
  title: string
  description: string
  /** Route path with no query string, e.g. '/tournaments/dls-26-championship'. */
  path: string
  locale: Locale
  image?: string
  type?: 'website' | 'article'
}

// `image` is omitted from openGraph/twitter when not given (rather than defaulting
// to a constant) so Next's own opengraph-image.tsx file-convention resolution can
// fill it in — a segment's own dynamic image, falling back to the root default.
// An explicit `image` (e.g. a tournament banner) always overrides that cascade.
export function buildMetadata({ title, description, path, locale, image, type = 'website' }: BuildMetadataInput): Metadata {
  const url = `${SITE_URL}${withLocalePrefix(path, locale)}`
  const languages = Object.fromEntries(
    LOCALES.map((l) => [l, `${SITE_URL}${withLocalePrefix(path, l)}`]),
  )
  languages['x-default'] = `${SITE_URL}${path}`

  return {
    title,
    description,
    alternates: { canonical: url, languages },
    openGraph: {
      title,
      description,
      url,
      siteName: SITE_NAME,
      type,
      ...(image ? { images: [image] } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      ...(image ? { images: [image] } : {}),
    },
  }
}
