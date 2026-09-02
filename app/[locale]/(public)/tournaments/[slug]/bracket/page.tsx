import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getStaffContext } from '@/lib/admin/auth'
import { loadBracketView } from '@/lib/tournaments/bracket-view'
import { GroupStage } from '@/components/bracket/GroupStage'
import { BracketTree } from '@/components/bracket/BracketTree'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { DEFAULT_OG_IMAGE } from '@/lib/seo/site'
import { JsonLd } from '@/components/seo/JsonLd'
import { buildBreadcrumbJsonLd } from '@/lib/seo/schema/breadcrumb'
import { GameBadge } from '@/components/game/GameBadge'
import { resolveGameIconUrl } from '@/lib/games/icon'

type BracketGameRef = { name: string; icon_url: string | null; slug: string | null; category: string | null } | null

function firstGame(g: unknown): BracketGameRef {
  return (Array.isArray(g) ? g[0] ?? null : g) as BracketGameRef
}

async function getTournament(slug: string) {
  const supabase = createClient()
  const { data } = await supabase
    .from('tournaments')
    .select('id, title, slug, status, format, games(name, icon_url, slug, category)')
    .eq('slug', slug)
    .maybeSingle()
  if (!data || data.status === 'draft') return null
  return data
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string; locale: Locale }
}): Promise<Metadata> {
  const t = await getTournament(params.slug)
  if (!t) return { title: 'Bracket — Sentinel X' }
  return buildMetadata({
    title: `Bracket — ${t.title} | Sentinel X`,
    description: `Group standings and knockout bracket for ${t.title} on Sentinel X.`,
    locale: params.locale,
    path: `/tournaments/${t.slug}/bracket`,
    image: DEFAULT_OG_IMAGE,
  })
}

export default async function BracketPage({ params }: { params: { slug: string } }) {
  const t = await getTournament(params.slug)
  if (!t) notFound()
  const game = firstGame(t.games)

  // A generated-but-unpublished bracket (registration_closed) is a staff-only preview.
  const isPreview = t.status === 'registration_closed'
  if (isPreview) {
    const ctx = await getStaffContext()
    if (!ctx?.isStaff) {
      return (
        <div className="mx-auto max-w-3xl px-4 pb-20">
          <Link
            href={`/tournaments/${t.slug}`}
            className="mt-6 mb-4 inline-block text-sm text-violet-400 hover:text-violet-300"
          >
            ← {t.title}
          </Link>
          <div className="mb-6 flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-black text-white">Bracket</h1>
            {game && (
              <GameBadge
                name={game.name}
                iconUrl={resolveGameIconUrl(game)}
                category={game.category}
                showName
                className="text-xs font-semibold uppercase tracking-wide text-slate-500"
              />
            )}
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 py-12 text-center">
            <p className="text-3xl">🗂️</p>
            <p className="mt-3 font-bold text-white">Bracket is being finalized</p>
            <p className="mt-1 text-sm text-slate-500">
              It&apos;ll appear here once the admin publishes it.
            </p>
          </div>
        </div>
      )
    }
  }

  const supabase = createClient()
  const view = await loadBracketView(supabase, t.id, t.format)
  const isEmpty = !view.hasGroups && !view.hasKnockout

  return (
    <div className="mx-auto max-w-3xl px-4 pb-20">
      <JsonLd
        data={buildBreadcrumbJsonLd([
          { name: 'Tournaments', path: '/tournaments' },
          { name: t.title, path: `/tournaments/${t.slug}` },
          { name: 'Bracket', path: `/tournaments/${t.slug}/bracket` },
        ])}
      />
      <Link
        href={`/tournaments/${t.slug}`}
        className="mt-6 mb-4 inline-block text-sm text-violet-400 hover:text-violet-300"
      >
        ← {t.title}
      </Link>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-black text-white">Bracket</h1>
        {game && (
          <GameBadge
            name={game.name}
            iconUrl={resolveGameIconUrl(game)}
            category={game.category}
            showName
            className="text-xs font-semibold uppercase tracking-wide text-slate-500"
          />
        )}
      </div>

      {view.champion && (
        <div className="mb-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-5 py-4 text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-amber-400/80">Champion</p>
          <p className="mt-1 text-xl font-black text-white">🏆 {view.champion.name}</p>
        </div>
      )}

      {view.thirdPlace && (
        <div className="mb-6 rounded-2xl border border-slate-700/40 bg-slate-800/20 px-5 py-3 text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400/80">Third Place</p>
          <p className="mt-1 text-base font-bold text-white">🥉 {view.thirdPlace.name}</p>
        </div>
      )}

      {isEmpty ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 py-12 text-center">
          <p className="text-3xl">🗂️</p>
          <p className="mt-3 font-bold text-white">Bracket not published yet</p>
          <p className="mt-1 text-sm text-slate-500">
            It&apos;ll appear here once registration closes and the admin sets it up.
          </p>
        </div>
      ) : (
        <>
          {view.hasGroups && <GroupStage standings={view.standings} fixtures={view.fixtures} />}
          <BracketTree rounds={view.rounds} projected={view.projected} thirdPlace={view.thirdPlaceMatch} />
        </>
      )}
    </div>
  )
}
