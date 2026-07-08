'use client'
import type { InputHTMLAttributes } from 'react'
import { useFormState } from 'react-dom'
import { requestWithdrawal, type WithdrawalState } from '@/lib/withdrawals/actions'
import { formatNaira } from '@/lib/format'

export interface WithdrawalRow {
  id: string
  amount: number
  bank_name: string
  account_number: string
  account_name: string
  status: string
  admin_note: string | null
  requested_at: string
  resolved_at: string | null
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Pending review', cls: 'text-amber-400' },
  paid: { label: 'Paid', cls: 'text-emerald-400' },
  rejected: { label: 'Rejected', cls: 'text-red-400' },
}

export function WithdrawalPanel({
  requests,
  hasPending,
}: {
  requests: WithdrawalRow[]
  hasPending: boolean
}) {
  const [state, formAction] = useFormState<WithdrawalState, FormData>(requestWithdrawal, undefined)
  const showPendingMessage = hasPending || state?.success

  return (
    <section className="mb-10">
      <h2 className="mb-4 text-base font-bold text-white">Withdrawals</h2>

      {showPendingMessage ? (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-center text-sm font-semibold text-amber-300">
          Request pending — we&apos;ll be in touch once it&apos;s reviewed.
        </div>
      ) : (
        <form
          action={formAction}
          className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-5"
        >
          <Field name="amount" label="Amount (₦)" type="number" min={1000} placeholder="1000" />
          <Field name="bankName" label="Bank name" placeholder="e.g. GTBank" />
          <Field
            name="accountNumber"
            label="Account number"
            inputMode="numeric"
            placeholder="10-digit NUBAN"
          />
          <Field name="accountName" label="Account name" placeholder="Name on the account" />
          {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
          <button
            type="submit"
            className="w-full rounded-xl bg-violet-600 px-7 py-3 text-sm font-bold text-white transition-colors hover:bg-violet-500"
          >
            Request withdrawal
          </button>
        </form>
      )}

      {requests.length > 0 && (
        <div className="mt-4 space-y-2">
          {requests.map((r) => (
            <RequestRow key={r.id} req={r} />
          ))}
        </div>
      )}
    </section>
  )
}

function Field({
  name,
  label,
  type = 'text',
  ...rest
}: { name: string; label: string; type?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="text-sm font-medium text-slate-300">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required
        {...rest}
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
      />
    </div>
  )
}

function RequestRow({ req }: { req: WithdrawalRow }) {
  const s = STATUS[req.status] ?? { label: req.status, cls: 'text-slate-400' }
  const when = formatDate(req.resolved_at ?? req.requested_at)
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-bold text-white">{formatNaira(req.amount)}</p>
        <span className={`text-xs font-semibold ${s.cls}`}>{s.label}</span>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {req.bank_name} · {req.account_number}
        {when ? ` · ${when}` : ''}
      </p>
      {req.admin_note && <p className="mt-1 text-xs text-slate-400">Note: {req.admin_note}</p>}
    </div>
  )
}
