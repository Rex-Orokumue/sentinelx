import { getTranslations } from 'next-intl/server'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { LegalDocShell } from '@/components/static/LegalDocShell'
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
    <LegalDocShell
      eyebrow={t('eyebrow')}
      title={t('title')}
      summary={t('summary')}
      sections={[
        {
          id: 'what-is-the-exchange',
          title: t('whatIsExchangeHeading'),
          body: <><p>{t('whatIsExchangeP1')}</p><p>{t.rich('whatIsExchangeP2', linkTag('/exchange'))}</p></>,
        },
        {
          id: 'what-is-escrow',
          title: t('whatIsEscrowHeading'),
          body: <><p>{t('whatIsEscrowP1')}</p><p>{t('whatIsEscrowP2')}</p></>,
        },
        {
          id: 'how-it-works',
          title: t('howItWorksHeading'),
          body: (
            <>
              <p><strong>{t('buyerLabel')}</strong></p>
              <ol>{t.rich('buyerList', listItemTag)}</ol>
              <p>{t('buyerP2')}</p>
              <p><strong>{t('sellerLabel')}</strong></p>
              <ol>{t.rich('sellerList', listItemTag)}</ol>
              <p>{t('sellerP2')}</p>
            </>
          ),
        },
        {
          id: 'why-not-direct',
          title: t('whyNotDirectHeading'),
          body: <><p>{t('whyNotDirectP1')}</p><p>{t('whyNotDirectP2')}</p></>,
        },
        { id: 'questions', title: t('questionsHeading'), body: <p>{t.rich('questionsP1', emailTag())}</p> },
      ]}
    />
  )
}
