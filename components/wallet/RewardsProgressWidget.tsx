import { computeTier, TIER_XP_THRESHOLDS, type MembershipTier } from '@/lib/membership/tiers'
import { xpToNextTierLabel } from '@/lib/dashboard/command-centre'

const TIER_LABEL: Record<MembershipTier, string> = {
  recruit: 'Recruit', guardian: 'Guardian', elite: 'Elite', sentinel: 'Sentinel', legend: 'Legend',
}

export function RewardsProgressWidget({ xp }: { xp: number }) {
  const tier = computeTier(xp)
  const floor = TIER_XP_THRESHOLDS[tier]
  const next = (Object.entries(TIER_XP_THRESHOLDS).find(([, v]) => v > xp)?.[0] ?? null) as MembershipTier | null
  const ceiling = next ? TIER_XP_THRESHOLDS[next] : null
  const pct = ceiling ? Math.min(100, Math.round(((xp - floor) / (ceiling - floor)) * 100)) : 100

  return (
    <div className="rounded-2xl border border-sx-border bg-sx-surface p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-sx-gray">Your Level</p>
      <p className="mt-1 font-display text-lg font-black text-white">{TIER_LABEL[tier]}</p>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
        <div className="h-full rounded-full bg-sx-purple transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-xs text-sx-gray">{xpToNextTierLabel(xp)}</p>
    </div>
  )
}
