import { Fragment } from 'react'
import { winPercent } from '@/lib/players/profile'
import type { ProfileView } from '@/lib/players/profile'
import { CATEGORY_META } from '@/lib/games/categories'

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-3 text-center">
      <p className="text-lg font-black text-white">{value}</p>
      <p className="mt-0.5 text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
    </div>
  )
}

export function ProfileStats({ profile }: { profile: ProfileView }) {
  // Only categories this player has actually completed matches in, and only
  // ones with a defined secondary stat ('other' deliberately has none).
  const playedCategories = profile.categoryStats.filter(
    (c) => CATEGORY_META[c.category] != null && (c.scored > 0 || c.conceded > 0),
  )
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-base font-bold text-white">Stats</h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Matches" value={profile.totalMatches} />
        <Stat label="Wins" value={profile.wins} />
        <Stat label="Losses" value={profile.losses} />
        <Stat label="Win rate" value={winPercent(profile.wins, profile.totalMatches)} />
        <Stat label="Titles" value={profile.totalTitles} />
        {playedCategories.map((c) => {
          const label = CATEGORY_META[c.category].statLabel
          const diff = c.scored - c.conceded
          return (
            <Fragment key={c.category}>
              <Stat label={`${label} for`} value={c.scored} />
              <Stat label={`${label} against`} value={c.conceded} />
              <Stat label={`${label} diff`} value={diff > 0 ? `+${diff}` : diff} />
            </Fragment>
          )
        })}
      </div>
    </section>
  )
}
