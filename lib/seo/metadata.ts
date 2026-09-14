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
  type?: 'website' | 'article' | 'profile'
  /** Required when type is 'profile'. */
  profileUsername?: string
  /** Required when type is 'article'. */
  article?: { publishedTime: string; author?: string }
}

// Facebook/Open-Graph locale tags are xx_YY, not bare BCP-47 codes. There is
// no standard tag for Nigerian Pidgin (pcm), so it's mapped to the same _NG
// region as English rather than left out — still a meaningful signal that
// this is Nigerian content, which is the part that matters here.
const OG_LOCALE: Record<Locale, string> = { en: 'en_NG', fr: 'fr_FR', pcm: 'pcm_NG' }

// `image` is omitted from openGraph/twitter when not given (rather than defaulting
// to a constant) so Next's own opengraph-image.tsx file-convention resolution can
// fill it in — a segment's own dynamic image, falling back to the root default.
// An explicit `image` (e.g. a tournament banner) always overrides that cascade.
export function buildMetadata({
  title,
  description,
  path,
  locale,
  image,
  type = 'website',
  profileUsername,
  article,
}: BuildMetadataInput): Metadata {
  const url = `${SITE_URL}${withLocalePrefix(path, locale)}`
  const languages = Object.fromEntries(
    LOCALES.map((l) => [l, `${SITE_URL}${withLocalePrefix(path, l)}`]),
  )
  languages['x-default'] = `${SITE_URL}${path}`

  const openGraphBase = {
    title,
    description,
    url,
    siteName: SITE_NAME,
    locale: OG_LOCALE[locale],
    alternateLocale: LOCALES.filter((l) => l !== locale).map((l) => OG_LOCALE[l]),
    ...(image ? { images: [image] } : {}),
  }

  const openGraph =
    type === 'profile'
      ? { ...openGraphBase, type: 'profile' as const, ...(profileUsername ? { username: profileUsername } : {}) }
      : type === 'article'
        ? {
            ...openGraphBase,
            type: 'article' as const,
            ...(article ? { publishedTime: article.publishedTime, ...(article.author ? { authors: [article.author] } : {}) } : {}),
          }
        : { ...openGraphBase, type: 'website' as const }

  return {
    title,
    description,
    alternates: { canonical: url, languages },
    openGraph,
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      ...(image ? { images: [image] } : {}),
    },
  }
}
