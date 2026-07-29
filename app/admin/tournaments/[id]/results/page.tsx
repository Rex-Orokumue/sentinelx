import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { listCompletedMatches } from '@/lib/matches/completed-matches'
import { CompletedMatchesList } from '@/components/tournament/CompletedMatchesList'

export const metadata: Metadata = { title: 'Results · Admin · SentinelX' }

export default async function AdminTournamentResultsPage({ params }: { params: { id: string } }) {
  await requireStaff()
  const supabase = createClient()
  const { data: t } = await supabase
    .from('tournaments')
    .select('id, title')
    .eq('id', params.id)
    .maybeSingle()
  if (!t) notFound()

  const matches = await listCompletedMatches(supabase, t.id)

  return (
    <section>
      <Link href="/admin/tournaments" className="text-sm text-violet-400 hover:text-violet-300">
        ← Tournaments
      </Link>
      <h2 className="mb-4 mt-2 text-base font-bold text-white">{t.title} · Results</h2>
      <CompletedMatchesList matches={matches} reviewHrefFor={(id) => `/admin/matches/${id}/review`} />
    </section>
  )
}
