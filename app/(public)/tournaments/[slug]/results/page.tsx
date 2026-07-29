import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { listCompletedMatches } from '@/lib/matches/completed-matches'
import { CompletedMatchesList } from '@/components/tournament/CompletedMatchesList'
import { buildMetadata } from '@/lib/seo/metadata'
import { DEFAULT_OG_IMAGE } from '@/lib/seo/site'

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

export default async function TournamentResultsPage({ params }: { params: { slug: string } }) {
  const t = await getTournament(params.slug)
  if (!t) notFound()

  const supabase = createClient()
  const matches = await listCompletedMatches(supabase, t.id)

  return (
    <div className="mx-auto max-w-3xl px-4 pb-20">
      <Link href={`/tournaments/${t.slug}`} className="mt-6 mb-4 inline-block text-sm text-violet-400 hover:text-violet-300">
        ← {t.title}
      </Link>
      <h1 className="mb-4 text-xl font-black text-white">Results</h1>
      <CompletedMatchesList matches={matches} />
    </div>
  )
}
