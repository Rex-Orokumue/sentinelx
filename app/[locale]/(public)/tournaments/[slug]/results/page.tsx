import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { listCompletedMatches, groupCompletedMatchesByDate } from '@/lib/matches/completed-matches'
import { CompletedMatchesList } from '@/components/tournament/CompletedMatchesList'
import { ResultsDateFilter } from '@/components/tournament/ResultsDateFilter'
import { buildMetadata } from '@/lib/seo/metadata'
import { DEFAULT_OG_IMAGE } from '@/lib/seo/site'
import { JsonLd } from '@/components/seo/JsonLd'
import { buildBreadcrumbJsonLd } from '@/lib/seo/schema/breadcrumb'

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
  if (!t) return { title: 'Results — Sentinel X' }
  return buildMetadata({
    title: `Results — ${t.title} | Sentinel X`,
    description: `Match results and scores for ${t.title} on Sentinel X.`,
    path: `/tournaments/${t.slug}/results`,
    image: DEFAULT_OG_IMAGE,
  })
}

export default async function TournamentResultsPage({
  params,
  searchParams,
}: {
  params: { slug: string }
  searchParams: { date?: string }
}) {
  const t = await getTournament(params.slug)
  if (!t) notFound()

  const supabase = createClient()
  const matches = await listCompletedMatches(supabase, t.id)
  const groups = groupCompletedMatchesByDate(matches)
  const activeDate = searchParams.date
  const visibleGroups = activeDate ? groups.filter((g) => g.dateKey === activeDate) : groups

  return (
    <div className="mx-auto max-w-3xl px-4 pb-20">
      <JsonLd
        data={buildBreadcrumbJsonLd([
          { name: 'Tournaments', path: '/tournaments' },
          { name: t.title, path: `/tournaments/${t.slug}` },
          { name: 'Results', path: `/tournaments/${t.slug}/results` },
        ])}
      />
      <Link href={`/tournaments/${t.slug}`} className="mt-6 mb-4 inline-block text-sm text-violet-400 hover:text-violet-300">
        ← {t.title}
      </Link>
      <h1 className="mb-4 text-xl font-black text-white">Results</h1>
      <ResultsDateFilter groups={groups} activeDate={activeDate} basePath={`/tournaments/${t.slug}/results`} />
      <CompletedMatchesList groups={visibleGroups} />
    </div>
  )
}
