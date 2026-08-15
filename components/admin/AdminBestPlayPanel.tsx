'use client'
import { useFormState } from 'react-dom'
import { confirmBestPlayWinner, type AdminActionState } from '@/lib/community/admin-actions'
import type { AdminNominationRow } from '@/lib/community/admin-query'

export function AdminBestPlayPanel({ nominations }: { nominations: AdminNominationRow[] }) {
  if (nominations.length === 0) {
    return (
      <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 text-center text-sm text-slate-500">
        No Best Play nominations this week yet — nominate a post above.
      </p>
    )
  }
  const alreadyDecided = nominations.some((n) => n.isWinner)

  return (
    <div className="space-y-2">
      {alreadyDecided && <p className="text-xs font-semibold text-emerald-400">✓ This week&apos;s winner has been confirmed.</p>}
      {nominations.map((n) => (
        <NominationRow key={n.nominationId} nomination={n} disabled={alreadyDecided} />
      ))}
    </div>
  )
}

function NominationRow({ nomination: n, disabled }: { nomination: AdminNominationRow; disabled: boolean }) {
  const [state, action] = useFormState<AdminActionState, FormData>(confirmBestPlayWinner, undefined)

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/50 p-3">
      <div className="min-w-0">
        <p className="text-xs font-bold text-white">{n.authorUsername ?? 'Player'}</p>
        <p className="line-clamp-1 text-xs text-slate-400">{n.content}</p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="text-xs font-bold text-amber-400">{n.voteCount} votes</span>
        {n.isWinner ? (
          <span className="text-xs font-bold text-emerald-400">🎯 Winner</span>
        ) : (
          <form action={action}>
            <input type="hidden" name="nominationId" value={n.nominationId} />
            <button type="submit" disabled={disabled} className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-500 disabled:opacity-40">
              Confirm Winner
            </button>
          </form>
        )}
      </div>
      {state?.error && <p className="text-[11px] text-red-400">{state.error}</p>}
    </div>
  )
}
