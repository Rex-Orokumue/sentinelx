import { getTranslations } from 'next-intl/server'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { StaticPageShell, proseClassName } from '@/components/static/StaticPageShell'
import { emailTag, linkTag, listItemTag, strongTag } from '@/components/static/richTags'

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'privacy' })
  return buildMetadata({
    title: t('metaTitle'),
    description: t('metaDescription'),
    path: '/privacy',
    locale,
  })
}

const DATA_USE_KEYS = ['account', 'payment', 'prizes', 'whatsapp', 'improving', 'fraud', 'compliance'] as const

export default async function PrivacyPage() {
  const t = await getTranslations('privacy')
  const dataUses = DATA_USE_KEYS.map((key) => ({
    purpose: t(`dataUses.${key}.purpose`),
    basis: t(`dataUses.${key}.basis`),
  }))

  return (
    <StaticPageShell eyebrow={t('eyebrow')} title={t('title')} subtitle={t('subtitle')}>
      <div className={proseClassName}>
        <h2>{t('s1Heading')}</h2>
        <p>{t.rich('s1P1', emailTag())}</p>

        <h2>{t('s2Heading')}</h2>
        <p>
          <strong>{t('s2Account')}</strong>
        </p>
        <ul>{t.rich('s2AccountList', listItemTag)}</ul>
        <p>
          <strong>{t('s2Profile')}</strong>
        </p>
        <ul>{t.rich('s2ProfileList', listItemTag)}</ul>
        <p>
          <strong>{t('s2Tournament')}</strong>
        </p>
        <ul>{t.rich('s2TournamentList', listItemTag)}</ul>
        <p>
          <strong>{t('s2Play')}</strong>
        </p>
        <ul>{t.rich('s2PlayList', listItemTag)}</ul>
        <p>
          <strong>{t('s2Auto')}</strong>
        </p>
        <ul>{t.rich('s2AutoList', listItemTag)}</ul>
      </div>

      <h2 className="mt-10 font-display text-xl font-bold text-white">{t('s3Heading')}</h2>
      <div className="not-prose my-4 overflow-x-auto rounded-lg border border-sx-border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-sx-border bg-sx-surface">
              <th className="border-r border-sx-border px-4 py-2.5 text-left font-bold text-white">
                {t('tableHeaderPurpose')}
              </th>
              <th className="px-4 py-2.5 text-left font-bold text-white">{t('tableHeaderBasis')}</th>
            </tr>
          </thead>
          <tbody>
            {dataUses.map((row) => (
              <tr key={row.purpose} className="border-b border-sx-border last:border-0">
                <td className="border-r border-sx-border px-4 py-2.5 text-sx-gray">{row.purpose}</td>
                <td className="px-4 py-2.5 text-sx-gray">{row.basis}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={proseClassName}>
        <h2>{t('s4Heading')}</h2>
        <p>{t('s4Intro')}</p>
        <ul>{t.rich('s4List', { ...listItemTag, ...strongTag })}</ul>
        <p>{t('s4P2')}</p>
        <p>{t('s4P3')}</p>

        <h2>{t('s5Heading')}</h2>
        <p>{t('s5P1')}</p>

        <h2>{t('s6Heading')}</h2>
        <p>{t('s6Intro')}</p>
        <ul>{t.rich('s6List', { ...listItemTag, ...strongTag })}</ul>
        <p>{t.rich('s6P2', emailTag())}</p>
        <p>{t.rich('s6P3', linkTag('https://ndpc.gov.ng', { external: true }))}</p>

        <h2>{t('s7Heading')}</h2>
        <p>{t('s7P1')}</p>
        <p>{t('s7P2')}</p>

        <h2>{t('s8Heading')}</h2>
        <p>{t('s8P1')}</p>

        <h2>{t('s9Heading')}</h2>
        <p>{t('s9P1')}</p>

        <h2>{t('s10Heading')}</h2>
        <p>{t('s10P1')}</p>
      </div>
    </StaticPageShell>
  )
}
