import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { loadBracketView } from '@/lib/tournaments/bracket-view'
import { BracketActions } from '@/components/admin/BracketActions'
import { GroupStage } from '@/components/bracket/GroupStage'
import { KnockoutBracket } from '@/components/bracket/KnockoutBracket'

export const metadata: Metadata = { title: 'Bracket · Admin · SentinelX' }

export default async function AdminBracketPage({ params }: { params: { id: string } }) {
  await requireStaff()
  const supabase = createClient()
  const { data: t } = await supabase
    .from('tournaments')
    .select('id, title, status')
    .eq('id', params.id)
    .maybeSingle()
  if (!t) notFound()

  const view = await loadBracketView(supabase, t.id)

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

      <BracketActions tournamentId={t.id} status={t.status} />

      {!view.hasGroups && !view.hasKnockout ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center text-sm text-slate-500">
          No bracket yet. Close registration to generate one.
        </p>
      ) : (
        <>
          {view.hasGroups && <GroupStage standings={view.standings} fixtures={view.fixtures} />}
          {view.hasKnockout && <KnockoutBracket rounds={view.rounds} />}
        </>
      )}
    </section>
  )
}
