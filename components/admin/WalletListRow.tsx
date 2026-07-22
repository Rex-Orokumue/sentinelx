'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { manualCreditWalletFormAction, type ManualCreditFormState } from '@/lib/admin/wallet-actions'
import { formatNaira, formatDateTime } from '@/lib/format'

export interface AdminWalletRow {
  playerId: string
  name: string
  username: string | null
  balance: number
  updatedAt: string
}

const inputClass =
  'rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none'

export function WalletListRow({ wallet }: { wallet: AdminWalletRow }) {
  const [state, action] = useFormState<ManualCreditFormState, FormData>(
    manualCreditWalletFormAction,
    undefined,
  )
  const [confirming, setConfirming] = useState(false)

  // Reset after a successful credit — watched in the render body (not the
  // submit button's onClick) so we never unmount the <form> mid-submission.
  if (state?.success && confirming) setConfirming(false)

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-bold text-white">{wallet.name}</p>
          <p className="text-xs text-slate-500">
            {wallet.username ? `@${wallet.username} · ` : ''}Last updated {formatDateTime(wallet.updatedAt)}
          </p>
        </div>
        <p className="shrink-0 text-sm font-bold text-emerald-400">{formatNaira(wallet.balance)}</p>
      </div>

      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mt-3 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-300 hover:border-slate-500"
        >
          Credit wallet…
        </button>
      ) : (
        <form action={action} className="mt-3 space-y-2">
          <input type="hidden" name="playerId" value={wallet.playerId} />
          <input name="amount" type="number" min={1} placeholder="Amount (₦)" required className={inputClass} />
          <input name="reason" placeholder="Reason (required)" required className={`w-full ${inputClass}`} />
          <p className="text-xs font-semibold text-amber-400">Credit {wallet.name}&apos;s wallet?</p>
          <div className="flex gap-2">
            <button
              type="submit"
              className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-500"
            >
              Confirm credit
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-bold text-slate-300 hover:border-slate-500"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {state?.success && (
        <p className="mt-2 text-xs text-emerald-400">Credited — new balance {formatNaira(state.balance ?? 0)}.</p>
      )}
      {state?.error && <p className="mt-2 text-xs text-red-400">{state.error}</p>}
    </div>
  )
}
