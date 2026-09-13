'use client'
import { useFormState } from 'react-dom'
import { moveSquadMember, removeSquadMember, type SquadMoveState } from '@/lib/tournaments/squad-actions'

type SquadRow = {
  id: string
  name: string
  status: string
  members: { playerId: string; role: string; name: string }[]
}

export function SquadAssemblyReview({
  tournamentId,
  tournamentTitle,
  teamSize,
  squads,
  unassigned,
}: {
  tournamentId: string
  tournamentTitle: string
  teamSize: number
  squads: SquadRow[]
  unassigned: { playerId: string; name: string }[]
}) {
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <h1 className="text-xl font-bold text-white">{tournamentTitle} — Squad Review</h1>
      <p className="text-sm text-slate-400">
        Every squad must be exactly {teamSize} players before this tournament can go live. To move a
        player into a full squad, remove someone from it first.
      </p>

      {unassigned.length > 0 && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
          <h2 className="mb-2 text-sm font-bold text-amber-400">Unassigned ({unassigned.length})</h2>
          <div className="space-y-2">
            {unassigned.map((p) => (
              <UnassignedRow key={p.playerId} tournamentId={tournamentId} playerId={p.playerId} name={p.name} squads={squads} />
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {squads.map((squad) => (
          <SquadCard key={squad.id} tournamentId={tournamentId} squad={squad} teamSize={teamSize} />
        ))}
      </div>
    </div>
  )
}

function SquadCard({ tournamentId, squad, teamSize }: { tournamentId: string; squad: SquadRow; teamSize: number }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-bold text-white">{squad.name}</h3>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-bold ${
            squad.status === 'complete' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'
          }`}
        >
          {squad.members.length}/{teamSize}
        </span>
      </div>
      <div className="space-y-1.5">
        {squad.members.map((m) => (
          <RemoveRow key={m.playerId} tournamentId={tournamentId} playerId={m.playerId} name={m.name} role={m.role} />
        ))}
      </div>
    </div>
  )
}

function RemoveRow({ tournamentId, playerId, name, role }: { tournamentId: string; playerId: string; name: string; role: string }) {
  const [state, formAction] = useFormState<SquadMoveState, FormData>(removeSquadMember, undefined)
  return (
    <form action={formAction} className="flex items-center justify-between text-sm">
      <input type="hidden" name="tournamentId" value={tournamentId} />
      <input type="hidden" name="playerId" value={playerId} />
      <span className="text-slate-300">
        {name} {role === 'captain' && <span className="text-violet-400">(C)</span>}
      </span>
      <button type="submit" className="text-xs font-semibold text-red-400 hover:text-red-300">
        Remove
      </button>
      {state?.error && <p className="text-xs text-red-400">{state.error}</p>}
    </form>
  )
}

function UnassignedRow({
  tournamentId,
  playerId,
  name,
  squads,
}: {
  tournamentId: string
  playerId: string
  name: string
  squads: SquadRow[]
}) {
  const [state, formAction] = useFormState<SquadMoveState, FormData>(moveSquadMember, undefined)
  return (
    <form action={formAction} className="flex items-center gap-2 text-sm">
      <input type="hidden" name="tournamentId" value={tournamentId} />
      <input type="hidden" name="playerId" value={playerId} />
      <span className="flex-1 text-slate-300">{name}</span>
      <select name="toSquadId" className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white" required>
        <option value="">Move to squad…</option>
        {squads.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} ({s.members.length})
          </option>
        ))}
      </select>
      <button type="submit" className="text-xs font-semibold text-violet-400 hover:text-violet-300">
        Move
      </button>
      {state?.error && <p className="text-xs text-red-400">{state.error}</p>}
    </form>
  )
}
