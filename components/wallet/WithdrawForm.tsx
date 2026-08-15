'use client'
import { useFormState } from 'react-dom'
import { requestWalletWithdrawal, type WalletWithdrawalState } from '@/lib/wallet/actions'
import { formatNaira } from '@/lib/format'
import { Field } from '@/components/dashboard/FormField'

export function WithdrawForm({ balance, hasActive }: { balance: number; hasActive: boolean }) {
  const [state, formAction] = useFormState<WalletWithdrawalState, FormData>(requestWalletWithdrawal, undefined)

  if (hasActive || state?.success) {
    return (
      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-center text-sm font-semibold text-amber-300">
        Request pending — we&apos;ll be in touch once it&apos;s reviewed.
      </div>
    )
  }

  return (
    <form action={formAction} className="space-y-4">
      <Field name="amount" label={`Amount (₦, up to ${formatNaira(balance)})`} type="number" min={100} max={balance} placeholder="100" />
      <p className="text-xs text-sx-gray">Available: {formatNaira(balance)} · Min: ₦100</p>
      {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
      <button
        type="submit"
        className="w-full rounded-xl bg-sx-purple px-7 py-3 text-sm font-bold text-white transition-colors hover:bg-sx-purple-light"
      >
        Withdraw
      </button>
    </form>
  )
}
