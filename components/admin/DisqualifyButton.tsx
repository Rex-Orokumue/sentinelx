'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { disqualifyRegistration, type DisqualifyState } from '@/lib/tournaments/registrations-admin-actions'

export function DisqualifyButton({
  registrationId,
  tournamentId,
  playerId,
  tournamentTitle,
}: {
  registrationId: string
  tournamentId: string
  playerId: string
  tournamentTitle: string
}) {
  const [state, action] = useFormState<DisqualifyState, FormData>(disqualifyRegistration, undefined)
  const [confirming, setConfirming] = useState(false)

  if (state?.success) return <span className="text-xs font-bold text-red-400">Disqualified</span>

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-lg border border-red-500/40 px-2.5 py-1 text-xs font-bold text-red-400 hover:bg-red-500/10"
      >
        Disqualify
      </button>
    )
  }
  return (
    <form action={action} className="flex flex-col gap-1.5">
      <input type="hidden" name="registrationId" value={registrationId} />
      <input type="hidden" name="tournamentId" value={tournamentId} />
      <input type="hidden" name="playerId" value={playerId} />
      <input type="hidden" name="tournamentTitle" value={tournamentTitle} />
      <textarea
        name="reason"
        rows={2}
        required
        placeholder="Reason (required) — e.g. repeated no-shows across group stage"
        className="w-48 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white placeholder:text-slate-600 focus:border-red-500 focus:outline-none"
      />
      <div className="flex gap-1.5">
        <button
          type="submit"
          className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-red-500"
        >
          Confirm
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs font-bold text-slate-300 hover:border-slate-500"
        >
          Cancel
        </button>
      </div>
      {state?.error && <p className="text-xs text-red-400">{state.error}</p>}
    </form>
  )
}
