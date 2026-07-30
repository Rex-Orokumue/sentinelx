'use client'
import { useFormState, useFormStatus } from 'react-dom'
import { recomputeStandings, type RecomputeState } from '@/lib/tournaments/admin-actions'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-bold text-slate-200 transition-colors hover:border-slate-500 disabled:opacity-50"
    >
      {pending ? 'Recomputing…' : 'Recompute standings'}
    </button>
  )
}

// Safe to press at any time: it rewrites the group tables from results the
// admin has already confirmed, and touches no match result or status.
export function RecomputeStandingsButton({ tournamentId }: { tournamentId: string }) {
  const [state, action] = useFormState<RecomputeState, FormData>(recomputeStandings, undefined)

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="tournamentId" value={tournamentId} />
      <SubmitButton />
      {state?.success && (
        <span className="text-xs text-emerald-400">
          Rebuilt {state.groups} group{state.groups === 1 ? '' : 's'} from confirmed results.
        </span>
      )}
      {state?.error && <span className="text-xs text-red-400">{state.error}</span>}
    </form>
  )
}
