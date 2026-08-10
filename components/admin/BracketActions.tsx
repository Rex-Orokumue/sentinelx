'use client'
import { useFormState, useFormStatus } from 'react-dom'
import {
  closeRegistration,
  generateBracket,
  publishBracket,
  reopenRegistration,
  type BracketState,
} from '@/lib/tournaments/bracket-admin-actions'
import { groupCountFor, validGroupCounts } from '@/lib/tournaments/draw'
import { todayDateLocal } from '@/lib/format'

function SubmitButton({
  pendingLabel,
  className,
  children,
}: {
  pendingLabel: string
  className: string
  children: React.ReactNode
}) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending} className={`${className} disabled:cursor-wait disabled:opacity-60`}>
      {pending ? pendingLabel : children}
    </button>
  )
}

export function BracketActions({
  tournamentId,
  status,
  paidCount,
  roundStartDate,
  roundGapDays,
}: {
  tournamentId: string
  status: string
  paidCount: number
  roundStartDate: string | null
  roundGapDays: number
}) {
  const [closeState, closeAction] = useFormState<BracketState, FormData>(
    closeRegistration,
    undefined,
  )
  const [rollState, rollAction] = useFormState<BracketState, FormData>(generateBracket, undefined)
  const [pubState, pubAction] = useFormState<BracketState, FormData>(publishBracket, undefined)
  const [reopenState, reopenAction] = useFormState<BracketState, FormData>(reopenRegistration, undefined)
  const err = closeState?.error || rollState?.error || pubState?.error || reopenState?.error
  const success =
    (closeState?.success && 'Registration closed and bracket generated.') ||
    (rollState?.success && 'Draw re-rolled — new fixtures are ready below.') ||
    (pubState?.success && 'Bracket published — it is now public.') ||
    (reopenState?.success && 'Registration reopened — bracket cleared.') ||
    null

  const groupOptions = validGroupCounts(paidCount)
  const defaultGroups = groupCountFor(paidCount)
  const groupPicker = groupOptions.length > 1 && (
    <label className="flex items-center gap-2 text-sm text-slate-300">
      Groups
      <select
        name="groups"
        defaultValue={defaultGroups}
        className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-white"
      >
        {groupOptions.map((g) => (
          <option key={g} value={g}>
            {g}
          </option>
        ))}
      </select>
    </label>
  )

  const roundSchedulingFields = (
    <>
      <label className="flex items-center gap-2 text-sm text-slate-300">
        Round start date
        <input
          type="date"
          name="roundStartDate"
          defaultValue={roundStartDate ?? todayDateLocal()}
          className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-white"
        />
      </label>
      <label className="flex items-center gap-2 text-sm text-slate-300">
        Days between rounds
        <input
          type="number"
          name="roundGapDays"
          min={1}
          defaultValue={roundGapDays}
          className="w-16 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-white"
        />
      </label>
    </>
  )

  return (
    <div className="mb-6 rounded-2xl border border-slate-800 bg-slate-900 p-4">
      {status === 'registration_open' && (
        <form action={closeAction} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="id" value={tournamentId} />
          {groupPicker}
          {roundSchedulingFields}
          <SubmitButton
            pendingLabel="Generating…"
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-bold text-white hover:bg-violet-500"
          >
            Close registration & generate bracket
          </SubmitButton>
        </form>
      )}
      {status === 'registration_closed' && (
        <div className="flex flex-wrap items-center gap-2">
          <form
            action={rollAction}
            className="flex flex-wrap items-center gap-3"
            onSubmit={(e) => {
              if (!window.confirm('Re-roll the draw? This discards the current groupings and generates a new random draw.')) {
                e.preventDefault()
              }
            }}
          >
            <input type="hidden" name="id" value={tournamentId} />
            {groupPicker}
            {roundSchedulingFields}
            <SubmitButton
              pendingLabel="Rolling…"
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-bold text-slate-200 hover:border-slate-500"
            >
              Re-roll draw
            </SubmitButton>
          </form>
          <form action={pubAction}>
            <input type="hidden" name="id" value={tournamentId} />
            <SubmitButton
              pendingLabel="Publishing…"
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500"
            >
              Publish bracket
            </SubmitButton>
          </form>
          <form
            action={reopenAction}
            onSubmit={(e) => {
              if (!window.confirm('Reopen registration? This clears the current bracket and lets you add or remove players.')) {
                e.preventDefault()
              }
            }}
          >
            <input type="hidden" name="id" value={tournamentId} />
            <SubmitButton
              pendingLabel="Reopening…"
              className="rounded-lg border border-amber-700 px-4 py-2 text-sm font-bold text-amber-400 hover:border-amber-500"
            >
              Reopen registration
            </SubmitButton>
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
      {!err && success && <p className="mt-2 text-sm text-emerald-400">{success}</p>}
    </div>
  )
}
