'use client'
import { useState } from 'react'
import { HexAvatar } from '@/components/shared/HexAvatar'
import type { MembershipTier } from '@/lib/membership/tiers'

export interface ReferredPlayer {
  id: string
  name: string
  avatarUrl: string | null
  tier: MembershipTier
  status: 'pending' | 'converted' | 'invalid'
  date: string
  coinsAwarded: number | null
}

export interface MilestoneHistoryEntry {
  id: string
  description: string
  coins: number
  date: string
}

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })
}

export function ReferralPanel({
  username,
  totalReferrals,
  convertedCount,
  totalCoinsEarned,
  nextMilestoneCount,
  nextMilestoneBonusCoins,
  referredPlayers,
  milestoneHistory,
}: {
  username: string
  totalReferrals: number
  convertedCount: number
  totalCoinsEarned: number
  nextMilestoneCount: number | null
  nextMilestoneBonusCoins: number | null
  referredPlayers: ReferredPlayer[]
  milestoneHistory: MilestoneHistoryEntry[]
}) {
  const [copied, setCopied] = useState(false)
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sentinelx.gg'
  const link = `${siteUrl}/signup?ref=${username}`
  const shareText = `Come compete on SentinelX — Nigeria's home of mobile esports! Sign up here: ${link}`
  const shareUrl = `https://wa.me/?text=${encodeURIComponent(shareText)}`

  function copyLink() {
    navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const progressPct = nextMilestoneCount ? Math.min(100, Math.round((convertedCount / nextMilestoneCount) * 100)) : 100

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">Bring in a friend. Earn coins when they compete.</p>

      <div className="rounded-2xl border border-sx-border bg-sx-surface p-4">
        <p className="text-[11px] uppercase text-sx-gray">Your referral link</p>
        <code className="mt-1 block truncate rounded-lg bg-sx-bg px-2.5 py-1.5 text-[11px] text-sx-gray">{link}</code>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={copyLink}
            className="flex-1 rounded-lg bg-sx-purple px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-sx-purple-light"
          >
            {copied ? 'Copied!' : 'Copy Link'}
          </button>
          <a
            href={shareUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 rounded-lg border border-sx-border px-2.5 py-1.5 text-center text-[11px] font-bold text-white hover:bg-sx-bg"
          >
            Share on WhatsApp
          </a>
        </div>
      </div>

      <p className="text-sm text-slate-300">
        {totalReferrals} total referral{totalReferrals === 1 ? '' : 's'} · {convertedCount} converted · +
        {totalCoinsEarned.toLocaleString()} coins earned
      </p>

      {nextMilestoneCount && (
        <div className="rounded-2xl border border-sx-border bg-sx-surface p-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-sx-white">Next Milestone</p>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-sx-bg">
            <div className="h-full rounded-full bg-sx-purple transition-all" style={{ width: `${progressPct}%` }} />
          </div>
          <p className="mt-1.5 text-[11px] text-sx-gray">
            {convertedCount} of {nextMilestoneCount} converted
            {nextMilestoneBonusCoins ? ` — +${nextMilestoneBonusCoins.toLocaleString()} coins bonus` : ''}
          </p>
        </div>
      )}

      <div>
        <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-sx-white">Referred Players</p>
        {referredPlayers.length === 0 ? (
          <p className="rounded-2xl border border-sx-border bg-sx-surface p-4 text-center text-xs text-sx-gray">
            No referrals yet — share your link to get started.
          </p>
        ) : (
          <div className="space-y-2">
            {referredPlayers.map((r) => (
              <div key={r.id} className="flex items-center gap-3 rounded-2xl border border-sx-border bg-sx-surface p-3">
                <HexAvatar src={r.avatarUrl} username={r.name} tier={r.tier} size="xs" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-white">{r.name}</p>
                  <p className="text-[11px] text-sx-gray">
                    {r.status === 'converted' ? '✅ Converted' : r.status === 'pending' ? '⏳ Pending' : '—'} · {formatShortDate(r.date)}
                    {r.coinsAwarded ? ` · +${r.coinsAwarded} coins` : ''}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {milestoneHistory.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-sx-white">Milestone History</p>
          <div className="space-y-1.5">
            {milestoneHistory.map((m) => (
              <p key={m.id} className="text-xs text-sx-gray">
                ✅ {m.description} — +{m.coins.toLocaleString()} coins ({formatShortDate(m.date)})
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
