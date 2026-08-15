import { winRatePercent } from '@/lib/dashboard/command-centre'

export function StatsRow({
  wins,
  totalMatches,
  goalsScored,
  coinBalance,
}: {
  wins: number
  totalMatches: number
  goalsScored: number
  coinBalance: number
}) {
  const stats = [
    { icon: '🎯', label: 'Win Rate', value: `${winRatePercent(wins, totalMatches)}%` },
    { icon: '🏆', label: 'Total Wins', value: wins.toLocaleString() },
    { icon: '⚽', label: 'Goals Scored', value: goalsScored.toLocaleString() },
    { icon: '🪙', label: 'SX Coins', value: coinBalance.toLocaleString() },
  ]
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {stats.map((s) => (
        <div key={s.label} className="relative rounded-xl bg-sx-surface p-4">
          <span className="absolute right-3 top-3 text-lg text-sx-purple-text">{s.icon}</span>
          <p className="font-display text-2xl font-black text-white">{s.value}</p>
          <p className="text-xs text-sx-gray">{s.label}</p>
        </div>
      ))}
    </div>
  )
}
