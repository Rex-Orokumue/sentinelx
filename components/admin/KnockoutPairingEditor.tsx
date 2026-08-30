'use client'
import { useMemo, useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import {
  createKnockoutRound,
  swapKnockoutPairing,
  type KnockoutPairingState,
} from '@/lib/tournaments/knockout-pairing-actions'

interface Participant {
  id: string
  name: string
  source: string
}
interface Assignment {
  byePlayerIds: string[]
  matchPairs: [string, string][]
}

// Flat slot list: byeCount single slots, then matchCount*2 slots (home/away).
function flatten(a: Assignment): string[] {
  return [...a.byePlayerIds, ...a.matchPairs.flat()]
}
function unflatten(flat: string[], byeCount: number): Assignment {
  const byePlayerIds = flat.slice(0, byeCount)
  const rest = flat.slice(byeCount)
  const matchPairs: [string, string][] = []
  for (let i = 0; i + 1 < rest.length; i += 2) matchPairs.push([rest[i], rest[i + 1]])
  return { byePlayerIds, matchPairs }
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-xl bg-violet-600 px-6 py-3 text-sm font-bold text-white hover:bg-violet-500 disabled:opacity-60"
    >
      {pending ? 'Saving…' : label}
    </button>
  )
}

export function KnockoutPairingEditor({
  mode,
  tournamentId,
  round,
  label,
  participants,
  shape,
  defaultAssignment,
}: {
  mode: 'create' | 'rearrange'
  tournamentId: string
  round: string
  label: string
  participants: Participant[]
  shape: { byeCount: number; matchCount: number }
  defaultAssignment: Assignment
}) {
  const action = mode === 'create' ? createKnockoutRound : swapKnockoutPairing
  const [state, formAction] = useFormState<KnockoutPairingState, FormData>(action, undefined)
  const [flat, setFlat] = useState<string[]>(() => flatten(defaultAssignment))

  const nameById = useMemo(() => new Map(participants.map((p) => [p.id, p.name])), [participants])
  const slotCount = shape.byeCount + shape.matchCount * 2
  const dupes = flat.filter((id, i) => id && flat.indexOf(id) !== i)
  const missing = participants.filter((p) => !flat.includes(p.id))
  const valid =
    flat.length === slotCount && flat.every(Boolean) && dupes.length === 0 && missing.length === 0

  const setSlot = (i: number, id: string) =>
    setFlat((cur) => {
      const next = [...cur]
      next[i] = id
      return next
    })

  const slotLabel = (i: number) =>
    i < shape.byeCount
      ? `Bye ${i + 1}`
      : `Match ${Math.floor((i - shape.byeCount) / 2) + 1} · ${
          (i - shape.byeCount) % 2 === 0 ? 'Home' : 'Away'
        }`

  const assignment = unflatten(flat, shape.byeCount)

  return (
    <div className="rounded-2xl border border-violet-500/30 bg-violet-500/5 p-4">
      <p className="text-sm font-bold text-white">
        {mode === 'create' ? `Arrange the ${label}` : `Rearrange the ${label}`}
      </p>
      <p className="mt-0.5 text-xs text-slate-400">
        {mode === 'create'
          ? 'Set who plays whom, then create the round. Players are notified once you create it.'
          : 'Change the pairings for this unplayed round. Affected players are re-notified.'}
      </p>

      <form action={formAction} className="mt-3 space-y-2">
        <input type="hidden" name="tournamentId" value={tournamentId} />
        <input type="hidden" name="round" value={round} />
        <input type="hidden" name="assignment" value={JSON.stringify(assignment)} />

        {Array.from({ length: slotCount }, (_, i) => (
          <label key={i} className="flex items-center gap-2 text-sm">
            <span className="w-28 shrink-0 text-xs text-slate-500">{slotLabel(i)}</span>
            <select
              value={flat[i] ?? ''}
              onChange={(e) => setSlot(i, e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
            >
              <option value="">—</option>
              {participants.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.source})
                </option>
              ))}
            </select>
          </label>
        ))}

        {!valid && (
          <p className="text-xs text-amber-400">
            {dupes.length > 0
              ? `${nameById.get(dupes[0]) ?? 'A player'} is in more than one slot.`
              : missing.length > 0
                ? `Not placed yet: ${missing.map((m) => m.name).join(', ')}.`
                : 'Fill every slot.'}
          </p>
        )}
        {state?.error && <p className="text-xs text-red-400">{state.error}</p>}
        {state?.success && (
          <p className="text-xs text-emerald-400">
            {mode === 'create' ? 'Round created and players notified.' : 'Pairings updated.'}
          </p>
        )}

        <fieldset disabled={!valid} className="disabled:opacity-60">
          <SubmitButton label={mode === 'create' ? `Create ${label}` : `Save ${label} pairings`} />
        </fieldset>
      </form>
    </div>
  )
}
