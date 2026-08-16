import { computeTier, TIER_XP_THRESHOLDS, type MembershipTier } from '@/lib/membership/tiers'

const NEXT_TIER: Record<MembershipTier, MembershipTier | null> = {
  recruit: 'guardian', guardian: 'elite', elite: 'sentinel', sentinel: 'legend', legend: null,
}
const TIER_LABEL: Record<MembershipTier, string> = {
  recruit: 'Recruit', guardian: 'Guardian', elite: 'Elite', sentinel: 'Sentinel', legend: 'Legend',
}

// coinBalance is optional and owner-only — callers must never pass it when
// rendering another player's profile (see profile page wiring).
export function XPProgressPanel({ xp, coinBalance }: { xp: number; coinBalance?: number }) {
  const tier = computeTier(xp)
  const next = NEXT_TIER[tier]
  const floor = TIER_XP_THRESHOLDS[tier]
  const ceiling = next ? TIER_XP_THRESHOLDS[next] : null
  const pct = ceiling ? Math.min(100, Math.round(((xp - floor) / (ceiling - floor)) * 100)) : 100

  return (
    <div className="rounded-xl border border-sx-border bg-sx-surface p-4">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="font-bold uppercase text-white">👑 {TIER_LABEL[tier]}</span>
        <span className="text-sx-gray">{xp.toLocaleString()} XP{ceiling ? ` / ${ceiling.toLocaleString()}${next ? ` to ${TIER_LABEL[next]}` : ''}` : ' (max tier)'}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-800">
        <div className="h-full rounded-full bg-sx-purple transition-all" style={{ width: `${pct}%` }} />
      </div>
      {coinBalance != null && (
        <p className="mt-2 text-sm font-bold text-white">🪙 {coinBalance.toLocaleString()} SX Coins</p>
      )}
    </div>
  )
}
