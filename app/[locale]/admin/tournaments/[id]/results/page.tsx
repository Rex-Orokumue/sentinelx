import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { listCompletedMatches, groupCompletedMatchesByDate } from '@/lib/matches/completed-matches'
import { CompletedMatchesList } from '@/components/tournament/CompletedMatchesList'
import { ResultsDateFilter } from '@/components/tournament/ResultsDateFilter'

export const metadata: Metadata = { title: 'Results · Admin · SentinelX' }

export default async function AdminTournamentResultsPage({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams: { date?: string }
}) {
  await requireStaff()
  const supabase = createClient()
  const { data: t } = await supabase
    .from('tournaments')
    .select('id, title')
    .eq('id', params.id)
    .maybeSingle()
  if (!t) notFound()

  const matches = await listCompletedMatches(supabase, t.id)
  const groups = groupCompletedMatchesByDate(matches)
  const activeDate = searchParams.date
  const visibleGroups = activeDate ? groups.filter((g) => g.dateKey === activeDate) : groups

  return (
    <section>
      <Link href="/admin/tournaments" className="text-sm text-violet-400 hover:text-violet-300">
        ← Tournaments
      </Link>
      <h2 className="mb-4 mt-2 text-base font-bold text-white">{t.title} · Results</h2>
      <ResultsDateFilter groups={groups} activeDate={activeDate} basePath={`/admin/tournaments/${t.id}/results`} />
      <CompletedMatchesList
        groups={visibleGroups}
        reviewHrefFor={(id) => `/admin/matches/${id}/review?from=tournament-results`}
      />
    </section>
  )
}
