import { winPercent } from '@/lib/players/profile'
import type { ProfileView } from '@/lib/players/profile'

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border border-sx-border bg-sx-surface p-4 text-center">
      <p className="font-display text-2xl font-black text-white">{value}</p>
      <p className="mt-0.5 text-[11px] uppercase tracking-wide text-sx-gray">{label}</p>
      {sub && <p className="mt-1 text-[11px] text-sx-purple-text">{sub}</p>}
    </div>
  )
}

export function ProfileStats({ profile }: { profile: ProfileView }) {
  const topPercent =
    profile.rank != null && profile.totalRankedPlayers
      ? Math.max(1, Math.ceil((profile.rank / profile.totalRankedPlayers) * 100))
      : null

  return (
    <section id="stats" className="mb-8 scroll-mt-24">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat
          label="SX Score"
          value={profile.sentinelScore}
          sub={topPercent ? `Top ${topPercent}% of players` : undefined}
        />
        <Stat label="Titles Won" value={profile.totalTitles} />
        <Stat label="Tournaments" value={profile.tournamentsPlayed} sub="Participated" />
        <Stat label="Matches Played" value={profile.totalMatches} sub={`${profile.wins} Wins`} />
        <Stat label="Win Rate" value={winPercent(profile.wins, profile.totalMatches)} />
        <Stat label="Current Streak" value={profile.currentStreak} sub={profile.currentStreak > 0 ? 'Wins' : undefined} />
      </div>
    </section>
  )
}
