import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { LobbyResultForm } from '@/components/lobby/LobbyResultForm'

export const metadata: Metadata = { title: 'Your lobby · SentinelX' }

function formatWhen(iso: string | null): string {
  if (!iso) return 'Time to be announced'
  return new Date(iso).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })
}

export default async function LobbyPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect(`/login?next=/lobbies/${params.id}`)

  // Service-role read: room credentials are not readable by a player's own
  // client under RLS, and they must not be. Membership is checked below before
  // anything is rendered.
  const admin = createAdminClient()

  const { data: seatRaw } = await admin
    .from('lobby_entrants')
    .select('entrant_id, tournament_entrants!inner(player_id, display_name, tournament_id)')
    .eq('lobby_id', params.id)
    .eq('tournament_entrants.player_id', user.id)
    .maybeSingle()

  // Not an entrant of this lobby → it does not exist as far as they are
  // concerned. This is what keeps room codes out of the wrong hands: the check
  // is membership, never a query param.
  if (!seatRaw) notFound()

  const seat = seatRaw as unknown as {
    entrant_id: string
    tournament_entrants:
      | { display_name: string; tournament_id: string }
      | { display_name: string; tournament_id: string }[]
  }
  const entrant = Array.isArray(seat.tournament_entrants)
    ? seat.tournament_entrants[0]
    : seat.tournament_entrants

  const { data: lobbyRaw } = await admin
    .from('tournament_lobbies')
    .select(
      'id, round_no, label, status, room_id, room_password, scheduled_at, youtube_stream_url, ' +
        'tournament_stages(name, tournaments(title, slug))',
    )
    .eq('id', params.id)
    .maybeSingle()
  if (!lobbyRaw) notFound()

  const lobby = lobbyRaw as unknown as {
    round_no: number
    label: string
    status: string
    room_id: string | null
    room_password: string | null
    scheduled_at: string | null
    youtube_stream_url: string | null
    tournament_stages:
      | { name: string; tournaments: { title: string; slug: string } | { title: string; slug: string }[] | null }
      | { name: string; tournaments: { title: string; slug: string } | { title: string; slug: string }[] | null }[]
      | null
  }
  const stage = Array.isArray(lobby.tournament_stages) ? lobby.tournament_stages[0] : lobby.tournament_stages
  const tRef = Array.isArray(stage?.tournaments) ? stage?.tournaments[0] : stage?.tournaments

  const [{ count: entrantCount }, { data: mine }] = await Promise.all([
    admin.from('lobby_entrants').select('id', { count: 'exact', head: true }).eq('lobby_id', params.id),
    admin
      .from('lobby_results')
      .select('placement, kills, screenshot_url, total_points, status')
      .eq('lobby_id', params.id)
      .eq('entrant_id', seat.entrant_id)
      .maybeSingle(),
  ])

  const confirmed = lobby.status === 'confirmed'

  return (
    <div className="mx-auto max-w-lg px-4 pb-20 pt-6">
      {tRef && (
        <Link href={`/tournaments/${tRef.slug}`} className="text-sm text-violet-400 hover:text-violet-300">
          ← {tRef.title}
        </Link>
      )}
      <h1 className="mb-1 mt-2 font-display text-2xl font-black text-white">
        {stage?.name} · Round {lobby.round_no}
      </h1>
      <p className="mb-5 text-sm text-slate-400">
        Lobby {lobby.label} · {entrantCount ?? 0} entrants · playing as{' '}
        <span className="font-semibold text-white">{entrant?.display_name}</span>
      </p>

      <div className="mb-5 space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <Row label="Starts" value={formatWhen(lobby.scheduled_at)} />
        <Row label="Room ID" value={lobby.room_id ?? 'Not published yet'} mono />
        <Row label="Password" value={lobby.room_password ?? 'Not published yet'} mono />
        {lobby.youtube_stream_url && (
          <a
            href={lobby.youtube_stream_url}
            target="_blank"
            rel="noreferrer"
            className="block text-sm font-semibold text-violet-400 hover:text-violet-300"
          >
            Watch the stream →
          </a>
        )}
      </div>

      <LobbyResultForm
        lobbyId={params.id}
        entrantCount={entrantCount ?? 0}
        confirmed={confirmed}
        initial={
          mine
            ? {
                placement: mine.placement,
                kills: mine.kills,
                hasScreenshot: !!mine.screenshot_url,
                totalPoints: mine.total_points,
                status: mine.status,
              }
            : null
        }
      />
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-xs uppercase tracking-widest text-slate-500">{label}</span>
      <span className={`text-sm font-semibold text-white ${mono ? 'font-mono tracking-wider' : ''}`}>
        {value}
      </span>
    </div>
  )
}
