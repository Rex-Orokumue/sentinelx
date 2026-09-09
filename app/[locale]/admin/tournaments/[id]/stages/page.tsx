import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { StagesEditor, type StageRow } from '@/components/admin/StagesEditor'
import { validateStagePlan } from '@/lib/tournaments/stage-plan'
import { parsePointsConfig, DEFAULT_POINTS_CONFIG } from '@/lib/tournaments/points-config'

export const metadata: Metadata = { title: 'Stages · Admin · SentinelX' }

export default async function StagesPage({ params }: { params: { id: string } }) {
  await requireStaff()
  const supabase = createClient()

  const { data: tournament } = await supabase
    .from('tournaments')
    .select('id, title, competition_format, games(slug)')
    .eq('id', params.id)
    .maybeSingle()
  if (!tournament) notFound()

  const [{ data: stageRows }, { count: entrantCount }] = await Promise.all([
    supabase
      .from('tournament_stages')
      .select('id, seq, name, rounds_count, lobby_size, advance_count, points_config, status')
      .eq('tournament_id', params.id)
      .order('seq'),
    supabase
      .from('tournament_entrants')
      .select('id', { count: 'exact', head: true })
      .eq('tournament_id', params.id)
      .eq('status', 'active'),
  ])

  const stages: StageRow[] = (stageRows ?? []).map((s) => ({
    id: s.id,
    seq: s.seq,
    name: s.name,
    roundsCount: s.rounds_count,
    lobbySize: s.lobby_size,
    advanceCount: s.advance_count,
    status: s.status,
    // A config the parser rejects falls back to an empty table rather than
    // crashing the page — the admin can see and fix it in the field.
    points: parsePointsConfig(s.points_config) ?? { placement: [], perKill: 0 },
  }))

  // Null rather than 0 before anyone has entered: validateStagePlan skips the
  // stage-1 intake check when the field size is genuinely unknown, which is the
  // normal state while an admin is setting the tournament up.
  const issues = validateStagePlan(stages, entrantCount && entrantCount > 0 ? entrantCount : null)

  const gameRef = Array.isArray(tournament.games) ? tournament.games[0] : tournament.games
  const defaults = DEFAULT_POINTS_CONFIG[gameRef?.slug ?? ''] ?? { placement: [], perKill: 1 }

  return (
    <section className="max-w-2xl">
      <Link
        href={`/admin/tournaments/${params.id}/edit`}
        className="text-sm text-violet-400 hover:text-violet-300"
      >
        ← {tournament.title}
      </Link>
      <h2 className="mb-4 mt-2 text-base font-bold text-white">Stages</h2>
      {tournament.competition_format !== 'points_race' ? (
        <p className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-sm text-amber-300">
          This is a head-to-head tournament. Stages apply only to points-race tournaments — use the
          bracket page instead.
        </p>
      ) : (
        <StagesEditor
          tournamentId={params.id}
          stages={stages}
          issues={issues}
          defaultPoints={defaults}
        />
      )}
    </section>
  )
}
