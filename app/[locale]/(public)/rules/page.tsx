import { getTranslations } from 'next-intl/server'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { LegalDocShell } from '@/components/static/LegalDocShell'
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
    <LegalDocShell
      eyebrow={t('eyebrow')}
      title={t('title')}
      summary={t('summary')}
      sections={[
        { id: 'eligibility', title: t('eligibilityHeading'), body: <ul>{t.rich('eligibilityList', listItemTag)}</ul> },
        { id: 'before-your-match', title: t('beforeHeading'), body: <ul>{t.rich('beforeList', listItemTag)}</ul> },
        { id: 'during-play', title: t('playingHeading'), body: <ul>{t.rich('playingList', listItemTag)}</ul> },
        { id: 'submitting-results', title: t('submittingHeading'), body: <ul>{t.rich('submittingList', listItemTag)}</ul> },
        { id: 'no-shows', title: t('noShowHeading'), body: <ul>{t.rich('noShowList', listItemTag)}</ul> },
        { id: 'disputes', title: t('disputesHeading'), body: <ul>{t.rich('disputesList', listItemTag)}</ul> },
        { id: 'conduct', title: t('conductHeading'), body: <ul>{t.rich('conductList', listItemTag)}</ul> },
        { id: 'prizes', title: t('prizesHeading'), body: <ul>{t.rich('prizesList', listItemTag)}</ul> },
      ]}
    />
  )
}
