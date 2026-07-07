'use client'
import { useFormState } from 'react-dom'
import {
  closeRegistration,
  generateBracket,
  publishBracket,
  type BracketState,
} from '@/lib/tournaments/bracket-admin-actions'

export function BracketActions({ tournamentId, status }: { tournamentId: string; status: string }) {
  const [closeState, closeAction] = useFormState<BracketState, FormData>(
    closeRegistration,
    undefined,
  )
  const [rollState, rollAction] = useFormState<BracketState, FormData>(generateBracket, undefined)
  const [pubState, pubAction] = useFormState<BracketState, FormData>(publishBracket, undefined)
  const err = closeState?.error || rollState?.error || pubState?.error

  return (
    <div className="mb-6 rounded-2xl border border-slate-800 bg-slate-900 p-4">
      {status === 'registration_open' && (
        <form action={closeAction}>
          <input type="hidden" name="id" value={tournamentId} />
          <button
            type="submit"
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-bold text-white hover:bg-violet-500"
          >
            Close registration & generate bracket
          </button>
        </form>
      )}
      {status === 'registration_closed' && (
        <div className="flex flex-wrap items-center gap-2">
          <form action={rollAction}>
            <input type="hidden" name="id" value={tournamentId} />
            <button
              type="submit"
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-bold text-slate-200 hover:border-slate-500"
            >
              Re-roll draw
            </button>
          </form>
          <form action={pubAction}>
            <input type="hidden" name="id" value={tournamentId} />
            <button
              type="submit"
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500"
            >
              Publish bracket
            </button>
          </form>
          <p className="w-full text-xs text-slate-500">
            Preview below is staff-only until you publish.
          </p>
        </div>
      )}
      {(status === 'active' || status === 'completed') && (
        <p className="text-sm font-semibold text-slate-400">Bracket is live — locked.</p>
      )}
      {err && <p className="mt-2 text-sm text-red-400">{err}</p>}
    </div>
  )
}
