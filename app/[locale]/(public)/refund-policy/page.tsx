import { getTranslations } from 'next-intl/server'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { LegalDocShell } from '@/components/static/LegalDocShell'
import { emailTag, listItemTag } from '@/components/static/richTags'

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'refundPolicy' })
  return buildMetadata({
    title: t('metaTitle'),
    description: t('metaDescription'),
    path: '/refund-policy',
    locale,
  })
}

export default async function RefundPolicyPage() {
  const t = await getTranslations('refundPolicy')
  return (
    <LegalDocShell
      eyebrow={t('eyebrow')}
      title={t('title')}
      subtitle={t('subtitle')}
      summary={t('summary')}
      sections={[
        {
          id: 'entry-fees',
          title: t('s1Heading'),
          body: (
            <>
              <p>{t('s1P1')}</p>
              <p><strong>{t('s1RefundIntro')}</strong></p>
              <ul>{t.rich('s1RefundList', listItemTag)}</ul>
              <p><strong>{t('s1NoRefundIntro')}</strong></p>
              <ul>{t.rich('s1NoRefundList', listItemTag)}</ul>
              <p>{t('s1P2')}</p>
            </>
          ),
        },
        {
          id: 'tournament-cancelled',
          title: t('s2Heading'),
          body: (
            <>
              <p>{t('s2Intro')}</p>
              <ul>{t.rich('s2List', listItemTag)}</ul>
            </>
          ),
        },
        { id: 'disqualification', title: t('s3Heading'), body: <p>{t('s3P1')}</p> },
        { id: 'payment-failures', title: t('s4Heading'), body: <p>{t('s4P1')}</p> },
        { id: 'how-to-request', title: t('s5Heading'), body: <p>{t.rich('s5P1', emailTag())}</p> },
      ]}
    />
  )
}
