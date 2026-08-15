import Link from 'next/link'
import { Medal } from 'lucide-react'
import { computeTier, TIER_XP_THRESHOLDS, type MembershipTier } from '@/lib/membership/tiers'
import { streakMilestonePreview } from '@/lib/dashboard/command-centre'
import type { RecentAchievement } from '@/components/dashboard/RecentAchievements'

const TIER_LABEL: Record<MembershipTier, string> = {
  recruit: 'Recruit',
  guardian: 'Guardian',
  elite: 'Elite',
  sentinel: 'Sentinel',
  legend: 'Legend',
}
const NEXT_TIER: Record<MembershipTier, MembershipTier | null> = {
  recruit: 'guardian', guardian: 'elite', elite: 'sentinel', sentinel: 'legend', legend: null,
}

export function ProgressCard({
  xp,
  coinBalance,
  loginStreak,
  recentAchievements,
}: {
  xp: number
  coinBalance: number
  loginStreak: number
  recentAchievements: RecentAchievement[]
}) {
  const tier = computeTier(xp)
  const next = NEXT_TIER[tier]
  const floor = TIER_XP_THRESHOLDS[tier]
  const ceiling = next ? TIER_XP_THRESHOLDS[next] : null
  const milestonePreview = streakMilestonePreview(loginStreak)

  return (
    <section className="rounded-2xl border border-sx-border bg-sx-surface p-5">
      <h2 className="text-sm font-bold uppercase tracking-wide text-white">⚡ Your Progress</h2>
      <div className="mt-3 border-t border-sx-border pt-3">
        <p className="text-sm font-bold text-white">{TIER_LABEL[tier]}</p>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full rounded-full bg-sx-purple transition-all"
            style={{ width: `${ceiling ? Math.min(100, Math.round(((xp - floor) / (ceiling - floor)) * 100)) : 100}%` }}
          />
        </div>
        <p className="mt-1 text-xs text-sx-gray">
          {xp.toLocaleString()} XP{ceiling ? ` / ${ceiling.toLocaleString()} to ${TIER_LABEL[next!]}` : ' (max tier)'}
        </p>
      </div>

      <div className="mt-4 flex items-center justify-between rounded-xl border border-sx-border bg-sx-bg p-3">
        <p className="font-display text-lg font-black text-white">🪙 {coinBalance.toLocaleString()} coins</p>
        <Link href="/store" className="rounded-lg bg-sx-purple px-3 py-1.5 text-xs font-bold text-white hover:bg-sx-purple-light">
          Visit Store →
        </Link>
      </div>

      {loginStreak >= 2 && (
        <p className="mt-3 text-sm font-semibold text-amber-400">
          🔥 {loginStreak}-day streak {milestonePreview && <span className="text-sx-gray">({milestonePreview})</span>}
        </p>
      )}

      <div className="mt-4 border-t border-sx-border pt-3">
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-sx-gray">Recent Achievements</p>
        {recentAchievements.length === 0 ? (
          <p className="text-sm text-sx-gray">Complete your first match to start earning achievements.</p>
        ) : (
          <div className="space-y-2">
            {recentAchievements.map((a) => (
              <div key={a.name} className="flex items-center gap-2 text-sm text-white">
                <Medal className="h-4 w-4 text-sx-purple-text" /> {a.name}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
