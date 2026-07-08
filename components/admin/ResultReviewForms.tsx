'use client'
import { useFormState } from 'react-dom'
import { confirmResult, disputeResult, type VerifyState } from '@/lib/matches/verify-actions'

export function ResultReviewForms({
  matchId,
  playerAName,
  playerBName,
  prefill,
}: {
  matchId: string
  playerAName: string
  playerBName: string
  prefill: { scoreA: number; scoreB: number } | null
}) {
  const [confirmState, confirmAction] = useFormState<VerifyState, FormData>(confirmResult, undefined)
  const [disputeState, disputeAction] = useFormState<VerifyState, FormData>(disputeResult, undefined)

  if (confirmState?.success)
    return (
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 text-center text-sm font-semibold text-emerald-400">
        ✓ Result confirmed.
      </div>
    )
  if (disputeState?.success)
    return (
      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-center text-sm font-semibold text-amber-300">
        Marked disputed — resolve it from the queue when ready.
      </div>
    )

  return (
    <div className="space-y-4">
      <form action={confirmAction} className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <input type="hidden" name="id" value={matchId} />
        <h3 className="text-sm font-bold text-white">Confirm official result</h3>
        <div className="flex items-end gap-3">
          <ScoreField label={playerAName} name="scoreA" defaultValue={prefill?.scoreA} />
          <span className="pb-2 text-slate-500">–</span>
          <ScoreField label={playerBName} name="scoreB" defaultValue={prefill?.scoreB} />
        </div>
        {confirmState?.error && <p className="text-sm text-red-400">{confirmState.error}</p>}
        <button
          type="submit"
          className="w-full rounded-xl bg-violet-600 px-7 py-3 text-sm font-bold text-white hover:bg-violet-500"
        >
          Confirm result
        </button>
      </form>

      <form action={disputeAction} className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <input type="hidden" name="id" value={matchId} />
        <h3 className="text-sm font-bold text-white">Dispute</h3>
        <textarea
          name="note"
          rows={2}
          required
          placeholder="Reason (required) — what needs investigating?"
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-amber-500 focus:outline-none"
        />
        {disputeState?.error && <p className="text-sm text-red-400">{disputeState.error}</p>}
        <button
          type="submit"
          className="rounded-lg border border-amber-500/40 px-4 py-2 text-xs font-bold text-amber-400 hover:bg-amber-500/10"
        >
          Mark disputed
        </button>
      </form>
    </div>
  )
}

function ScoreField({
  label,
  name,
  defaultValue,
}: {
  label: string
  name: string
  defaultValue?: number
}) {
  return (
    <div className="flex-1 space-y-1.5">
      <label htmlFor={name} className="block truncate text-xs font-medium text-slate-400">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type="number"
        min={0}
        max={99}
        required
        defaultValue={defaultValue}
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-center text-lg font-bold text-white focus:border-violet-500 focus:outline-none"
      />
    </div>
  )
}
