'use client'
import { useFormState } from 'react-dom'
import { revokeWaiver, type WaiverFormState } from '@/lib/tournaments/waiver-admin-actions'
import { formatDateTime } from '@/lib/format'

export interface AdminWaiver {
  id: string
  username: string | null
  reason: string | null
  grantedAt: string
  redeemedAt: string | null
}

export function WaiverRow({
  waiver,
  tournamentId,
  canRevoke,
}: {
  waiver: AdminWaiver
  tournamentId: string
  canRevoke: boolean
}) {
  const [state, action] = useFormState<WaiverFormState, FormData>(revokeWaiver, undefined)

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-slate-800 bg-slate-950 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-white">
          {waiver.username ?? 'Unknown player'}
          {waiver.redeemedAt ? (
            <span className="ml-2 text-[11px] font-semibold text-emerald-400">
              Redeemed {formatDateTime(waiver.redeemedAt)}
            </span>
          ) : (
            <span className="ml-2 text-[11px] font-semibold text-amber-400">Not yet used</span>
          )}
        </p>
        <p className="text-xs text-slate-500">
          {waiver.reason ?? 'No reason given'} · Granted {formatDateTime(waiver.grantedAt)}
        </p>
      </div>
      {!waiver.redeemedAt && canRevoke && (
        <form action={action}>
          <input type="hidden" name="id" value={waiver.id} />
          <input type="hidden" name="tournamentId" value={tournamentId} />
          <button
            type="submit"
            className="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs font-bold text-red-400 hover:bg-red-500/10"
          >
            Revoke
          </button>
        </form>
      )}
      {state?.error && <p className="text-xs text-red-400">{state.error}</p>}
    </div>
  )
}
