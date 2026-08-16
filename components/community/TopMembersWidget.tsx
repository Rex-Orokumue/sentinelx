import Link from 'next/link'
import { HexAvatar } from '@/components/shared/HexAvatar'
import { rankIcon, type TopMemberView } from '@/lib/community/top-members-query'
import type { MembershipTier } from '@/lib/membership/tiers'

const TIER_LABEL: Record<MembershipTier, string> = {
  recruit: 'Recruit',
  guardian: 'Guardian',
  elite: 'Elite',
  sentinel: 'Sentinel',
  legend: 'Legend',
}

export function TopMembersWidget({ members }: { members: TopMemberView[] }) {
  if (members.length === 0) return null
  return (
    <div className="rounded-2xl border border-sx-border bg-sx-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-black uppercase tracking-widest text-sx-white">Top Community Members</h2>
        <Link href="/rankings" className="text-[11px] font-semibold text-sx-purple-text hover:text-sx-purple-light">
          View All →
        </Link>
      </div>
      <div className="space-y-3">
        {members.map((m) => {
          const name = m.displayName ?? m.username ?? 'Player'
          return (
            <div key={m.id} className="flex items-center gap-2.5">
              <span className="w-5 shrink-0 text-center text-sm font-bold text-sx-gray">{rankIcon(m.rank)}</span>
              <HexAvatar src={m.avatarUrl} username={name} tier={m.membershipTier} size="xs" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-white">{name}</p>
                <p className="text-[11px] text-sx-gray">{TIER_LABEL[m.membershipTier]}</p>
              </div>
              <p className="shrink-0 text-xs font-bold text-sx-purple-text">{m.xp.toLocaleString()} XP</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
