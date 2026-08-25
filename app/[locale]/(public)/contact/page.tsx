import { Mail } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { StaticPageShell } from '@/components/static/StaticPageShell'
import { emailTag, listItemTag } from '@/components/static/richTags'

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'contact' })
  return buildMetadata({
    title: t('metaTitle'),
    description: t('metaDescription'),
    path: '/contact',
    locale,
  })
}

const WHATSAPP_HREF = 'https://wa.me/2349032395685?text=Hi%20SentinelX%2C%20I%20need%20help%20with...'

export default async function ContactPage() {
  const t = await getTranslations('contact')
  return (
    <StaticPageShell eyebrow={t('eyebrow')} title={t('title')} subtitle={t('subtitle')}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-sx-border bg-sx-surface p-6">
          <p className="mb-2 flex items-center gap-2 text-sm font-bold text-white">
            <Mail className="h-4 w-4 text-sx-purple-text" /> {t('emailLabel')}
          </p>
          <a
            href="mailto:sentinelxesports@gmail.com"
            className="text-sm font-semibold text-sx-purple-text hover:text-white"
          >
            sentinelxesports@gmail.com
          </a>
          <p className="mt-2 text-xs text-sx-gray">{t('emailResponseNote')}</p>
        </div>
        <div className="rounded-xl border border-sx-border bg-sx-surface p-6">
          <p className="mb-2 flex items-center gap-2 text-sm font-bold text-white">
            <WhatsAppIcon className="h-4 w-4 text-[#25D366]" /> {t('whatsappLabel')}
          </p>
          <p className="text-sm font-semibold text-white">+234 903 239 5685</p>
          <p className="mt-2 text-xs text-sx-gray">{t('whatsappNote')}</p>
          <a
            href={WHATSAPP_HREF}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-sx-purple px-4 py-2.5 text-xs font-bold text-white hover:bg-sx-purple-light"
          >
            {t('whatsappCta')}
          </a>
        </div>
      </div>

      <div className="prose prose-invert prose-sm sm:prose-base mt-10 max-w-none prose-headings:font-display prose-headings:font-bold prose-headings:text-white prose-h2:mt-8 prose-h2:text-lg prose-p:text-sx-gray prose-li:text-sx-gray prose-strong:text-white">
        <h2>{t('whatToIncludeHeading')}</h2>
        <p>{t('whatToIncludeIntro')}</p>
        <ul>{t.rich('whatToIncludeList', listItemTag)}</ul>

        <h2>{t('commonIssuesHeading')}</h2>
        <p>
          <strong>{t('forgotPasswordLabel')}</strong> {t('forgotPasswordP')}
        </p>
        <p>
          <strong>{t('paymentIssueLabel')}</strong> {t('paymentIssueP')}
        </p>
        <p>
          <strong>{t('matchDisputeLabel')}</strong> {t('matchDisputeP')}
        </p>
        <p>
          <strong>{t('withdrawalLabel')}</strong> {t('withdrawalP')}
        </p>

        <h2>{t('reportAbuseHeading')}</h2>
        <p>{t.rich('reportAbuseP1', emailTag())}</p>
      </div>
    </StaticPageShell>
  )
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
      <path d="M12.004 2c-5.514 0-9.997 4.483-9.997 9.997 0 1.762.462 3.482 1.34 5.003L2 22l5.126-1.334a9.973 9.973 0 0 0 4.878 1.243h.004c5.514 0 9.997-4.483 9.997-9.997S17.518 2 12.004 2Zm5.848 15.833a8.28 8.28 0 0 1-5.848 2.423h-.003a8.29 8.29 0 0 1-4.223-1.155l-.303-.18-3.043.792.812-2.968-.198-.305a8.284 8.284 0 0 1-1.269-4.443c0-4.59 3.735-8.325 8.328-8.325 2.225 0 4.316.867 5.888 2.44a8.267 8.267 0 0 1 2.436 5.888c0 4.593-3.734 8.328-8.328 8.328Z" />
    </svg>
  )
}
