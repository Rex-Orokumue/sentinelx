import { HexAvatar } from '@/components/shared/HexAvatar'
import { TierBadge } from '@/components/player/TierBadge'
import type { MembershipTier } from '@/lib/membership/tiers'

export function AllTimeAwardCard({
  label,
  icon,
  avatarUrl,
  name,
  membershipTier,
  sentinelTier,
  metricLabel,
  metricValue,
  awardName,
}: {
  label: string
  icon: string
  avatarUrl: string | null
  name: string
  membershipTier: string | null
  sentinelTier: string | null
  metricLabel: string
  metricValue: string | number
  awardName: string
}) {
  return (
    <div
      className="flex-1 rounded-2xl border border-amber-500/40 bg-gradient-to-b from-[#1A1500] to-sx-surface p-6 text-center"
      style={{ boxShadow: '0 0 32px rgba(245,158,11,0.2)' }}
    >
      <p className="text-xs font-bold uppercase tracking-widest text-amber-400">
        {icon} {label}
      </p>
      <div className="mt-4 flex justify-center">
        <HexAvatar src={avatarUrl} username={name} tier={(membershipTier ?? 'recruit') as MembershipTier} size="xl" />
      </div>
      <p className="mt-3 font-display text-xl font-black text-white">{name}</p>
      <TierBadge tier={sentinelTier} />
      <p className="mt-3 font-display text-2xl font-black text-white">{metricValue}</p>
      <p className="text-xs text-sx-gray">{metricLabel}</p>
      <p className="mt-3 text-[11px] font-bold uppercase tracking-widest text-amber-400">{awardName}</p>
    </div>
  )
}

export function AllTimeAwardEmptyCard({ label, icon }: { label: string; icon: string }) {
  return (
    <div className="flex-1 rounded-2xl border border-amber-500/20 bg-sx-surface p-6 text-center opacity-60">
      <p className="text-3xl grayscale">{icon}</p>
      <p className="mt-3 text-sm font-bold text-amber-200/70">{label} awaits its first champion</p>
    </div>
  )
}
