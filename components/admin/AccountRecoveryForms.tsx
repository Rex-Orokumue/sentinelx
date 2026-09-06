'use client'
import { useFormState } from 'react-dom'
import {
  releaseUsername,
  clearBannedIdentifier,
  type RecoveryState,
} from '@/lib/admin/recovery-actions'

function Result({ state }: { state: RecoveryState }) {
  if (!state) return null
  return (
    <>
      {state.error && <p className="text-xs text-red-400">{state.error}</p>}
      {state.success && <p className="text-xs text-emerald-400">{state.success}</p>}
    </>
  )
}

export function ReleaseUsernameForm() {
  const [state, formAction] = useFormState<RecoveryState, FormData>(releaseUsername, undefined)
  return (
    <form action={formAction} className="space-y-2 rounded-2xl border border-sx-border bg-sx-surface p-5">
      <h2 className="text-sm font-bold uppercase tracking-wide text-white">Release a username</h2>
      <p className="text-xs leading-relaxed text-sx-gray">
        Makes a retired handle claimable again. Once retired there is no record of who held it, so
        releasing it lets <strong className="text-amber-400">anyone</strong> claim it — not only its
        previous owner.
      </p>
      <input
        type="text"
        name="username"
        placeholder="sniperking"
        className="w-full rounded-lg border border-sx-border bg-sx-bg px-3 py-2 text-sm text-white"
      />
      <Result state={state} />
      <button
        type="submit"
        className="rounded-lg bg-sx-purple px-4 py-2 text-sm font-bold text-white hover:bg-sx-purple-light"
      >
        Release username
      </button>
    </form>
  )
}

export function ClearIdentifierForm() {
  const [state, formAction] = useFormState<RecoveryState, FormData>(
    clearBannedIdentifier,
    undefined,
  )
  return (
    <form action={formAction} className="space-y-2 rounded-2xl border border-sx-border bg-sx-surface p-5">
      <h2 className="text-sm font-bold uppercase tracking-wide text-white">
        Clear a banned identifier
      </h2>
      <p className="text-xs leading-relaxed text-sx-gray">
        Lets an address register again, for a cheat flag later judged wrong. Enter the plaintext
        email or phone — the stored value is a one-way hash and cannot be searched or read back.
      </p>
      <input
        type="text"
        name="value"
        placeholder="player@example.com"
        className="w-full rounded-lg border border-sx-border bg-sx-bg px-3 py-2 text-sm text-white"
      />
      <Result state={state} />
      <button
        type="submit"
        className="rounded-lg bg-sx-purple px-4 py-2 text-sm font-bold text-white hover:bg-sx-purple-light"
      >
        Clear identifier
      </button>
    </form>
  )
}
