import { Users, Trophy, Gamepad2, Globe } from 'lucide-react'

// Left column of the homepage "Stats + Live Tournament" section (spec §3.1 §4).
export function StatsBar({
  playerCount,
  tournamentCount,
  gameCount,
}: {
  playerCount: number
  tournamentCount: number
  gameCount: number
}) {
  return (
    <div>
      <p className="mb-4 text-xs font-bold uppercase tracking-widest text-sx-purple-text">Stats Overview</p>
      <div className="grid grid-cols-2 gap-4">
        <StatCard icon={Users} value={String(playerCount)} label="Players" sub="In our community" />
        <StatCard icon={Trophy} value={String(tournamentCount)} label="Tournaments" sub="Running now" />
        <StatCard icon={Gamepad2} value={String(gameCount)} label="Games" sub="And more coming" />
        <div className="rounded-xl border border-sx-border bg-sx-surface p-4">
          <Globe className="mb-2 h-6 w-6 text-sx-purple-text" />
          <p className="text-sm font-bold text-white">Mission</p>
          <p className="mt-0.5 text-xs text-sx-gray">Building Africa&apos;s biggest esports community</p>
        </div>
      </div>
    </div>
  )
}

function StatCard({
  icon: Icon,
  value,
  label,
  sub,
}: {
  icon: typeof Users
  value: string
  label: string
  sub: string
}) {
  return (
    <div className="rounded-xl border border-sx-border bg-sx-surface p-4">
      <Icon className="mb-2 h-6 w-6 text-sx-purple-text" />
      <p className="font-display text-2xl font-bold text-white">{value}</p>
      <p className="text-xs font-semibold text-white/80">{label}</p>
      <p className="mt-0.5 text-[11px] text-sx-gray">{sub}</p>
    </div>
  )
}
