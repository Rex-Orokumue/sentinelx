'use client'
import { useFormState } from 'react-dom'
import { removeRegistration, type DisqualifyState } from '@/lib/tournaments/registrations-admin-actions'
import { SubmitButton } from '@/components/ui/submit-button'

export function RemoveButton({
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
  const [state, action] = useFormState<DisqualifyState, FormData>(removeRegistration, undefined)

  if (state?.success) return <span className="text-xs font-bold text-amber-400">Removed</span>

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm('Remove this player? No score penalty will be applied.')) {
          e.preventDefault()
        }
      }}
    >
      <input type="hidden" name="registrationId" value={registrationId} />
      <input type="hidden" name="tournamentId" value={tournamentId} />
      <input type="hidden" name="playerId" value={playerId} />
      <input type="hidden" name="tournamentTitle" value={tournamentTitle} />
      <SubmitButton
        pendingLabel="Removing…"
        className="rounded-lg border border-amber-500/40 px-2.5 py-1 text-xs font-bold text-amber-400 hover:bg-amber-500/10"
      >
        Remove
      </SubmitButton>
      {state?.error && <p className="mt-1 text-xs text-red-400">{state.error}</p>}
    </form>
  )
}
