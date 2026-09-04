import { getTranslations } from 'next-intl/server'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { LegalDocShell } from '@/components/static/LegalDocShell'
import { emailTag, whatsappTag, listItemTag } from '@/components/static/richTags'

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'safety' })
  return buildMetadata({
    title: t('metaTitle'),
    description: t('metaDescription'),
    path: '/safety',
    locale,
  })
}

export default async function SafetyPage() {
  const t = await getTranslations('safety')
  return (
    <LegalDocShell
      eyebrow={t('eyebrow')}
      title={t('title')}
      summary={t('summary')}
      sections={[
        { id: 'protect-your-account', title: t('protectAccountHeading'), body: <ul>{t.rich('protectAccountList', listItemTag)}</ul> },
        {
          id: 'what-we-never-ask',
          title: t('neverAskHeading'),
          body: (
            <>
              <p>{t('neverAskIntro')}</p>
              <ul>{t.rich('neverAskList', listItemTag)}</ul>
              <p>{t('neverAskP2')}</p>
            </>
          ),
        },
        { id: 'protect-your-prize', title: t('protectPrizeHeading'), body: <ul>{t.rich('protectPrizeList', listItemTag)}</ul> },
        { id: 'safe-trading', title: t('safeTradingHeading'), body: <ul>{t.rich('safeTradingList', listItemTag)}</ul> },
        { id: 'match-safety', title: t('matchSafetyHeading'), body: <ul>{t.rich('matchSafetyList', listItemTag)}</ul> },
        {
          id: 'reporting',
          title: t('reportHeading'),
          body: <p>{t.rich('reportP1', { ...emailTag(), ...whatsappTag(), br: () => <br /> })}</p>,
        },
      ]}
    />
  )
}
