import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getStaffContext } from '@/lib/admin/auth'
import { loadBracketView } from '@/lib/tournaments/bracket-view'
import { GroupStage } from '@/components/bracket/GroupStage'
import { KnockoutBracket } from '@/components/bracket/KnockoutBracket'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sentinelx.gg'

async function getTournament(slug: string) {
  const supabase = createClient()
  const { data } = await supabase
    .from('tournaments')
    .select('id, title, slug, status')
    .eq('slug', slug)
    .maybeSingle()
  if (!data || data.status === 'draft') return null
  return data
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string }
}): Promise<Metadata> {
  const t = await getTournament(params.slug)
  if (!t) return { title: 'Bracket — Sentinel X' }
  const title = `Bracket — ${t.title} | Sentinel X`
  const description = `Group standings and knockout bracket for ${t.title} on Sentinel X.`
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `${SITE_URL}/tournaments/${t.slug}/bracket`,
      siteName: 'Sentinel X',
      type: 'website',
    },
  }
}

export default async function BracketPage({ params }: { params: { slug: string } }) {
  const t = await getTournament(params.slug)
  if (!t) notFound()

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
          <h1 className="mb-6 text-2xl font-black text-white">Bracket</h1>
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
  const view = await loadBracketView(supabase, t.id)
  const isEmpty = !view.hasGroups && !view.hasKnockout

  return (
    <div className="mx-auto max-w-3xl px-4 pb-20">
      <Link
        href={`/tournaments/${t.slug}`}
        className="mt-6 mb-4 inline-block text-sm text-violet-400 hover:text-violet-300"
      >
        ← {t.title}
      </Link>
      <h1 className="mb-6 text-2xl font-black text-white">Bracket</h1>

      {view.champion && (
        <div className="mb-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-5 py-4 text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-amber-400/80">Champion</p>
          <p className="mt-1 text-xl font-black text-white">🏆 {view.champion.name}</p>
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
          {view.hasKnockout && <KnockoutBracket rounds={view.rounds} />}
        </>
      )}
    </div>
  )
}
