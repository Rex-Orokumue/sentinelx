import { getTranslations } from 'next-intl/server'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { StaticPageShell, proseClassName } from '@/components/static/StaticPageShell'
import { listItemTag } from '@/components/static/richTags'

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'rules' })
  return buildMetadata({
    title: t('metaTitle'),
    description: t('metaDescription'),
    path: '/rules',
    locale,
  })
}

export default async function RulesPage() {
  const t = await getTranslations('rules')
  return (
    <StaticPageShell eyebrow={t('eyebrow')} title={t('title')}>
      <div className={proseClassName}>
        <h2>{t('eligibilityHeading')}</h2>
        <ul>{t.rich('eligibilityList', listItemTag)}</ul>

        <h2>{t('beforeHeading')}</h2>
        <ul>{t.rich('beforeList', listItemTag)}</ul>

        <h2>{t('playingHeading')}</h2>
        <ul>{t.rich('playingList', listItemTag)}</ul>

        <h2>{t('submittingHeading')}</h2>
        <ul>{t.rich('submittingList', listItemTag)}</ul>

        <h2>{t('noShowHeading')}</h2>
        <ul>{t.rich('noShowList', listItemTag)}</ul>

        <h2>{t('disputesHeading')}</h2>
        <ul>{t.rich('disputesList', listItemTag)}</ul>

        <h2>{t('conductHeading')}</h2>
        <ul>{t.rich('conductList', listItemTag)}</ul>

        <h2>{t('prizesHeading')}</h2>
        <ul>{t.rich('prizesList', listItemTag)}</ul>
      </div>
    </StaticPageShell>
  )
}
