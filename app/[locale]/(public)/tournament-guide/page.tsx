import { getTranslations } from 'next-intl/server'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { StaticPageShell, proseClassName } from '@/components/static/StaticPageShell'
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
    <StaticPageShell eyebrow={t('eyebrow')} title={t('title')} subtitle={t('subtitle')}>
      <div className={proseClassName}>
        <h2>{t('beforeRegHeading')}</h2>
        <p>
          <strong>{t('checkGameLabel')}</strong> {t('checkGameP')}
        </p>
        <p>
          <strong>{t('checkFormatLabel')}</strong> {t('checkFormatP')}
        </p>
        <p>
          <strong>{t('checkScheduleLabel')}</strong> {t('checkScheduleP')}
        </p>
        <p>
          <strong>{t('checkBalanceLabel')}</strong> {t('checkBalanceP')}
        </p>

        <h2>{t('registeringHeading')}</h2>
        <ol>{t.rich('registeringList', listItemTag)}</ol>

        <h2>{t('afterRegHeading')}</h2>
        <p>{t('afterRegP1')}</p>
        <p>{t('afterRegP2')}</p>

        <h2>{t('playingHeading')}</h2>
        <p>
          <strong>{t('prepareLabel')}</strong> {t('prepareP')}
        </p>
        <p>
          <strong>{t('recordLabel')}</strong> {t('recordP')}
        </p>
        <p>
          <strong>{t('joinLabel')}</strong> {t('joinP')}
        </p>
        <p>
          <strong>{t('playLabel')}</strong> {t('playP')}
        </p>

        <h2>{t('submittingHeading')}</h2>
        <p>{t('submittingIntro')}</p>
        <ol>{t.rich('submittingList', listItemTag)}</ol>
        <p>{t('submittingP2')}</p>

        <h2>{t('afterSubmissionHeading')}</h2>
        <p>{t('afterSubmissionP1')}</p>
        <p>{t('afterSubmissionP2')}</p>

        <h2>{t('tipsHeading')}</h2>
        <ul>{t.rich('tipsList', listItemTag)}</ul>
      </div>
    </StaticPageShell>
  )
}
