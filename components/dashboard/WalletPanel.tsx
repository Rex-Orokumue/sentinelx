'use client'
import { useFormState } from 'react-dom'
import { requestWalletWithdrawal, type WalletWithdrawalState } from '@/lib/wallet/actions'
import { formatDate, formatNaira } from '@/lib/format'
import { maskAccountNumber, kycPanelMode } from '@/lib/kyc/logic'
import { KycForm } from './KycForm'
import { Field } from './FormField'

export interface WalletRequestRow {
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

export interface PayoutAccount {
  bankName: string
  accountNumber: string
  accountName: string
}

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Pending review', cls: 'text-amber-400' },
  paid: { label: 'Paid', cls: 'text-emerald-400' },
  rejected: { label: 'Rejected', cls: 'text-red-400' },
}

export function WalletPanel({
  balance,
  requests,
  hasActive,
  kycStatus,
  kycFailureReason,
  banks,
  payoutAccount,
}: {
  balance: number
  requests: WalletRequestRow[]
  hasActive: boolean
  kycStatus: string
  kycFailureReason: string | null
  banks: { name: string; code: string }[]
  payoutAccount: PayoutAccount | null
}) {
  const mode = kycPanelMode(kycStatus)

  return (
    <>
      <p className="mb-4 rounded-2xl border border-slate-800 bg-slate-900 p-4 text-2xl font-black text-white">
        {formatNaira(balance)}
      </p>

      {mode === 'form' && <KycForm banks={banks} failureReason={kycFailureReason} />}
      {mode === 'pending' && (
        <div className="rounded-2xl border border-sky-500/30 bg-sky-500/10 p-5 text-center text-sm font-semibold text-sky-300">
          Verifying your identity — usually completes within a few minutes.
        </div>
      )}
      {mode === 'verified' && payoutAccount && (
        <VerifiedWithdrawalForm hasActive={hasActive} payoutAccount={payoutAccount} maxAmount={balance} />
      )}

      {requests.length > 0 && (
        <div className="mt-4 space-y-2">
          {requests.map((r) => (
            <RequestRow key={r.id} req={r} />
          ))}
        </div>
      )}
    </>
  )
}

function VerifiedWithdrawalForm({
  hasActive,
  payoutAccount,
  maxAmount,
}: {
  hasActive: boolean
  payoutAccount: PayoutAccount
  maxAmount: number
}) {
  const [state, formAction] = useFormState<WalletWithdrawalState, FormData>(requestWalletWithdrawal, undefined)

  return (
    <div className="space-y-3">
      <p className="rounded-xl border border-slate-800 bg-slate-900/50 p-3 text-xs text-slate-400">
        Paid to: <span className="text-slate-200">{payoutAccount.bankName}</span>{' '}
        {maskAccountNumber(payoutAccount.accountNumber)} {payoutAccount.accountName}
      </p>
      {hasActive || state?.success ? (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-center text-sm font-semibold text-amber-300">
          Request pending — we&apos;ll be in touch once it&apos;s reviewed.
        </div>
      ) : (
        <form
          action={formAction}
          className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-5"
        >
          <Field name="amount" label={`Amount (₦, up to ${formatNaira(maxAmount)})`} type="number" min={100} max={maxAmount} placeholder="100" />
          {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
          <button
            type="submit"
            className="w-full rounded-xl bg-violet-600 px-7 py-3 text-sm font-bold text-white transition-colors hover:bg-violet-500"
          >
            Request withdrawal
          </button>
        </form>
      )}
    </div>
  )
}

function RequestRow({ req }: { req: WalletRequestRow }) {
  const s = STATUS[req.status] ?? { label: req.status, cls: 'text-slate-400' }
  const when = formatDate(req.resolved_at ?? req.requested_at) ?? ''
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
