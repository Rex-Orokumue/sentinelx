'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { requestReferralWithdrawal, type ReferralWithdrawalState } from '@/lib/referrals/actions'
import { computeReferralBalance, isEligibleForReferralWithdrawal, REFERRAL_MIN_COUNT } from '@/lib/referrals/balance'
import { formatDate, formatNaira } from '@/lib/format'
import { Field } from './FormField'

export interface ReferralWithdrawalRow {
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

export function ReferralPanel({
  username,
  referredPlayers,
  requests,
  kycVerified,
}: {
  username: string
  referredPlayers: string[]
  requests: ReferralWithdrawalRow[]
  kycVerified: boolean
}) {
  const [copied, setCopied] = useState(false)
  const link = `https://sentinelxesports.vercel.app/signup?ref=${username}`
  const referralCount = referredPlayers.length
  const balance = computeReferralBalance(referralCount, requests)
  const hasActive = requests.some((r) => r.status === 'pending')
  const eligible = isEligibleForReferralWithdrawal(referralCount)

  function copyLink() {
    navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <section className="mb-10">
      <h2 className="mb-4 text-base font-bold text-white">Referrals</h2>
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <p className="text-xs text-slate-400">Your referral link</p>
        <div className="mt-1 flex items-center gap-2">
          <code className="flex-1 truncate rounded-lg bg-slate-950 px-3 py-2 text-xs text-slate-300">{link}</code>
          <button
            type="button"
            onClick={copyLink}
            className="shrink-0 rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold text-white hover:bg-violet-500"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>

        <p className="mt-4 text-sm text-slate-300">
          {referralCount} referral{referralCount === 1 ? '' : 's'} · balance {formatNaira(balance)}
        </p>

        {referredPlayers.length > 0 && (
          <p className="mt-2 text-xs text-slate-500">Referred: {referredPlayers.join(', ')}</p>
        )}

        {!eligible && (
          <p className="mt-4 text-xs text-slate-500">
            Refer {REFERRAL_MIN_COUNT - referralCount} more player
            {REFERRAL_MIN_COUNT - referralCount === 1 ? '' : 's'} to unlock withdrawals.
          </p>
        )}

        {eligible && !kycVerified && (
          <p className="mt-4 text-xs text-amber-400">Complete identity verification above to withdraw.</p>
        )}

        {eligible && kycVerified && hasActive && (
          <p className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-center text-xs font-semibold text-amber-300">
            Request pending — we&apos;ll be in touch once it&apos;s reviewed.
          </p>
        )}

        {eligible && kycVerified && !hasActive && <ReferralWithdrawalForm maxAmount={balance} />}
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

function ReferralWithdrawalForm({ maxAmount }: { maxAmount: number }) {
  const [state, formAction] = useFormState<ReferralWithdrawalState, FormData>(
    requestReferralWithdrawal,
    undefined,
  )
  return (
    <form action={formAction} className="mt-4 space-y-3">
      <Field
        name="amount"
        label={`Amount (₦, up to ${formatNaira(maxAmount)})`}
        type="number"
        min={500}
        max={maxAmount}
        placeholder="500"
      />
      {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
      <button
        type="submit"
        className="w-full rounded-xl bg-violet-600 px-7 py-3 text-sm font-bold text-white transition-colors hover:bg-violet-500"
      >
        Request referral withdrawal
      </button>
    </form>
  )
}

function RequestRow({ req }: { req: ReferralWithdrawalRow }) {
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
