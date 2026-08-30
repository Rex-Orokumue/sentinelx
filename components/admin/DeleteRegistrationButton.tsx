'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { deleteRegistration, type DisqualifyState } from '@/lib/tournaments/registrations-admin-actions'

// Admin-only. Only rendered for a `removed` / `disqualified` row — a permanent
// delete of the list row, nothing else (the player's matches, standings and
// conduct penalties are keyed on player_id and stay put).
export function DeleteRegistrationButton({
  registrationId,
  tournamentId,
}: {
  registrationId: string
  tournamentId: string
}) {
  const [state, action] = useFormState<DisqualifyState, FormData>(deleteRegistration, undefined)
  const [confirming, setConfirming] = useState(false)

  // On success the row is gone — revalidatePath re-renders the table without it.
  if (state?.success) return null

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="w-fit rounded-lg border border-slate-700 px-2 py-0.5 text-[11px] font-bold text-slate-400 hover:border-red-500/50 hover:text-red-400"
      >
        Delete row
      </button>
    )
  }

  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="registrationId" value={registrationId} />
      <input type="hidden" name="tournamentId" value={tournamentId} />
      <p className="text-[11px] text-slate-400">Delete this row for good? Any disqualification note goes with it.</p>
      <div className="flex gap-1.5">
        <button
          type="submit"
          className="rounded-lg bg-red-600 px-2 py-0.5 text-[11px] font-bold text-white hover:bg-red-500"
        >
          Delete
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded-lg border border-slate-700 px-2 py-0.5 text-[11px] font-bold text-slate-300 hover:border-slate-500"
        >
          Cancel
        </button>
      </div>
      {state?.error && <p className="text-[11px] text-red-400">{state.error}</p>}
    </form>
  )
}
