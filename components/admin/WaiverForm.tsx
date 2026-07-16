'use client'
import { useFormState } from 'react-dom'
import { grantWaiver, type WaiverFormState } from '@/lib/tournaments/waiver-admin-actions'

export function WaiverForm({ tournamentId }: { tournamentId: string }) {
  const [state, action] = useFormState<WaiverFormState, FormData>(grantWaiver, undefined)

  return (
    <form action={action} className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <input type="hidden" name="tournamentId" value={tournamentId} />
      <h3 className="text-sm font-bold text-white">Grant free entry</h3>
      <div className="space-y-1.5">
        <label htmlFor="username" className="text-xs font-medium text-slate-400">Username</label>
        <input
          id="username"
          name="username"
          type="text"
          placeholder="e.g. DarkStrikerNG"
          required
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="reason" className="text-xs font-medium text-slate-400">Reason (optional)</label>
        <input
          id="reason"
          name="reason"
          type="text"
          placeholder="e.g. Season 1 champion award"
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
        />
      </div>
      <div className="flex items-center gap-2">
        <button
          type="submit"
          className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-500"
        >
          Grant waiver
        </button>
        {state?.success && !state.warning && <span className="text-xs text-emerald-400">Waiver granted.</span>}
        {state?.error && <span className="text-xs text-red-400">{state.error}</span>}
      </div>
      {state?.warning && <p className="text-xs text-amber-400">{state.warning}</p>}
    </form>
  )
}
