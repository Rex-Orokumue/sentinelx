'use client'
import { useFormState, useFormStatus } from 'react-dom'
import { adminCreditWallet, type AdminCreditState } from '@/lib/wallet/admin-actions'

export function WalletCreditForm() {
  const [state, formAction] = useFormState<AdminCreditState, FormData>(adminCreditWallet, undefined)
  return (
    <form action={formAction} className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <h3 className="text-sm font-bold text-white">Credit a player&apos;s wallet</h3>
      <div className="grid grid-cols-2 gap-3">
        <input
          name="username"
          placeholder="Username"
          required
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
        />
        <input
          name="amount"
          type="number"
          min={1}
          placeholder="Amount (₦)"
          required
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
        />
      </div>
      <textarea
        name="note"
        rows={2}
        placeholder="Reason (required — e.g. compensation, sponsored prize)"
        required
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
      />
      {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
      {state?.success && <p className="text-sm text-emerald-400">Credited.</p>}
      <SubmitButton />
    </form>
  )
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-500 disabled:opacity-60"
    >
      {pending ? 'Crediting…' : 'Credit wallet'}
    </button>
  )
}
