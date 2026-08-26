import { HexAvatar } from '@/components/shared/HexAvatar'
import { computeTier, TIER_XP_THRESHOLDS, type MembershipTier } from '@/lib/membership/tiers'
import { xpToNextTierLabel } from '@/lib/dashboard/command-centre'

const TIER_LABEL: Record<MembershipTier, string> = {
  recruit: 'Recruit',
  guardian: 'Guardian',
  elite: 'Elite',
  sentinel: 'Sentinel',
  legend: 'Legend',
}
const TIER_CHIP_CLASS: Record<MembershipTier, string> = {
  recruit: 'bg-slate-700 text-slate-200',
  guardian: 'bg-blue-500/20 text-blue-300',
  elite: 'bg-sx-purple/20 text-sx-purple-text',
  sentinel: 'bg-amber-500/20 text-amber-300',
  legend: 'bg-gradient-to-r from-red-500/30 to-amber-400/30 text-amber-200',
}
const TIER_BAR_CLASS: Record<MembershipTier, string> = {
  recruit: 'bg-slate-500',
  guardian: 'bg-blue-500',
  elite: 'bg-sx-purple',
  sentinel: 'bg-amber-500',
  legend: 'bg-gradient-to-r from-red-500 to-amber-400',
}

export function HeroIdentityPanel({
  avatarUrl,
  displayName,
  achievements,
  xp,
  sxScore,
  seasonRank,
  loginStreak,
  avatarBorderClass,
  profileThemeClass,
  usernameColourClass,
}: {
  avatarUrl: string | null
  displayName: string
  achievements: string[]
  xp: number
  sxScore: number
  seasonRank: number | null
  loginStreak: number
  /** Equipped avatar_border cosmetic — a `ring-*` utility, additive with HexAvatar's own tier border. */
  avatarBorderClass?: string
  /** Equipped profile_theme cosmetic — REPLACES the default radial-gradient background, never appended
   *  (an inline `style` background always wins over a Tailwind `bg-*` class, so the two can't coexist —
   *  see components/player/ProfileHeader.tsx for the same rule on the public profile). */
  profileThemeClass?: string
  /** Equipped username_colour cosmetic — REPLACES the default `text-white`, same reasoning as above. */
  usernameColourClass?: string
}) {
  const tier = computeTier(xp)
  const next = tier === 'legend' ? null : Object.entries(TIER_XP_THRESHOLDS).find(([, v]) => v > xp)?.[0]
  const floor = TIER_XP_THRESHOLDS[tier]
  const ceiling = next ? TIER_XP_THRESHOLDS[next as MembershipTier] : null
  const pct = ceiling ? Math.min(100, Math.round(((xp - floor) / (ceiling - floor)) * 100)) : 100

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-sx-border p-6 ${profileThemeClass ?? ''}`}
      style={
        profileThemeClass
          ? undefined
          : { background: 'radial-gradient(ellipse at top left, rgba(124,58,237,0.3), transparent 70%), #0B0B0F' }
      }
    >
      <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:items-start sm:text-left">
        <HexAvatar
          src={avatarUrl}
          username={displayName}
          tier={tier}
          achievements={achievements}
          size="lg"
          avatarBorderClass={avatarBorderClass}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
            <p className={`font-display text-3xl font-black uppercase ${usernameColourClass ?? 'text-white'}`}>
              Welcome back, {displayName}
            </p>
            <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase ${TIER_CHIP_CLASS[tier]}`}>
              {TIER_LABEL[tier]}
            </span>
          </div>
          {loginStreak >= 2 && <p className="mt-1 text-sm font-semibold text-amber-400">🔥 {loginStreak}-day streak</p>}

          <div className="mt-4 flex justify-center gap-8 border-t border-sx-border pt-4 sm:justify-start">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-sx-gray">SX Score</p>
              <p className="font-display text-xl font-black text-white">{sxScore.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-sx-gray">Season Rank</p>
              <p className="font-display text-xl font-black text-white">{seasonRank != null ? `#${seasonRank}` : 'Unranked'}</p>
            </div>
          </div>

          <div className="mt-4">
            <div className="h-2 overflow-hidden rounded-full bg-slate-800">
              <div className={`h-full rounded-full transition-all ${TIER_BAR_CLASS[tier]}`} style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-1.5 text-xs text-sx-gray">{xpToNextTierLabel(xp)}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
