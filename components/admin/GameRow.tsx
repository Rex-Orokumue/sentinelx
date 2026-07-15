'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { toggleGameActive, type GameFormState } from '@/lib/games/admin-actions'

export function GameRow({
  game,
  activeTournamentCount,
}: {
  game: { id: string; name: string; category: string; active: boolean }
  activeTournamentCount: number
}) {
  const [state, action] = useFormState<GameFormState, FormData>(toggleGameActive, undefined)
  const [confirming, setConfirming] = useState(false)
  const nextActive = !game.active

  // Reset after a successful submit — must not happen via the submit button's
  // own onClick, which unmounts the <form> mid-submission ("Form submission
  // canceled because the form is not connected") and silently drops the request.
  if (state?.success && confirming) setConfirming(false)

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-bold text-white">{game.name}</p>
          <p className="text-xs text-slate-500">
            {game.category} · {game.active ? 'Active' : 'Inactive'}
            {activeTournamentCount > 0 && ` · ${activeTournamentCount} active tournament${activeTournamentCount === 1 ? '' : 's'}`}
          </p>
        </div>

        {!confirming ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="shrink-0 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-200 hover:border-slate-500"
          >
            {game.active ? 'Deactivate' : 'Activate'}
          </button>
        ) : (
          <form action={action} className="flex shrink-0 items-center gap-2">
            <input type="hidden" name="id" value={game.id} />
            <input type="hidden" name="nextActive" value={String(nextActive)} />
            <button
              type="submit"
              className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-500"
            >
              {game.active
                ? activeTournamentCount > 0
                  ? `Confirm — ${activeTournamentCount} active tournament${activeTournamentCount === 1 ? '' : 's'} will be unaffected`
                  : 'Confirm deactivate'
                : 'Confirm activate'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-300 hover:border-slate-500"
            >
              Cancel
            </button>
          </form>
        )}
      </div>
      {state?.error && <p className="mt-2 text-xs text-red-400">{state.error}</p>}
    </div>
  )
}
