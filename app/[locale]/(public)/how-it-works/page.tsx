import { UserPlus, Trophy, CalendarClock, Gamepad2, Upload, Wallet, Star, Coins, Users2, School } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { StaticPageShell } from '@/components/static/StaticPageShell'

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'howItWorks' })
  return buildMetadata({
    title: t('metaTitle'),
    description: t('metaDescription'),
    path: '/how-it-works',
    locale,
  })
}

export default async function HowItWorksPage() {
  const t = await getTranslations('howItWorks')

  const steps = [
    { icon: UserPlus, n: 1, title: t('step1Title'), body: t('step1Body') },
    { icon: Trophy, n: 2, title: t('step2Title'), body: t('step2Body') },
    { icon: CalendarClock, n: 3, title: t('step3Title'), body: t('step3Body') },
    { icon: Gamepad2, n: 4, title: t('step4Title'), body: t('step4Body') },
    { icon: Upload, n: 5, title: t('step5Title'), body: t('step5Body') },
    { icon: Wallet, n: 6, title: t('step6Title'), body: t('step6Body') },
  ]

  return (
    <StaticPageShell eyebrow={t('eyebrow')} title={t('title')} subtitle={t('subtitle')}>
      <div className="space-y-4">
        {steps.map((s) => (
          <div key={s.n} className="flex gap-4 rounded-xl border border-sx-border bg-sx-surface p-5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sx-purple/15 text-sx-purple-text">
              <s.icon className="h-5 w-5" />
            </span>
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-sx-purple-text">
                {t('stepLabel')} {s.n}
              </p>
              <p className="mt-0.5 font-bold text-white">{s.title}</p>
              <p className="mt-1 text-sm text-sx-gray">{s.body}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-10 space-y-4">
        <InfoSection icon={Star} title={t('sxScoreHeading')}>
          {t('sxScoreBody')}
        </InfoSection>
        <InfoSection icon={Coins} title={t('sxCoinsHeading')}>
          {t('sxCoinsBody')}
        </InfoSection>
        <InfoSection icon={Users2} title={t('communityHeading')}>
          {t('communityBody')}
        </InfoSection>
      </div>

      <div className="mt-10 rounded-xl border border-sx-border/60 bg-sx-surface/40 p-5 opacity-70">
        <p className="mb-3 text-xs font-bold uppercase tracking-widest text-sx-gray">{t('comingSoonLabel')}</p>
        <div className="space-y-2 text-sm text-sx-gray">
          <p className="flex items-center gap-2">
            <School className="h-4 w-4 shrink-0" />{' '}
            <span>
              <strong className="text-white">{t('teamLeaguesTitle')}</strong> — {t('teamLeaguesBody')}
            </span>
          </p>
        </div>
      </div>
    </StaticPageShell>
  )
}

function InfoSection({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Star
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-sx-border bg-sx-surface p-5">
      <p className="mb-2 flex items-center gap-2 text-sm font-bold text-white">
        <Icon className="h-4 w-4 text-sx-purple-text" /> {title}
      </p>
      <p className="text-sm text-sx-gray">{children}</p>
    </div>
  )
}
