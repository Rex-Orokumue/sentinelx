import { winPercent, goalDifference } from '@/lib/players/profile'
import type { ProfileView } from '@/lib/players/profile'

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-3 text-center">
      <p className="text-lg font-black text-white">{value}</p>
      <p className="mt-0.5 text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
    </div>
  )
}

export function ProfileStats({ profile }: { profile: ProfileView }) {
  const gd = goalDifference(profile.goalsScored, profile.goalsConceded)
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-base font-bold text-white">Stats</h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Matches" value={profile.totalMatches} />
        <Stat label="Wins" value={profile.wins} />
        <Stat label="Losses" value={profile.losses} />
        <Stat label="Win rate" value={winPercent(profile.wins, profile.totalMatches)} />
        <Stat label="Goals for" value={profile.goalsScored} />
        <Stat label="Goals against" value={profile.goalsConceded} />
        <Stat label="Goal diff" value={gd > 0 ? `+${gd}` : gd} />
        <Stat label="Titles" value={profile.totalTitles} />
      </div>
    </section>
  )
}
