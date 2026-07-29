import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { loadBracketView } from '@/lib/tournaments/bracket-view'
import { BracketActions } from '@/components/admin/BracketActions'
import { AdminBracketView } from '@/components/admin/AdminBracketView'

export const metadata: Metadata = { title: 'Bracket · Admin · SentinelX' }

export default async function AdminBracketPage({ params }: { params: { id: string } }) {
  await requireStaff()
  const supabase = createClient()
  const { data: t } = await supabase
    .from('tournaments')
    .select('id, title, status, round_start_date, round_gap_days')
    .eq('id', params.id)
    .maybeSingle()
  if (!t) notFound()

  const view = await loadBracketView(supabase, t.id)
  const { count: paidCount } = await supabase
    .from('tournament_registrations')
    .select('*', { count: 'exact', head: true })
    .eq('tournament_id', t.id)
    .eq('payment_status', 'paid')

  return (
    <section>
      <div className="flex items-center justify-between">
        <Link href="/admin/tournaments" className="text-sm text-violet-400 hover:text-violet-300">
          ← Tournaments
        </Link>
        <Link
          href={`/admin/tournaments/${t.id}/matches`}
          className="text-sm text-violet-400 hover:text-violet-300"
        >
          Manage matches →
        </Link>
      </div>
      <h2 className="mb-4 mt-2 text-base font-bold text-white">
        {t.title} · <span className="text-slate-400">{t.status.replace(/_/g, ' ')}</span>
      </h2>

      <BracketActions
        tournamentId={t.id}
        status={t.status}
        paidCount={paidCount ?? 0}
        roundStartDate={t.round_start_date}
        roundGapDays={t.round_gap_days}
      />

      {!view.hasGroups && !view.hasKnockout ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center text-sm text-slate-500">
          No bracket yet. Close registration to generate one.
        </p>
      ) : (
        <AdminBracketView
          standings={view.standings}
          fixtures={view.fixtures}
          rounds={view.rounds}
          projected={view.projected}
          champion={view.champion}
          hasGroups={view.hasGroups}
        />
      )}
    </section>
  )
}
