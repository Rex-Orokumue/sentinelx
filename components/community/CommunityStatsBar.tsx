import type { CommunityStats } from '@/lib/community/stats-query'

export function CommunityStatsBar({ stats }: { stats: CommunityStats }) {
  const tiles = [
    { icon: '👥', value: `${stats.memberCount.toLocaleString()}+`, label: 'Members' },
    { icon: '🌍', value: `${stats.countryCount}+`, label: 'Countries' },
    { icon: '🏆', value: `${stats.tournamentCount}+`, label: 'Tournaments Hosted' },
    { icon: '🕒', value: '24/7', label: 'Active & Growing' },
  ]
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-xl border border-sx-border bg-sx-surface p-4 text-center">
          <p className="text-lg">{t.icon}</p>
          <p className="font-display text-xl font-black text-white">{t.value}</p>
          <p className="text-xs text-sx-gray">{t.label}</p>
        </div>
      ))}
    </div>
  )
}
