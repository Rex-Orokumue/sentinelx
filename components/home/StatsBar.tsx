import { Users, Trophy, Gamepad2, Globe } from 'lucide-react'

export function StatsBar({
  playerCount,
  tournamentCount,
  gameCount,
}: {
  playerCount: number
  tournamentCount: number
  gameCount: number
}) {
  const stats = [
    { icon: Users, value: String(playerCount), label: 'Players' },
    { icon: Trophy, value: String(tournamentCount), label: 'Tournaments' },
    { icon: Gamepad2, value: String(gameCount), label: 'Games' },
  ]
  return (
    <section className="mb-10 grid grid-cols-2 gap-4 rounded-2xl border border-slate-800 bg-slate-900 p-6 sm:grid-cols-4">
      {stats.map(({ icon: Icon, value, label }) => (
        <div key={label} className="flex items-center gap-3">
          <Icon className="h-6 w-6 shrink-0 text-violet-400" />
          <div>
            <p className="text-lg font-black text-white">{value}</p>
            <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
          </div>
        </div>
      ))}
      <div className="flex items-center gap-3">
        <Globe className="h-6 w-6 shrink-0 text-violet-400" />
        <div>
          <p className="text-sm font-bold text-white">Mission</p>
          <p className="text-[11px] text-slate-500">Building Africa&apos;s Biggest Esports Community</p>
        </div>
      </div>
    </section>
  )
}
