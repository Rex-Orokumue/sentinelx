import { getTranslations } from 'next-intl/server'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { StaticPageShell, proseClassName } from '@/components/static/StaticPageShell'
import { emailTag, linkTag, listItemTag } from '@/components/static/richTags'

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'escrow' })
  return buildMetadata({
    title: t('metaTitle'),
    description: t('metaDescription'),
    path: '/escrow',
    locale,
  })
}

export default async function EscrowPage() {
  const t = await getTranslations('escrow')
  return (
    <StaticPageShell eyebrow={t('eyebrow')} title={t('title')}>
      <div className={proseClassName}>
        <h2>{t('whatIsExchangeHeading')}</h2>
        <p>{t('whatIsExchangeP1')}</p>
        <p>{t.rich('whatIsExchangeP2', linkTag('/exchange'))}</p>

        <h2>{t('whatIsEscrowHeading')}</h2>
        <p>{t('whatIsEscrowP1')}</p>
        <p>{t('whatIsEscrowP2')}</p>

        <h2>{t('howItWorksHeading')}</h2>
        <p>
          <strong>{t('buyerLabel')}</strong>
        </p>
        <ol>{t.rich('buyerList', listItemTag)}</ol>
        <p>{t('buyerP2')}</p>
        <p>
          <strong>{t('sellerLabel')}</strong>
        </p>
        <ol>{t.rich('sellerList', listItemTag)}</ol>
        <p>{t('sellerP2')}</p>

        <h2>{t('whyNotDirectHeading')}</h2>
        <p>{t('whyNotDirectP1')}</p>
        <p>{t('whyNotDirectP2')}</p>

        <h2>{t('questionsHeading')}</h2>
        <p>{t.rich('questionsP1', emailTag())}</p>
      </div>
    </StaticPageShell>
  )
}
