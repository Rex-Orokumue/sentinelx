import { getTranslations } from 'next-intl/server'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { StaticPageShell } from '@/components/static/StaticPageShell'
import { FaqAccordion, type FaqGroup } from '@/components/static/FaqAccordion'

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'help' })
  return buildMetadata({
    title: t('metaTitle'),
    description: t('metaDescription'),
    path: '/help',
    locale,
  })
}

// Matches the message-catalog group keys and each group's item count.
const GROUP_SPECS = [
  { key: 'gettingStarted', count: 3 },
  { key: 'tournaments', count: 6 },
  { key: 'prizes', count: 4 },
  { key: 'sxScore', count: 3 },
  { key: 'sxCoins', count: 3 },
  { key: 'accountSafety', count: 3 },
] as const

export default async function HelpPage() {
  const t = await getTranslations('help')
  const groups: FaqGroup[] = GROUP_SPECS.map(({ key, count }) => ({
    heading: t(`${key}.heading`),
    items: Array.from({ length: count }, (_, i) => ({
      q: t(`${key}.q${i + 1}`),
      a: t(`${key}.a${i + 1}`),
    })),
  }))

  return (
    <StaticPageShell eyebrow={t('eyebrow')} title={t('title')}>
      <FaqAccordion groups={groups} />
    </StaticPageShell>
  )
}
