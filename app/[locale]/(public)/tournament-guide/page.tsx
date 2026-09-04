import { getTranslations } from 'next-intl/server'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { LegalDocShell } from '@/components/static/LegalDocShell'
import { listItemTag } from '@/components/static/richTags'

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'tournamentGuide' })
  return buildMetadata({
    title: t('metaTitle'),
    description: t('metaDescription'),
    path: '/tournament-guide',
    locale,
  })
}

export default async function TournamentGuidePage() {
  const t = await getTranslations('tournamentGuide')
  return (
    <LegalDocShell
      eyebrow={t('eyebrow')}
      title={t('title')}
      subtitle={t('subtitle')}
      summary={t('summary')}
      sections={[
        {
          id: 'before-you-register',
          title: t('beforeRegHeading'),
          body: (
            <>
              <p><strong>{t('checkGameLabel')}</strong> {t('checkGameP')}</p>
              <p><strong>{t('checkFormatLabel')}</strong> {t('checkFormatP')}</p>
              <p><strong>{t('checkScheduleLabel')}</strong> {t('checkScheduleP')}</p>
              <p><strong>{t('checkBalanceLabel')}</strong> {t('checkBalanceP')}</p>
            </>
          ),
        },
        { id: 'registering', title: t('registeringHeading'), body: <ol>{t.rich('registeringList', listItemTag)}</ol> },
        {
          id: 'after-registering',
          title: t('afterRegHeading'),
          body: <><p>{t('afterRegP1')}</p><p>{t('afterRegP2')}</p></>,
        },
        {
          id: 'playing',
          title: t('playingHeading'),
          body: (
            <>
              <p><strong>{t('prepareLabel')}</strong> {t('prepareP')}</p>
              <p><strong>{t('recordLabel')}</strong> {t('recordP')}</p>
              <p><strong>{t('joinLabel')}</strong> {t('joinP')}</p>
              <p><strong>{t('playLabel')}</strong> {t('playP')}</p>
            </>
          ),
        },
        {
          id: 'submitting',
          title: t('submittingHeading'),
          body: (
            <>
              <p>{t('submittingIntro')}</p>
              <ol>{t.rich('submittingList', listItemTag)}</ol>
              <p>{t('submittingP2')}</p>
            </>
          ),
        },
        {
          id: 'after-submission',
          title: t('afterSubmissionHeading'),
          body: <><p>{t('afterSubmissionP1')}</p><p>{t('afterSubmissionP2')}</p></>,
        },
        { id: 'tips', title: t('tipsHeading'), body: <ul>{t.rich('tipsList', listItemTag)}</ul> },
      ]}
    />
  )
}
