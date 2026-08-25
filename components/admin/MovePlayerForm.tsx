'use client'
import { useFormState, useFormStatus } from 'react-dom'
import { movePlayerToGroup, type MoveGroupState } from '@/lib/tournaments/group-admin-actions'

function MoveButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded border border-slate-700 px-2 py-1 text-[11px] font-bold text-slate-300 hover:border-slate-500 disabled:cursor-wait disabled:opacity-60"
    >
      {pending ? '…' : 'Move'}
    </button>
  )
}

// Admin-only, staff-preview window control (see AdminBracketView) for
// manually reassigning a player to a different group. Renders nothing when
// there's no other group to move into.
export function MovePlayerForm({
  tournamentId,
  playerId,
  currentGroupId,
  groups,
}: {
  tournamentId: string
  playerId: string
  currentGroupId: string
  groups: { id: string; name: string }[]
}) {
  const [state, action] = useFormState<MoveGroupState, FormData>(movePlayerToGroup, undefined)
  const otherGroups = groups.filter((g) => g.id !== currentGroupId)
  if (otherGroups.length === 0) return null

  return (
    <form action={action} className="flex items-center justify-end gap-1">
      <input type="hidden" name="tournamentId" value={tournamentId} />
      <input type="hidden" name="playerId" value={playerId} />
      <select
        name="toGroupId"
        defaultValue=""
        required
        className="rounded border border-slate-700 bg-slate-800 px-1 py-1 text-[11px] text-white"
      >
        <option value="" disabled>
          Move to…
        </option>
        {otherGroups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>
      <MoveButton />
      {state?.error && <span className="text-[11px] text-red-400">{state.error}</span>}
    </form>
  )
}
