import type { ReactNode } from 'react'
import { getTranslations } from 'next-intl/server'
import { proseClassName } from '@/components/static/StaticPageShell'
import { buildToc } from '@/lib/static/toc'
import { TocNav } from '@/components/static/TocNav'
import { LegalContactCta } from '@/components/static/LegalContactCta'

export type LegalSection = { id: string; title: string; body: ReactNode }

type LegalDocShellProps = {
  eyebrow?: string
  title: string
  subtitle?: string
  meta?: string[]
  summary?: ReactNode
  sections: LegalSection[]
  contactCta?: boolean
}

export async function LegalDocShell({
  eyebrow,
  title,
  subtitle,
  meta,
  summary,
  sections,
  contactCta = true,
}: LegalDocShellProps) {
  const t = await getTranslations('legalCommon')
  const toc = buildToc(sections)

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <header className="mb-8 border-b border-sx-border pb-6">
        {eyebrow && (
          <p className="mb-2 text-xs font-bold uppercase tracking-widest text-sx-purple-text">{eyebrow}</p>
        )}
        <h1 className="font-display text-3xl font-black uppercase leading-tight text-white sm:text-4xl">
          {title}
        </h1>
        {subtitle && <p className="mt-2 text-sm text-sx-gray">{subtitle}</p>}
        {meta && meta.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {meta.map((m) => (
              <span
                key={m}
                className="rounded-full border border-sx-border bg-sx-surface px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-sx-gray"
              >
                {m}
              </span>
            ))}
          </div>
        )}
      </header>

      {summary && (
        <div className="mb-8 rounded-xl border border-sx-purple/30 bg-sx-surface p-5">
          <p className="mb-2 text-xs font-bold uppercase tracking-widest text-sx-purple-text">
            {t('summaryLabel')}
          </p>
          <div className="text-sm text-sx-gray">{summary}</div>
        </div>
      )}

      <TocNav variant="disclosure" entries={toc} label={t('tocLabel')} />

      <div className="lg:grid lg:grid-cols-[200px_1fr] lg:gap-10">
        <TocNav variant="rail" entries={toc} label={t('tocLabel')} />

        <div>
          {sections.map((section, i) => (
            <section
              key={section.id}
              id={section.id}
              className="scroll-mt-24 border-t border-sx-border pt-8 first:border-0 first:pt-0"
            >
              <h2 className="mb-4 font-display text-xl font-bold text-white">
                <span className="mr-2 text-sx-purple-text">{i + 1}.</span>
                {stripLeadingNumber(section.title)}
              </h2>
              <div className={proseClassName}>{section.body}</div>
            </section>
          ))}

          {contactCta && <LegalContactCta />}
        </div>
      </div>
    </div>
  )
}

// Section titles in the catalogue keep their "1. " / "9. " prefix (they are
// also the ToC labels). The shell renders its own number chip, so strip the
// baked-in one from the <h2>.
function stripLeadingNumber(title: string): string {
  return title.replace(/^\s*\d+[.)]\s*/, '')
}
