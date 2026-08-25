import { getTranslations } from 'next-intl/server'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { StaticPageShell, proseClassName } from '@/components/static/StaticPageShell'
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
    <StaticPageShell eyebrow={t('eyebrow')} title={t('title')}>
      <div className={proseClassName}>
        <p>{t('intro')}</p>

        <h2>{t('basicHeading')}</h2>
        <p>{t('basicP1')}</p>

        <h2>{t('notAllowedHeading')}</h2>
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

        <h2>{t('consequencesHeading')}</h2>
        <p>{t.rich('consequencesP1', { ...strongTag, br: () => <br /> })}</p>

        <h2>{t('reportingHeading')}</h2>
        <p>{t.rich('reportingP1', emailTag())}</p>
      </div>
    </StaticPageShell>
  )
}
