import Link from 'next/link'
import { formatNaira } from '@/lib/format'
import { maskAccountNumber } from '@/lib/kyc/logic'

export function WithdrawalStatusPanel({
  linkedBankName,
  linkedAccountNumber,
  linkedAccountName,
  availableToWithdraw,
}: {
  linkedBankName: string | null
  linkedAccountNumber: string | null
  linkedAccountName: string | null
  availableToWithdraw: number
}) {
  return (
    <div className="rounded-2xl border border-sx-border bg-sx-surface p-5">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-white">Withdrawal</h2>
      {linkedBankName && linkedAccountNumber ? (
        <div className="rounded-xl border border-sx-border bg-sx-bg p-3 text-sm">
          <p className="text-white">
            🏦 {linkedBankName} {maskAccountNumber(linkedAccountNumber)}
          </p>
          <p className="text-xs text-sx-gray">{linkedAccountName}</p>
          <span className="mt-1 inline-block text-xs font-semibold text-emerald-400">Verified ✅</span>
        </div>
      ) : (
        <p className="rounded-xl border border-sx-border bg-sx-bg p-3 text-sm text-sx-gray">
          No linked account yet.{' '}
          <Link href="/dashboard/wallet/payment-methods" className="font-semibold text-sx-purple-text hover:text-sx-purple-light">
            Add one →
          </Link>
        </p>
      )}
      <p className="mt-3 text-xs text-sx-gray">Available to Withdraw</p>
      <p className="font-display text-2xl font-black text-white">{formatNaira(availableToWithdraw)}</p>
      <Link
        href="/dashboard/wallet/withdraw"
        className="mt-3 block rounded-lg bg-sx-purple px-4 py-2.5 text-center text-sm font-bold text-white hover:bg-sx-purple-light"
      >
        Request Withdrawal
      </Link>
      <p className="mt-2 text-[11px] text-sx-gray">Withdrawals are processed within 24 hours.</p>
    </div>
  )
}
