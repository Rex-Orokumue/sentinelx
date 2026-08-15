import type { MembershipTier } from '@/lib/membership/tiers'

const TIER: Record<MembershipTier, { label: string; cls: string }> = {
  recruit:  { label: 'Recruit',  cls: 'border-slate-600 text-slate-300' },
  guardian: { label: 'Guardian', cls: 'border-blue-500/50 text-blue-400' },
  elite:    { label: 'Elite',    cls: 'border-sx-purple/50 text-sx-purple-text' },
  sentinel: { label: 'Sentinel', cls: 'border-amber-500/50 text-amber-400' },
  legend:   { label: 'Legend',   cls: 'border-red-500/50 bg-gradient-to-r from-red-400 to-amber-300 bg-clip-text text-transparent' },
}

export function MembershipBadge({ tier }: { tier: string }) {
  const t = TIER[tier as MembershipTier] ?? TIER.recruit
  return (
    <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${t.cls}`}>{t.label}</span>
  )
}
