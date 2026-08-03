'use client'
import { useFormState, useFormStatus } from 'react-dom'
import { creditThirdPlace, type CreditThirdPlaceState } from '@/lib/matches/verify-actions'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-500 disabled:cursor-wait disabled:opacity-60"
    >
      {pending ? 'Crediting…' : 'Credit third place'}
    </button>
  )
}

export function ThirdPlaceCreditForm({
  tournamentId,
  players,
}: {
  tournamentId: string
  players: { id: string; name: string }[]
}) {
  const [state, action] = useFormState<CreditThirdPlaceState, FormData>(creditThirdPlace, undefined)

  if (players.length === 0) return null

  return (
    <form
      action={action}
      className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4"
    >
      <input type="hidden" name="tournamentId" value={tournamentId} />
      <label className="flex items-center gap-2 text-sm text-slate-300">
        Player
        <select
          name="playerId"
          defaultValue=""
          required
          className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-white"
        >
          <option value="" disabled>
            Select a player
          </option>
          {players.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <SubmitButton />
      {state?.error && <p className="w-full text-xs text-red-400">{state.error}</p>}
      {state?.success && <p className="w-full text-xs text-emerald-400">Credited.</p>}
    </form>
  )
}
