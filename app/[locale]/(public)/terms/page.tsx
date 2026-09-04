import { getTranslations } from 'next-intl/server'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { LegalDocShell } from '@/components/static/LegalDocShell'
import { emailTag, whatsappTag, linkTag, listItemTag } from '@/components/static/richTags'

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
    <LegalDocShell
      eyebrow={t('eyebrow')}
      title={t('title')}
      subtitle={t('subtitle')}
      meta={[t('metaUpdated')]}
      summary={t('summary')}
      sections={[
        { id: 'who-we-are', title: t('s1Heading'), body: <><p>{t('s1P1')}</p><p>{t('s1P2')}</p></> },
        { id: 'eligibility', title: t('s2Heading'), body: <><p>{t('s2P1')}</p><p>{t('s2P2')}</p></> },
        { id: 'your-account', title: t('s3Heading'), body: <><p>{t('s3P1')}</p><p>{t.rich('s3P2', emailTag())}</p></> },
        {
          id: 'entry-fees',
          title: t('s4Heading'),
          body: <><p>{t('s4P1')}</p><p>{t('s4P2')}</p><p>{t.rich('s4P3', linkTag('/refund-policy'))}</p></>,
        },
        {
          id: 'fair-play',
          title: t('s5Heading'),
          body: (
            <>
              <p>{t('s5Intro')}</p>
              <ul>{t.rich('s5List', listItemTag)}</ul>
              <p>{t.rich('s5P2', linkTag('/rules'))}</p>
              <p>{t('s5P3')}</p>
            </>
          ),
        },
        { id: 'prizes-withdrawals', title: t('s6Heading'), body: <><p>{t('s6P1')}</p><p>{t('s6P2')}</p></> },
        { id: 'sx-coins', title: t('s7Heading'), body: <p>{t('s7P1')}</p> },
        {
          id: 'community-wagering',
          title: t('s8Heading'),
          body: <><p>{t('s8P1')}</p><ul>{t.rich('s8List', listItemTag)}</ul><p>{t('s8P2')}</p></>,
        },
        { id: 'gaming-exchange', title: t('s9Heading'), body: <p>{t.rich('s9P1', linkTag('/escrow'))}</p> },
        { id: 'community-standards', title: t('s10Heading'), body: <p>{t.rich('s10P1', linkTag('/community-rules'))}</p> },
        { id: 'intellectual-property', title: t('s11Heading'), body: <p>{t('s11P1')}</p> },
        { id: 'liability', title: t('s12Heading'), body: <><p>{t('s12P1')}</p><p>{t('s12P2')}</p></> },
        { id: 'changes', title: t('s13Heading'), body: <p>{t('s13P1')}</p> },
        { id: 'governing-law', title: t('s14Heading'), body: <p>{t('s14P1')}</p> },
        {
          id: 'contact',
          title: t('s15Heading'),
          body: <p>{t.rich('s15P1', { ...emailTag(), ...whatsappTag() })}</p>,
        },
      ]}
    />
  )
}
