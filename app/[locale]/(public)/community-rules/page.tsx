import { getTranslations } from 'next-intl/server'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { LegalDocShell } from '@/components/static/LegalDocShell'
import { emailTag, strongTag } from '@/components/static/richTags'

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'communityRules' })
  return buildMetadata({
    title: t('metaTitle'),
    description: t('metaDescription'),
    path: '/community-rules',
    locale,
  })
}

export default async function CommunityRulesPage() {
  const t = await getTranslations('communityRules')
  return (
    <LegalDocShell
      eyebrow={t('eyebrow')}
      title={t('title')}
      summary={t('summary')}
      sections={[
        { id: 'overview', title: t('overviewHeading'), body: <p>{t('intro')}</p> },
        { id: 'the-basics', title: t('basicHeading'), body: <p>{t('basicP1')}</p> },
        {
          id: 'not-allowed',
          title: t('notAllowedHeading'),
          body: (
            <>
              <h3>{t('harassmentHeading')}</h3>
              <p>{t('harassmentP1')}</p>
              <h3>{t('spamHeading')}</h3>
              <p>{t('spamP1')}</p>
              <h3>{t('falseInfoHeading')}</h3>
              <p>{t('falseInfoP1')}</p>
              <h3>{t('privacyHeading')}</h3>
              <p>{t('privacyP1')}</p>
              <h3>{t('cheatingHeading')}</h3>
              <p>{t('cheatingP1')}</p>
              <h3>{t('nsfwHeading')}</h3>
              <p>{t('nsfwP1')}</p>
            </>
          ),
        },
        {
          id: 'consequences',
          title: t('consequencesHeading'),
          body: <p>{t.rich('consequencesP1', { ...strongTag, br: () => <br /> })}</p>,
        },
        { id: 'reporting', title: t('reportingHeading'), body: <p>{t.rich('reportingP1', emailTag())}</p> },
      ]}
    />
  )
}
