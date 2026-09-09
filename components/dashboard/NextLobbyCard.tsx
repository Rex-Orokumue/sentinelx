import Link from 'next/link'

export interface NextLobbyData {
  lobbyId: string
  tournamentTitle: string
  stageName: string
  roundNo: number
  label: string
  scheduledAt: string | null
  hasRoomCode: boolean
  submitted: boolean
}

// The entry point that makes /lobbies/[id] reachable at all. Without it the
// whole points-race submission flow exists but no player can find it.
export function NextLobbyCard({ lobby }: { lobby: NextLobbyData | null }) {
  if (!lobby) return null

  const when = lobby.scheduledAt
    ? new Date(lobby.scheduledAt).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })
    : 'Time to be announced'

  return (
    <Link
      href={`/lobbies/${lobby.lobbyId}`}
      className="mb-6 block rounded-2xl border border-violet-500/40 bg-violet-500/10 p-5 transition-colors hover:border-violet-500/70"
    >
      <p className="text-[11px] font-bold uppercase tracking-widest text-violet-300">Your lobby</p>
      <p className="mt-1 font-display text-xl font-black text-white">
        {lobby.stageName} · Round {lobby.roundNo}
      </p>
      <p className="mt-0.5 text-sm text-slate-300">
        {lobby.tournamentTitle} · Lobby {lobby.label}
      </p>
      <p className="mt-2 text-xs text-slate-400">{when}</p>
      <p className="mt-3 text-xs font-semibold text-violet-300">
        {lobby.submitted
          ? 'Result submitted — tap to edit'
          : lobby.hasRoomCode
            ? 'Room code ready — tap to open'
            : 'Tap to open'}
      </p>
    </Link>
  )
}
