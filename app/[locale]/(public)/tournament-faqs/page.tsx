import { getTranslations } from 'next-intl/server'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { StaticPageShell } from '@/components/static/StaticPageShell'
import { FaqAccordion, type FaqGroup } from '@/components/static/FaqAccordion'
import { JsonLd } from '@/components/seo/JsonLd'
import { buildFaqJsonLd } from '@/lib/seo/schema/faq'

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'tournamentFaqs' })
  return buildMetadata({
    title: t('metaTitle'),
    description: t('metaDescription'),
    path: '/tournament-faqs',
    locale,
  })
}

const ITEM_COUNT = 10

export default async function TournamentFaqsPage() {
  const t = await getTranslations('tournamentFaqs')
  const groups: FaqGroup[] = [
    {
      heading: t('groupHeading'),
      items: Array.from({ length: ITEM_COUNT }, (_, i) => ({
        q: t(`q${i + 1}`),
        a: t(`a${i + 1}`),
      })),
    },
  ]

  return (
    <StaticPageShell eyebrow={t('eyebrow')} title={t('title')}>
      <JsonLd data={buildFaqJsonLd(groups[0].items.map((item) => ({ question: item.q, answer: item.a })))} />
      <FaqAccordion groups={groups} />
    </StaticPageShell>
  )
}
