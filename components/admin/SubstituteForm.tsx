'use client'
import { useFormState } from 'react-dom'
import { addSubstitute, type DisqualifyState } from '@/lib/tournaments/registrations-admin-actions'

export function SubstituteForm({
  tournamentId,
  disqualifiedRegistrationId,
  waitlistUsernames = [],
}: {
  tournamentId: string
  disqualifiedRegistrationId: string
  waitlistUsernames?: string[]
}) {
  const [state, action] = useFormState<DisqualifyState, FormData>(addSubstitute, undefined)
  const datalistId = `waitlist-${disqualifiedRegistrationId}`

  if (state?.success) return <span className="text-xs font-bold text-emerald-400">Substitute added</span>

  return (
    <form action={action} className="flex items-center gap-1.5">
      <input type="hidden" name="tournamentId" value={tournamentId} />
      <input type="hidden" name="disqualifiedRegistrationId" value={disqualifiedRegistrationId} />
      <input
        name="username"
        type="text"
        list={waitlistUsernames.length > 0 ? datalistId : undefined}
        placeholder="Substitute's username"
        required
        className="w-36 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
      />
      {waitlistUsernames.length > 0 && (
        <datalist id={datalistId}>
          {waitlistUsernames.map((u) => (
            <option key={u} value={u} />
          ))}
        </datalist>
      )}
      <button
        type="submit"
        className="rounded-lg bg-violet-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-violet-500"
      >
        Add substitute
      </button>
      {state?.error && <p className="text-xs text-red-400">{state.error}</p>}
    </form>
  )
}
