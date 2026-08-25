import { getTranslations } from 'next-intl/server'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { StaticPageShell, proseClassName } from '@/components/static/StaticPageShell'
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
    <StaticPageShell eyebrow={t('eyebrow')} title={t('title')} subtitle={t('subtitle')}>
      <div className={proseClassName}>
        <h2>{t('s1Heading')}</h2>
        <p>{t('s1P1')}</p>
        <p>
          <strong>{t('s1RefundIntro')}</strong>
        </p>
        <ul>{t.rich('s1RefundList', listItemTag)}</ul>
        <p>
          <strong>{t('s1NoRefundIntro')}</strong>
        </p>
        <ul>{t.rich('s1NoRefundList', listItemTag)}</ul>
        <p>{t('s1P2')}</p>

        <h2>{t('s2Heading')}</h2>
        <p>{t('s2Intro')}</p>
        <ul>{t.rich('s2List', listItemTag)}</ul>

        <h2>{t('s3Heading')}</h2>
        <p>{t('s3P1')}</p>

        <h2>{t('s4Heading')}</h2>
        <p>{t('s4P1')}</p>

        <h2>{t('s5Heading')}</h2>
        <p>{t.rich('s5P1', emailTag())}</p>
      </div>
    </StaticPageShell>
  )
}
