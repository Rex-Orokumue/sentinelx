import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'

export async function LegalContactCta() {
  const t = await getTranslations('legalCommon')
  return (
    <div className="mt-12 rounded-xl border border-sx-purple/30 bg-sx-surface p-6 text-center">
      <p className="font-display text-lg font-bold text-white">{t('contactCtaHeading')}</p>
      <Link
        href="/contact"
        className="mt-4 inline-flex items-center rounded-lg bg-sx-purple px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-sx-purple-light"
      >
        {t('contactCtaButton')}
      </Link>
    </div>
  )
}
