import { getTranslations } from 'next-intl/server'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { StaticPageShell, proseClassName } from '@/components/static/StaticPageShell'
import { emailTag, whatsappTag, listItemTag } from '@/components/static/richTags'

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'terms' })
  return buildMetadata({
    title: t('metaTitle'),
    description: t('metaDescription'),
    path: '/terms',
    locale,
  })
}

export default async function TermsPage() {
  const t = await getTranslations('terms')
  return (
    <StaticPageShell eyebrow={t('eyebrow')} title={t('title')} subtitle={t('subtitle')}>
      <div className={proseClassName}>
        <h2>{t('s1Heading')}</h2>
        <p>{t('s1P1')}</p>
        <p>{t('s1P2')}</p>

        <h2>{t('s2Heading')}</h2>
        <p>{t('s2P1')}</p>
        <p>{t('s2P2')}</p>

        <h2>{t('s3Heading')}</h2>
        <p>{t('s3P1')}</p>
        <p>{t.rich('s3P2', emailTag())}</p>

        <h2>{t('s4Heading')}</h2>
        <p>{t('s4P1')}</p>
        <p>{t('s4P2')}</p>
        <p>{t('s4P3')}</p>

        <h2>{t('s5Heading')}</h2>
        <p>{t('s5Intro')}</p>
        <ul>{t.rich('s5List', listItemTag)}</ul>
        <p>{t('s5P2')}</p>
        <p>{t('s5P3')}</p>

        <h2>{t('s6Heading')}</h2>
        <p>{t('s6P1')}</p>
        <p>{t('s6P2')}</p>

        <h2>{t('s7Heading')}</h2>
        <p>{t('s7P1')}</p>

        <h2>{t('s8Heading')}</h2>
        <p>{t('s8P1')}</p>

        <h2>{t('s9Heading')}</h2>
        <p>{t('s9P1')}</p>

        <h2>{t('s10Heading')}</h2>
        <p>{t('s10P1')}</p>

        <h2>{t('s11Heading')}</h2>
        <p>{t('s11P1')}</p>
        <p>{t('s11P2')}</p>

        <h2>{t('s12Heading')}</h2>
        <p>{t('s12P1')}</p>

        <h2>{t('s13Heading')}</h2>
        <p>{t('s13P1')}</p>

        <h2>{t('s14Heading')}</h2>
        <p>{t.rich('s14P1', { ...emailTag(), ...whatsappTag() })}</p>
      </div>
    </StaticPageShell>
  )
}
