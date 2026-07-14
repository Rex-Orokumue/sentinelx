'use client'
import { useState, useTransition } from 'react'
import { useFormState } from 'react-dom'
import { submitKyc, resolveAccountName, type KycState } from '@/lib/kyc/actions'
import { Field } from './FormField'

export function KycForm({
  banks,
  failureReason,
}: {
  banks: { name: string; code: string }[]
  failureReason?: string | null
}) {
  const [state, formAction] = useFormState<KycState, FormData>(submitKyc, undefined)
  const [bankCode, setBankCode] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [resolvedName, setResolvedName] = useState<string | null>(null)
  const [resolveError, setResolveError] = useState<string | null>(null)
  const [isResolving, startResolving] = useTransition()

  function handleAccountBlur() {
    setResolvedName(null)
    setResolveError(null)
    if (!bankCode || !/^\d{10}$/.test(accountNumber)) return
    startResolving(async () => {
      const result = await resolveAccountName(bankCode, accountNumber)
      if (result.error) setResolveError(result.error)
      else setResolvedName(result.accountName ?? null)
    })
  }

  return (
    <form action={formAction} className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <p className="text-sm text-slate-400">
        Add your payout bank account once — this is the account that will receive every
        future prize withdrawal.
      </p>
      {failureReason && <p className="text-sm text-red-400">{failureReason}</p>}

      <div className="space-y-1.5">
        <label htmlFor="bankCode" className="text-sm font-medium text-slate-300">
          Bank
        </label>
        <select
          id="bankCode"
          name="bankCode"
          required
          value={bankCode}
          onChange={(e) => {
            setBankCode(e.target.value)
            setResolvedName(null)
          }}
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
        >
          <option value="">Select your bank</option>
          {banks.map((b) => (
            <option key={b.code} value={b.code}>
              {b.name}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="accountNumber" className="text-sm font-medium text-slate-300">
          Account number
        </label>
        <input
          id="accountNumber"
          name="accountNumber"
          required
          inputMode="numeric"
          maxLength={10}
          placeholder="10-digit NUBAN"
          value={accountNumber}
          onChange={(e) => setAccountNumber(e.target.value)}
          onBlur={handleAccountBlur}
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
        />
        {isResolving && <p className="text-xs text-slate-500">Checking account…</p>}
        {resolvedName && <p className="text-xs text-emerald-400">Resolved: {resolvedName}</p>}
        {resolveError && <p className="text-xs text-red-400">{resolveError}</p>}
      </div>

      <Field name="firstName" label="First name" placeholder="As on your bank account" />
      <Field name="lastName" label="Last name" placeholder="As on your bank account" />

      {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
      <button
        type="submit"
        disabled={!resolvedName}
        className="w-full rounded-xl bg-violet-600 px-7 py-3 text-sm font-bold text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Save payout details
      </button>
    </form>
  )
}
