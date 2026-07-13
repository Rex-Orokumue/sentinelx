'use client'
import { useState } from 'react'

export function ReferralPanel({
  username,
  referredPlayers,
}: {
  username: string
  referredPlayers: string[]
}) {
  const [copied, setCopied] = useState(false)
  const link = `https://sentinelxesports.vercel.app/signup?ref=${username}`
  const referralCount = referredPlayers.length

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
          {referralCount} referral{referralCount === 1 ? '' : 's'} — each one adds ₦100 to your wallet.
        </p>

        {referredPlayers.length > 0 && (
          <p className="mt-2 text-xs text-slate-500">Referred: {referredPlayers.join(', ')}</p>
        )}
      </div>
    </section>
  )
}
