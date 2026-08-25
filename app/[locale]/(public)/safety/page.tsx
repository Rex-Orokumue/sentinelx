import { getTranslations } from 'next-intl/server'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { StaticPageShell, proseClassName } from '@/components/static/StaticPageShell'
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
    <StaticPageShell eyebrow={t('eyebrow')} title={t('title')}>
      <div className={proseClassName}>
        <h2>{t('protectAccountHeading')}</h2>
        <ul>{t.rich('protectAccountList', listItemTag)}</ul>

        <h2>{t('neverAskHeading')}</h2>
        <p>{t('neverAskIntro')}</p>
        <ul>{t.rich('neverAskList', listItemTag)}</ul>
        <p>{t('neverAskP2')}</p>

        <h2>{t('protectPrizeHeading')}</h2>
        <ul>{t.rich('protectPrizeList', listItemTag)}</ul>

        <h2>{t('safeTradingHeading')}</h2>
        <ul>{t.rich('safeTradingList', listItemTag)}</ul>

        <h2>{t('matchSafetyHeading')}</h2>
        <ul>{t.rich('matchSafetyList', listItemTag)}</ul>

        <h2>{t('reportHeading')}</h2>
        <p>{t.rich('reportP1', { ...emailTag(), ...whatsappTag(), br: () => <br /> })}</p>
      </div>
    </StaticPageShell>
  )
}
