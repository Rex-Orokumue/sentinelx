'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { initiateWalletDeposit, type WalletDepositState } from '@/lib/wallet/deposit'
import { computePaystackFee } from '@/lib/paystack/fees'
import { formatNaira } from '@/lib/format'
import { Field } from '@/components/dashboard/FormField'

export function DepositForm() {
  const [state, formAction] = useFormState<WalletDepositState, FormData>(initiateWalletDeposit, undefined)
  const [amount, setAmount] = useState<number | ''>('')
  const fee = typeof amount === 'number' && amount >= 100 ? computePaystackFee(amount) : 0
  const total = typeof amount === 'number' && amount >= 100 ? amount + fee : 0

  return (
    <form action={formAction} className="space-y-4">
      <Field
        name="amount"
        label="Amount to add (₦)"
        type="number"
        min={100}
        placeholder="1000"
        value={amount}
        onChange={(e) => setAmount(e.target.value === '' ? '' : Number(e.target.value))}
      />
      {total > 0 && (
        <p className="text-xs text-sx-gray">
          You&apos;ll pay {formatNaira(total)} total — {formatNaira(amount as number)} to your wallet + {formatNaira(fee)} fee.
        </p>
      )}
      {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
      <button
        type="submit"
        className="w-full rounded-xl bg-emerald-600 px-7 py-3 text-sm font-bold text-white transition-colors hover:bg-emerald-500"
      >
        Fund wallet
      </button>
    </form>
  )
}
