'use client'
import { useFormState, useFormStatus } from 'react-dom'
import { checkInToMatch, type CheckInState } from '@/lib/matches/check-in-actions'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-xl bg-emerald-600 px-7 py-3 text-sm font-bold text-white transition-colors hover:bg-emerald-500 disabled:opacity-60"
    >
      {pending ? 'Checking in…' : "I'm here — check me in"}
    </button>
  )
}

export function CheckInPanel({
  matchId,
  alreadyCheckedIn,
  opponentCheckedIn,
  opponentName,
}: {
  matchId: string
  alreadyCheckedIn: boolean
  opponentCheckedIn: boolean
  opponentName: string
}) {
  const [state, action] = useFormState<CheckInState, FormData>(checkInToMatch, undefined)
  const checkedIn = alreadyCheckedIn || state?.success === true

  return (
    <div className="mb-6 rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <h3 className="text-sm font-bold text-white">Match day check-in</h3>
      <p className="mt-1 text-xs text-slate-500">
        Check in so we know you turned up. If your opponent never shows, this is the proof an admin
        uses to award you the win.
      </p>

      <p className="mt-3 text-xs">
        <span className={opponentCheckedIn ? 'text-emerald-400' : 'text-slate-500'}>
          {opponentCheckedIn ? `✓ ${opponentName} has checked in` : `${opponentName} hasn't checked in yet`}
        </span>
      </p>

      {checkedIn ? (
        <p className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-center text-sm font-bold text-emerald-400">
          ✓ You&apos;re checked in
        </p>
      ) : (
        <form action={action} className="mt-3">
          <input type="hidden" name="matchId" value={matchId} />
          {state?.error && <p className="mb-2 text-center text-sm text-red-400">{state.error}</p>}
          <SubmitButton />
        </form>
      )}
    </div>
  )
}
