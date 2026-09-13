'use client'
import { useFormState, useFormStatus } from 'react-dom'
import { resolveWalletWithdrawal, type WalletWithdrawalResolveState } from '@/lib/wallet/admin-actions'
import { formatNaira } from '@/lib/format'

// Two submit buttons share one form here, so a generic SubmitButton can't
// tell which one was clicked — `data` is the pending submission's FormData,
// which includes the clicked button's name/value pair.
function ResolveButton({ action, className, children }: { action: 'paid' | 'rejected'; className: string; children: React.ReactNode }) {
  const { pending, data } = useFormStatus()
  const isThisOne = pending && data?.get('action') === action
  return (
    <button
      type="submit"
      name="action"
      value={action}
      disabled={pending}
      className={`${className} disabled:cursor-wait disabled:opacity-60`}
    >
      {isThisOne ? 'Working…' : children}
    </button>
  )
}

export interface PendingWalletWithdrawal {
  id: string
  playerName: string
  amount: number
  bankName: string
  accountNumber: string
  accountName: string
}

export function WalletWithdrawalQueueRow({ req }: { req: PendingWalletWithdrawal }) {
  const [state, action] = useFormState<WalletWithdrawalResolveState, FormData>(resolveWalletWithdrawal, undefined)

  return (
    <form action={action} className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <input type="hidden" name="id" value={req.id} />
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 truncate font-bold text-white">{req.playerName}</p>
        <p className="shrink-0 font-black text-white">{formatNaira(req.amount)}</p>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {req.bankName} · {req.accountNumber} · {req.accountName}
      </p>
      <textarea
        name="note"
        rows={2}
        placeholder="Note (required to reject)"
        className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
      />
      {state?.error && <p className="mt-2 text-sm text-red-400">{state.error}</p>}
      <div className="mt-2 flex gap-2">
        <ResolveButton action="paid" className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500">
          Pay
        </ResolveButton>
        <ResolveButton action="rejected" className="rounded-lg border border-red-500/40 px-4 py-2 text-xs font-bold text-red-400 hover:bg-red-500/10">
          Reject
        </ResolveButton>
      </div>
    </form>
  )
}
