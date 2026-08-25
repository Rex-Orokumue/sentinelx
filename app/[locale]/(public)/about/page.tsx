import Image from 'next/image'
import { getTranslations } from 'next-intl/server'
import { ShieldCheck, Target, Eye, Gem, Flag, Trophy, Users, Rocket, Handshake, BookOpen, Gift } from 'lucide-react'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { DEFAULT_OG_IMAGE } from '@/lib/seo/site'
import { findOptionalPublicImage } from '@/lib/media/optional-image'
import { ImagePlaceholder } from '@/components/ui/ImagePlaceholder'

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'about' })
  return buildMetadata({
    title: t('metaTitle'),
    description: t('metaDescription'),
    path: '/about',
    image: DEFAULT_OG_IMAGE,
    locale,
  })
}

const WHATSAPP_COMMUNITY = process.env.NEXT_PUBLIC_WHATSAPP_COMMUNITY_URL ?? '#'

export default async function AboutPage() {
  const t = await getTranslations('about')
  const whySentinelImg = findOptionalPublicImage('about', 'why-sentinel-x')
  const missionImg = findOptionalPublicImage('about', 'mission-bg')
  const visionImg = findOptionalPublicImage('about', 'vision-bg')

  const badges = [
    { title: t('badge1Title'), body: t('badge1Body') },
    { title: t('badge2Title'), body: t('badge2Body') },
    { title: t('badge3Title'), body: t('badge3Body') },
  ]

  const values = [
    { label: t('value1Label'), body: t('value1Body') },
    { label: t('value2Label'), body: t('value2Body') },
    { label: t('value3Label'), body: t('value3Body') },
    { label: t('value4Label'), body: t('value4Body') },
  ]

  // Aspirational/vision numbers, not live DB stats — hardcoded per spec §3.6. Not
  // language-dependent, only the label is translated.
  const stats = [
    { value: '50K+', label: t('stat1Label') },
    { value: '1,200+', label: t('stat2Label') },
    { value: '10+', label: t('stat3Label') },
    { value: '15+', label: t('stat4Label') },
    { value: '∞', label: t('stat5Label') },
  ]

  const timeline = [
    { icon: Flag, year: '2024', title: t('timeline1Title'), body: t('timeline1Body') },
    { icon: Trophy, year: '2024', title: t('timeline2Title'), body: t('timeline2Body') },
    { icon: Users, year: '2025', title: t('timeline3Title'), body: t('timeline3Body') },
    { icon: Rocket, year: '2026+', title: t('timeline4Title'), body: t('timeline4Body') },
  ]

  const pillars = [
    { icon: Trophy, label: t('pillar1Label') },
    { icon: Users, label: t('pillar2Label') },
    { icon: ShieldCheck, label: t('pillar3Label') },
    { icon: Gift, label: t('pillar4Label') },
    { icon: Handshake, label: t('pillar5Label') },
    { icon: BookOpen, label: t('pillar6Label') },
  ]

  return (
    <div className="mx-auto max-w-7xl px-4 pb-20 sm:px-6 lg:px-8">
      {/* ── Hero ──────────────────────────────────────────────── */}
      <section className="relative mb-10 overflow-hidden rounded-2xl border border-sx-border bg-sx-surface">
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-sx-purple/25 blur-[100px]"
        />
        <div className="relative px-6 py-10 sm:px-10 sm:py-14 lg:py-16 lg:pr-64 xl:pr-[22rem]">
          <div className="text-center lg:text-left">
            <p className="mb-3 text-xs font-bold uppercase tracking-widest text-sx-purple-text">{t('heroEyebrow')}</p>
            <h1 className="font-display text-4xl font-black uppercase leading-[0.95] tracking-tight text-white sm:text-5xl lg:text-6xl">
              {t('heroTitleLine1')}
              <br />
              <span className="text-sx-purple-text">{t('heroTitleLine2')}</span>
            </h1>
            <p className="mx-auto mt-4 max-w-md text-sm text-sx-gray sm:text-base lg:mx-0">{t('heroSubtitle')}</p>
            <div className="mt-6 flex flex-wrap justify-center gap-4 text-left lg:justify-start">
              {badges.map((b) => (
                <div key={b.title}>
                  <p className="text-xs font-bold text-white">{b.title}</p>
                  <p className="text-[11px] text-sx-gray">{b.body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* mascot-about.png is the fist-pump pose, not the mockup's open-hand
            reach-toward-viewer render — placeholder until the exact one lands. */}
        <ImagePlaceholder
          className="relative mx-auto -mt-2 h-64 w-52 pb-8 sm:h-80 sm:w-64 lg:absolute lg:inset-y-0 lg:right-56 lg:mx-0 lg:h-auto lg:w-56 lg:pb-0 xl:right-64 xl:w-64"
          label={'Sentinel mascot — open hand reaching toward viewer\n(public/mascot/mascot-about.png)'}
        />

        {/* Our Promise — floats top-right, independent of the mascot's height */}
        <div className="relative mx-auto mt-6 w-full max-w-xs rounded-xl border border-sx-purple/30 bg-sx-surface p-5 lg:absolute lg:right-6 lg:top-8 lg:mx-0 lg:mt-0 lg:w-56 xl:w-64">
          <p className="mb-2 flex items-center gap-2 text-sm font-bold text-white">
            <ShieldCheck className="h-4 w-4 text-sx-purple-text" /> {t('promiseLabel')}
          </p>
          <p className="text-xs italic text-sx-gray">{t('promiseQuote')}</p>
          <p className="mt-3 font-display text-lg italic text-sx-purple-text">{t('promiseAttribution')}</p>
        </div>
      </section>

      {/* ── Mission / Vision / Values ─────────────────────────── */}
      <section className="mb-10 grid gap-4 lg:grid-cols-3">
        <MissionCard icon={Target} label={t('missionLabel')} bgImage={missionImg}>
          {t('missionBody')}
        </MissionCard>
        <MissionCard icon={Eye} label={t('visionLabel')} bgImage={visionImg}>
          {t('visionBody')}
        </MissionCard>
        <div className="rounded-xl border border-sx-border bg-sx-surface p-6">
          <p className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-sx-purple-text">
            <Gem className="h-4 w-4" /> {t('valuesLabel')}
          </p>
          <div className="space-y-2.5">
            {values.map((v) => (
              <p key={v.label} className="text-sm text-white">
                <span className="font-bold">{v.label}</span> <span className="text-sx-gray">— {v.body}</span>
              </p>
            ))}
          </div>
        </div>
      </section>

      {/* ── Stats bar ─────────────────────────────────────────── */}
      <section className="mb-10 grid grid-cols-2 gap-4 rounded-xl border border-sx-border bg-sx-surface p-6 sm:grid-cols-5">
        {stats.map((s) => (
          <div key={s.label} className="text-center">
            <p className="font-display text-2xl font-black text-white">{s.value}</p>
            <p className="mt-0.5 text-[11px] uppercase tracking-wide text-sx-gray">{s.label}</p>
          </div>
        ))}
      </section>

      {/* ── Our Story timeline ────────────────────────────────── */}
      <section className="mb-10 rounded-xl border border-sx-border bg-sx-surface p-6 sm:p-8">
        <p className="mb-1 text-xs font-bold uppercase tracking-widest text-sx-purple-text">{t('storyLabel')}</p>
        <h2 className="mb-3 font-display text-2xl font-black text-white">{t('storyHeading')}</h2>
        <p className="mb-8 max-w-2xl text-sm text-sx-gray">{t('storyIntro')}</p>
        <div className="relative grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div
            aria-hidden
            className="absolute left-5 right-5 top-5 hidden h-px bg-gradient-to-r from-transparent via-sx-purple/40 to-transparent lg:block"
          />
          {timeline.map((t2) => (
            <div key={t2.year + t2.title} className="relative">
              <span className="relative z-10 mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-sx-purple/30 bg-sx-bg text-sx-purple-text">
                <t2.icon className="h-5 w-5" />
              </span>
              <p className="text-xs font-bold text-sx-purple-text">{t2.year}</p>
              <p className="mb-1 font-bold text-white">{t2.title}</p>
              <p className="text-xs text-sx-gray">{t2.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Why Sentinel X ────────────────────────────────────── */}
      <section className="mb-10 grid gap-8 rounded-xl border border-sx-border bg-sx-surface p-6 sm:p-8 lg:grid-cols-2 lg:items-center">
        {whySentinelImg ? (
          <div className="relative mx-auto h-64 w-full max-w-sm overflow-hidden rounded-xl">
            <Image src={whySentinelImg} alt="" fill className="object-cover" />
          </div>
        ) : (
          <ImagePlaceholder
            className="mx-auto h-64 w-full max-w-sm"
            label={'Stadium/arena crowd photo — mascot seen from behind, facing the stage\n(public/about/why-sentinel-x.jpg)'}
          />
        )}
        <div>
          <p className="mb-1 text-xs font-bold uppercase tracking-widest text-sx-purple-text">{t('whySentinelLabel')}</p>
          <h2 className="mb-5 font-display text-2xl font-black text-white">{t('whySentinelHeading')}</h2>
          <div className="grid grid-cols-2 gap-5">
            {pillars.map((p) => (
              <div key={p.label} className="flex items-center gap-2.5">
                <p.icon className="h-5 w-5 shrink-0 text-sx-purple-text" />
                <p className="text-sm font-semibold text-white">{p.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA banner ────────────────────────────────────────── */}
      <section className="relative overflow-hidden rounded-xl border border-sx-purple/30 bg-gradient-to-r from-sx-purple/20 to-transparent py-8 pl-24 pr-8 text-center sm:pl-32">
        <div className="pointer-events-none absolute bottom-0 left-2 hidden h-full w-24 sm:block">
          <Image src="/mascot/mascot-about.png" alt="" fill sizes="6rem" className="object-contain object-bottom" />
        </div>
        <p className="font-display text-2xl font-black uppercase text-white sm:text-3xl">{t('ctaHeading')}</p>
        <p className="mt-2 text-sm text-sx-gray">{t('ctaSubtitle')}</p>
        <a
          href={WHATSAPP_COMMUNITY}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-sx-purple px-6 py-3 text-sm font-bold text-white shadow-[0_0_20px_rgba(124,58,237,0.4)] transition-colors hover:bg-sx-purple-light"
        >
          <Users className="h-4 w-4" /> {t('ctaButton')}
        </a>
      </section>
    </div>
  )
}

function MissionCard({
  icon: Icon,
  label,
  bgImage,
  children,
}: {
  icon: typeof Target
  label: string
  bgImage: string | null
  children: React.ReactNode
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-sx-border bg-sx-surface p-6">
      {bgImage && (
        <>
          <Image src={bgImage} alt="" fill className="object-cover opacity-20" />
          <div className="absolute inset-0 bg-gradient-to-t from-sx-surface via-sx-surface/80 to-sx-surface/40" />
        </>
      )}
      <div className="relative">
        <p className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-sx-purple-text">
          <Icon className="h-4 w-4" /> {label}
        </p>
        <p className="text-sm text-sx-gray">{children}</p>
      </div>
    </div>
  )
}
