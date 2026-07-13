'use client'
import { useFormState } from 'react-dom'
import { requestFriendlyWithdrawal, type FriendlyWithdrawalState } from '@/lib/friendly-withdrawals/actions'
import { computeStakedBalance } from '@/lib/friendly-withdrawals/balance'
import { formatDate, formatNaira } from '@/lib/format'
import { Field } from './FormField'

export interface FriendlyWithdrawalRow {
  id: string
  amount: number
  status: string
  admin_note: string | null
  requested_at: string
  resolved_at: string | null
}

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Pending review', cls: 'text-amber-400' },
  paid: { label: 'Paid', cls: 'text-emerald-400' },
  rejected: { label: 'Rejected', cls: 'text-red-400' },
}

export function FriendlyWithdrawalPanel({
  wins,
  requests,
  kycVerified,
}: {
  wins: { stakeAmount: number }[]
  requests: FriendlyWithdrawalRow[]
  kycVerified: boolean
}) {
  const balance = computeStakedBalance(wins, requests)
  const hasActive = requests.some((r) => r.status === 'pending')

  if (wins.length === 0 && requests.length === 0) return null

  return (
    <section className="mb-10">
      <h2 className="mb-4 text-base font-bold text-white">Staked match winnings</h2>
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <p className="text-sm text-slate-300">Balance: {formatNaira(balance)}</p>

        {!kycVerified && (
          <p className="mt-4 text-xs text-amber-400">Complete identity verification above to withdraw.</p>
        )}

        {kycVerified && hasActive && (
          <p className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-center text-xs font-semibold text-amber-300">
            Request pending — we&apos;ll be in touch once it&apos;s reviewed.
          </p>
        )}

        {kycVerified && !hasActive && balance > 0 && <RequestForm maxAmount={balance} />}
      </div>

      {requests.length > 0 && (
        <div className="mt-2 space-y-2">
          {requests.map((r) => (
            <RequestRow key={r.id} req={r} />
          ))}
        </div>
      )}
    </section>
  )
}

function RequestForm({ maxAmount }: { maxAmount: number }) {
  const [state, formAction] = useFormState<FriendlyWithdrawalState, FormData>(
    requestFriendlyWithdrawal,
    undefined,
  )
  return (
    <form action={formAction} className="mt-4 space-y-3">
      <Field
        name="amount"
        label={`Amount (₦, up to ${formatNaira(maxAmount)})`}
        type="number"
        min={100}
        max={maxAmount}
        placeholder="100"
      />
      {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
      <button
        type="submit"
        className="w-full rounded-xl bg-violet-600 px-7 py-3 text-sm font-bold text-white transition-colors hover:bg-violet-500"
      >
        Request withdrawal
      </button>
    </form>
  )
}

function RequestRow({ req }: { req: FriendlyWithdrawalRow }) {
  const s = STATUS[req.status] ?? { label: req.status, cls: 'text-slate-400' }
  const when = formatDate(req.resolved_at ?? req.requested_at) ?? ''
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-bold text-white">{formatNaira(req.amount)}</p>
        <span className={`text-xs font-semibold ${s.cls}`}>{s.label}</span>
      </div>
      <p className="mt-1 text-xs text-slate-500">{when}</p>
      {req.admin_note && <p className="mt-1 text-xs text-slate-400">Note: {req.admin_note}</p>}
    </div>
  )
}
