'use client'
import { useState } from 'react'
import Link from 'next/link'
import { formatNaira } from '@/lib/format'

export function ReferralEarningsCard({
  referralLink,
  totalReferrals,
  totalEarned,
}: {
  referralLink: string
  totalReferrals: number
  totalEarned: number
}) {
  const [copied, setCopied] = useState(false)
  function copyLink() {
    navigator.clipboard.writeText(referralLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div className="rounded-2xl border border-sx-border bg-sx-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-black uppercase tracking-widest text-sx-white">Referral Earnings</h2>
        <Link href="/dashboard/referrals" className="text-[11px] font-semibold text-sx-purple-text hover:text-sx-purple-light">
          View All →
        </Link>
      </div>
      <div className="flex items-center justify-between text-sm">
        <div>
          <p className="text-[10px] uppercase text-sx-gray">Total Referrals</p>
          <p className="font-display text-lg font-black text-white">{totalReferrals}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase text-sx-gray">Total Earned</p>
          <p className="font-display text-lg font-black text-emerald-400">{formatNaira(totalEarned)}</p>
        </div>
      </div>
      <p className="mt-3 text-[11px] text-sx-gray">Your Referral Link</p>
      <div className="mt-1 flex items-center gap-2">
        <code className="flex-1 truncate rounded-lg bg-sx-bg px-2.5 py-1.5 text-[11px] text-sx-gray">{referralLink}</code>
        <button
          type="button"
          onClick={copyLink}
          className="shrink-0 rounded-lg bg-sx-purple px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-sx-purple-light"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <p className="mt-2 text-[11px] text-sx-gray">Earn ₦100 from every referral&apos;s tournament entry.</p>
    </div>
  )
}
