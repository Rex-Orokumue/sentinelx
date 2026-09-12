import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { LobbyResultGrid } from '@/components/admin/LobbyResultGrid'
import { buildLobbyGrid, type GridEntrant, type GridSubmission } from '@/lib/tournaments/lobby-grid'
import { validateLobbyResults } from '@/lib/tournaments/lobby-validation'

export const metadata: Metadata = { title: 'Lobby results · Admin · SentinelX' }

export default async function LobbyResultsPage({
  params,
}: {
  params: { id: string; lobbyId: string }
}) {
  await requireStaff()
  const supabase = createClient()

  const { data: lobbyRaw } = await supabase
    .from('tournament_lobbies')
    .select('id, round_no, label, status, stage_id, tournament_stages(name, tournament_id)')
    .eq('id', params.lobbyId)
    .maybeSingle()
  if (!lobbyRaw) notFound()

  const lobby = lobbyRaw as unknown as {
    id: string
    round_no: number
    label: string
    status: string
    tournament_stages: { name: string; tournament_id: string } | { name: string; tournament_id: string }[] | null
  }
  const stage = Array.isArray(lobby.tournament_stages) ? lobby.tournament_stages[0] : lobby.tournament_stages
  // A lobby id from another tournament must not render under this one's URL.
  if (!stage || stage.tournament_id !== params.id) notFound()

  const [{ data: seatRows }, { data: resultRows }] = await Promise.all([
    supabase
      .from('lobby_entrants')
      .select('entrant_id, tournament_entrants(display_name)')
      .eq('lobby_id', params.lobbyId),
    supabase
      .from('lobby_results')
      .select('entrant_id, placement, kills, screenshot_url, status')
      .eq('lobby_id', params.lobbyId),
  ])

  const entrants: GridEntrant[] = ((seatRows ?? []) as unknown[]).map((raw) => {
    const r = raw as {
      entrant_id: string
      tournament_entrants: { display_name: string } | { display_name: string }[] | null
    }
    const ref = Array.isArray(r.tournament_entrants) ? r.tournament_entrants[0] : r.tournament_entrants
    return { entrantId: r.entrant_id, displayName: ref?.display_name ?? 'Entrant' }
  })

  const submissions: GridSubmission[] = ((resultRows ?? []) as unknown[]).map((raw) => {
    const r = raw as {
      entrant_id: string
      placement: number
      kills: number
      screenshot_url: string | null
      status: string
    }
    return {
      entrantId: r.entrant_id,
      placement: r.placement,
      kills: r.kills,
      screenshotUrl: r.screenshot_url,
      status: r.status,
    }
  })

  const rows = buildLobbyGrid(entrants, submissions)
  const flags = validateLobbyResults({
    entrantIds: entrants.map((e) => e.entrantId),
    rows: rows.map((r) => ({ entrantId: r.entrantId, placement: r.placement, kills: r.kills })),
  })

  return (
    <section className="max-w-2xl">
      <Link
        href={`/admin/tournaments/${params.id}/lobbies`}
        className="text-sm text-violet-400 hover:text-violet-300"
      >
        ← Lobbies
      </Link>
      <h2 className="mb-1 mt-2 text-base font-bold text-white">
        {stage.name} · Round {lobby.round_no} · Lobby {lobby.label}
      </h2>
      <p className="mb-4 text-xs text-slate-500">
        {entrants.length} entrant{entrants.length === 1 ? '' : 's'}
      </p>
      <LobbyResultGrid
        lobbyId={params.lobbyId}
        rows={rows}
        flags={flags}
        locked={lobby.status === 'confirmed'}
      />
    </section>
  )
}
