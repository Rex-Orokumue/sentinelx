import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { LobbyList, type StageLobbies, type LobbyView } from '@/components/admin/LobbyList'

export const metadata: Metadata = { title: 'Lobbies · Admin · SentinelX' }

// <input type="datetime-local"> wants 'YYYY-MM-DDTHH:mm' with no offset.
function toLocalInput(iso: string | null): string {
  return iso ? iso.slice(0, 16) : ''
}

export default async function LobbiesPage({ params }: { params: { id: string } }) {
  await requireStaff()
  const supabase = createClient()

  const { data: tournament } = await supabase
    .from('tournaments')
    .select('id, title, competition_format')
    .eq('id', params.id)
    .maybeSingle()
  if (!tournament) notFound()

  const { data: stageRows } = await supabase
    .from('tournament_stages')
    .select('id, seq, name, status, rounds_count')
    .eq('tournament_id', params.id)
    .order('seq')

  const stageIds = (stageRows ?? []).map((s) => s.id)

  // This is an ADMIN page, so room_id / room_password are selected here. They
  // must never be selected on a public page — they would let anyone walk into
  // a paid custom room.
  const { data: lobbyRows } = stageIds.length
    ? await supabase
        .from('tournament_lobbies')
        .select('id, stage_id, round_no, label, status, room_id, room_password, scheduled_at, youtube_stream_url')
        .in('stage_id', stageIds)
        .order('round_no')
        .order('label')
    : { data: [] as unknown[] }

  const lobbyIds = ((lobbyRows ?? []) as { id: string }[]).map((l) => l.id)
  const { data: seatRows } = lobbyIds.length
    ? await supabase.from('lobby_entrants').select('lobby_id').in('lobby_id', lobbyIds)
    : { data: [] as unknown[] }

  const seatsByLobby = new Map<string, number>()
  for (const raw of (seatRows ?? []) as { lobby_id: string }[]) {
    seatsByLobby.set(raw.lobby_id, (seatsByLobby.get(raw.lobby_id) ?? 0) + 1)
  }

  const stages: StageLobbies[] = (stageRows ?? []).map((s) => ({
    id: s.id,
    seq: s.seq,
    name: s.name,
    status: s.status,
    roundsCount: s.rounds_count,
    lobbies: ((lobbyRows ?? []) as Record<string, unknown>[])
      .filter((l) => l.stage_id === s.id)
      .map(
        (l): LobbyView => ({
          id: l.id as string,
          roundNo: l.round_no as number,
          label: l.label as string,
          status: l.status as string,
          entrantCount: seatsByLobby.get(l.id as string) ?? 0,
          roomId: (l.room_id as string | null) ?? '',
          roomPassword: (l.room_password as string | null) ?? '',
          scheduledAt: toLocalInput(l.scheduled_at as string | null),
          youtubeStreamUrl: (l.youtube_stream_url as string | null) ?? '',
        }),
      ),
  }))

  return (
    <section className="max-w-2xl">
      <Link
        href={`/admin/tournaments/${params.id}/edit`}
        className="text-sm text-violet-400 hover:text-violet-300"
      >
        ← {tournament.title}
      </Link>
      <h2 className="mb-4 mt-2 text-base font-bold text-white">Lobbies</h2>
      {tournament.competition_format !== 'points_race' ? (
        <p className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-sm text-amber-300">
          This is a head-to-head tournament. Lobbies apply only to points-race tournaments — use the
          bracket page instead.
        </p>
      ) : (
        <LobbyList stages={stages} />
      )}
    </section>
  )
}
