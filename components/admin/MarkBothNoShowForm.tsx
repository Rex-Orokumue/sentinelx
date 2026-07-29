'use client'
import { useFormState } from 'react-dom'
import { markBothNoShow, type NoShowState } from '@/lib/matches/noshow-actions'

export function MarkBothNoShowForm({ matchId }: { matchId: string }) {
  const [state, action] = useFormState<NoShowState, FormData>(markBothNoShow, undefined)

  if (state?.success) {
    return (
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-center text-sm font-semibold text-emerald-400">
        ✓ Marked as a mutual no-show.
      </div>
    )
  }

  return (
    <form action={action} className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <input type="hidden" name="id" value={matchId} />
      <h3 className="text-sm font-bold text-white">Mark both no-show</h3>
      <p className="text-xs text-slate-500">
        Use only when neither player showed up or responded — records a 0-0 draw (group) or a forfeit (knockout),
        and both players receive the no-show Sentinel Score penalty.
      </p>
      <textarea
        name="reason"
        rows={2}
        required
        placeholder="Reason (required) — e.g. neither player responded to WhatsApp contact attempts"
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
      />
      {state?.error && <p className="text-xs text-red-400">{state.error}</p>}
      <button
        type="submit"
        className="rounded-lg border border-red-500/40 px-4 py-2 text-xs font-bold text-red-400 hover:bg-red-500/10"
      >
        Mark both no-show
      </button>
    </form>
  )
}
